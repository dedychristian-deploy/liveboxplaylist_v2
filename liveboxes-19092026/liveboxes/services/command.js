const net = require("net");

// One persistent TCP connection per "host:port", reused across every
// command instead of opening a brand new connection and tearing it down
// for each single command. The old per-command connect/disconnect pattern
// caused two visible problems once a TAKE started firing several commands
// in a row (e.g. the TOGGLE_BOX_XX sequence): (1) real latency - every
// command paid a fresh TCP handshake, plus up to the full 1500ms fallback
// timeout whenever the "end of response" detection didn't line up cleanly
// with a single connect/write/read/close cycle, and (2) occasionally
// DROPPED commands - reconnecting that fast back-to-back sometimes got
// refused/reset by Viz Engine, which surfaced only as a swallowed
// {ok:false} from /vizsend with no retry, so that one command just never
// reached the engine while everything else kept going.
const connections = new Map(); // "host:port" -> connection state

function connectionKey(host, port) {
    return `${host}:${port}`;
}

function createConnection(host, port) {
    const socket = new net.Socket();
    socket.setNoDelay(true);

    const state = { socket, buffer: "", queue: [] };

    const failAll = (err) => {
        const pending = state.queue.splice(0, state.queue.length);
        pending.forEach(p => {
            clearTimeout(p.timer);
            err ? p.reject(err) : p.resolve(p.buffer);
        });
    };

    socket.connect(Number(port), host);

    socket.on("data", d => {
        state.buffer += d.toString("utf8");
        // Each response is null-terminated - a single write can carry
        // more than one, so drain every complete one currently buffered
        // and match each to the OLDEST pending request (Viz answers in
        // the order commands were sent on this connection).
        let nullIndex;
        while ((nullIndex = state.buffer.indexOf("\x00")) !== -1) {
            const message = state.buffer.slice(0, nullIndex);
            state.buffer = state.buffer.slice(nullIndex + 1);
            const pending = state.queue.shift();
            if (pending) {
                clearTimeout(pending.timer);
                pending.resolve(message.trim());
            }
        }
    });

    socket.on("error", err => {
        failAll(err);
        connections.delete(connectionKey(host, port));
    });

    socket.on("close", () => {
        failAll(null);
        connections.delete(connectionKey(host, port));
    });

    return state;
}

function sendVizCommand(host, port, command) {
    const key = connectionKey(host, port);
    let state = connections.get(key);
    if (!state || state.socket.destroyed) {
        state = createConnection(host, port);
        connections.set(key, state);
    }

    return new Promise((resolve, reject) => {
        // Fire-and-forget optimization for commands that never respond
        const cmdUpper = command.toUpperCase();
        const isFireAndForget =
            cmdUpper.includes(" SET ") ||
            cmdUpper.includes(" INVOKE") ||
            cmdUpper.includes(" SHOW ") ||
            cmdUpper.includes(" UPDATE ") ||
            cmdUpper.includes(" GOTO_TRIO ");

        if (isFireAndForget) {
            // Write to socket and resolve immediately - no queue, no timeout
            state.socket.write(Buffer.concat([
                Buffer.from(command, "utf8"),
                Buffer.from([0])
            ]));
            resolve("");
        } else {
            // Commands that expect response: queue with timeout
            const timer = setTimeout(() => {
                const idx = state.queue.findIndex(p => p.timer === timer);
                if (idx !== -1) state.queue.splice(idx, 1);
                resolve("");
            }, 250);

            state.queue.push({ resolve, reject, timer, buffer: "" });
            state.socket.write(Buffer.concat([
                Buffer.from(command, "utf8"),
                Buffer.from([0])
            ]));
        }
    });
}

module.exports = { sendVizCommand };
