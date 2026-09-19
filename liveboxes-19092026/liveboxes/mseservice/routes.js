const express = require("express");
const mse = require("./mse");

const router = express.Router();

router.get("/playlists", async (req, res) => {
    try {
        const response = await mse.getPlaylists(req.query.studio, req.query.target);

        res
            .status(response.statusCode)
            .type("application/atom+xml")
            .send(response.body);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

router.get("/playlist-status", async (req, res) => {
    try {
        const response = await mse.getPlaylistActivation(req.query.studio, req.query.target);

        const active =
            response.statusCode >= 200 &&
            response.statusCode < 300 &&
            response.body.includes("active_on_profile");

        res.json({
            active,
            playlistId: response.playlistId
        });

    } catch (err) {
        res.status(500).json({
            active: false
        });
    }
});

router.get("/elements", async (req, res) => {
    try {
        const response = await mse.getElements(req.query.path, req.query.studio, req.query.target);

        res
            .status(response.statusCode)
            .type("application/atom+xml")
            .send(response.body);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

router.get("/element", async (req, res) => {
    try {
        const response = await mse.getElement(req.query.url);

        res
            .status(response.statusCode)
            .type("application/vnd.vizrt.payload+xml")
            .send(response.body);
    } catch (err) {
        // err.message alone is just "fetch failed" for Node's undici-based
        // fetch() - the actual underlying reason (TLS failure, ECONNREFUSED,
        // DNS failure, etc.) lives on err.cause, which was never logged or
        // returned before. Logging it here so the real cause shows up in
        // the server terminal instead of a bare unhelpful "fetch failed".
        console.error("GET /element ERROR - url:", req.query.url);
        console.error("  message:", err.message);
        console.error("  cause:", err.cause);
        console.error("  stack:", err.stack);
        res.status(500).send(err.message + (err.cause ? ` - cause: ${err.cause}` : ""));
    }
});

router.put("/activate/:uuid", async (req, res) => {
    try {
        const response = await mse.activatePlaylist(req.params.uuid, req.query.studio, req.query.target);

        res
            .status(response.statusCode)
            .type("text/plain")
            .send(response.body);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

router.put("/deactivate/:uuid", async (req, res) => {
    try {
        const response = await mse.deactivatePlaylist(
            req.params.uuid,
            req.query.studio,
            req.query.target
        );

        res
            .status(response.statusCode)
            .type("text/plain")
            .send(response.body);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

router.post("/cleanup/:uuid", async (req, res) => {
    try {
        const response = await mse.cleanupPlaylist(req.params.uuid, req.query.studio, req.query.target);

        res
            .status(response.statusCode)
            .type("text/plain")
            .send(response.body);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

router.post("/take", async (req, res) => {
    try {
        const target = req.query.target === "preview" ? "preview" : "onair";
        console.log("MSE TAKE TARGET:", target, "studio=", req.query.studio || "config");
        const response = target === "preview"
            ? await mse.takeElementPreview(req.body, req.query.studio)
            : await mse.takeElement(req.body, req.query.studio);

        res
            .status(response.statusCode)
            .type("text/plain")
            .send(response.body);

    } catch (err) {
        res.status(500).send(err.message);
    }
});

router.post("/out", async (req, res) => {
    try {
        const response = await mse.takeOutElement(req.body, req.query.studio, req.query.target);

        res
            .status(response.statusCode)
            .type("text/plain")
            .send(response.body);

    } catch (err) {
        res.status(500).send(err.message);
    }
});


router.post("/director-reset", async (req, res) => {
    try {
        const [source, boxTypeRaw] = req.body.trim().split("|");
        const boxType = parseInt(boxTypeRaw, 10);

        console.log("DIRECTOR RESET:");
        console.log("source  =", source);
        console.log("boxType =", boxType);

        // FILTER
        if (source !== "director") {
            console.log("DIRECTOR RESET IGNORED:", source);

            return res.json({
                ok: false,
                ignored: true,
                source
            });
        }

        if (Number.isNaN(boxType)) {
            return res.status(400).json({
                ok: false,
                error: "Invalid boxType"
            });
        }

        const resetCommand =
            `-1 MAIN_SCENE*TREE*$SCRIPT*SCRIPT INVOKE msg_director_take ${boxType}`;

        console.log("DIRECTOR RESET COMMAND:", resetCommand);

        // Loopback call to this same process (127.0.0.1:9091 = this server's own
        // port, always local — that part is fine as-is). What must NOT be
        // hardcoded is which Engine the command goes to: pass studio through so
        // /vizsend resolves that studio's own engine.host/port from its config
        // instead of a fixed Engine host/port. (The old host=/port= query params
        // here were never actually read by /vizsend, so dropping them changes
        // nothing behaviorally.)
        const studio = req.query.studio;
        const studioQuery = studio ? `&studio=${encodeURIComponent(studio)}` : "";

        await fetch(
            `http://127.0.0.1:9091/vizsend?cmd=${encodeURIComponent(resetCommand)}${studioQuery}`
        );

        // Two-way now: the above only resyncs Viz Engine's own reorder script
        // state (msg_director_take) - it never told this app's browser tab(s)
        // that Director just took something, so their local
        // currentLayoutData/onAirLayoutData/layoutEdited state could silently
        // go stale or, worse, an operator's own in-progress relayout could
        // get taken instead of what Director actually put on air.
        //
        // Loop back into /preview with the same minimal payload shape the
        // playlist-thumbnail click already uses (extractLayoutFromPayload()
        // only needs setBoxes - elementId is optional, and there isn't one
        // here since this is a reset to a plain boxType, not a specific
        // element). That reuses every existing piece of the preview pipeline
        // as-is: SSE broadcast to this studio's tab(s)
        // (previewEvents.onmessage resets originalLayoutData/currentLayoutData
        // and clears layoutEdited, exactly as it should for a fresh
        // Director-driven base layout), the studio scoping, and the
        // director.enabled gate - instead of duplicating any of that here.
        //
        // Best-effort: a failure here must not fail the response Viz Trio is
        // waiting on for the (already-sent) msg_director_take command above.
        try {
            const previewPayload =
                `<payload><field name="source"><value>director</value></field>` +
                `<field name="setBoxes"><value>${boxType}</value></field></payload>`;

            await fetch(`http://127.0.0.1:9091/preview${studio ? `?studio=${encodeURIComponent(studio)}` : ""}`, {
                method: "POST",
                headers: { "Content-Type": "application/xml" },
                body: previewPayload
            });
        } catch (err) {
            console.error("DIRECTOR RESET -> PREVIEW BROADCAST ERROR:", err);
        }

        res.json({
            ok: true,
            source,
            boxType
        });

    } catch (err) {
        console.error("DIRECTOR RESET ERROR:", err);

        res.status(500).json({
            ok: false,
            error: err.message
        });
    }
});

// Fired by Viz Trio (Director) right on TAKE, from a dedicated env - see
// exectake.txt's send_elementid, body "director|<element ref>". This exists
// because /director-reset (msg_director_take) only resyncs Viz Engine's own
// script state; the browser side has its own separate notion of "what was
// last taken" (lastTakenElementId, compared against selectedElementId in
// takeElement()'s isSameElement check) which only this app's own TAKE clicks
// ever updated - so it silently went stale the moment Director took
// something on its own. This route closes that gap by pushing the element
// reference to the browser too, via the same /preview SSE pipeline the
// playlist-thumbnail click already uses.
router.post("/send_elementid", async (req, res) => {
    try {
        const [source, elementId] = req.body.trim().split("|");

        console.log("SEND ELEMENTID:");
        console.log("source    =", source);
        console.log("elementId =", elementId);

        if (source !== "director") {
            console.log("SEND ELEMENTID IGNORED:", source);

            return res.json({
                ok: false,
                ignored: true,
                source
            });
        }

        if (!elementId) {
            return res.status(400).json({
                ok: false,
                error: "Missing elementId"
            });
        }

        const studio = req.query.studio;
        const studioQuery = studio ? `?studio=${encodeURIComponent(studio)}` : "";

        // "directorElementId", not "elementId": this is Director's own bare
        // element id (Trio's <var>element</var>), a completely different id
        // space than the elementId this app uses everywhere else (an MSE
        // resource href, e.g. .../elements/{ID} - see extractLayoutFromPayload()
        // and takeElementMSE(), which sends it straight through as the
        // TAKE/OUT request body). Naming it "elementId" here would make
        // extractLayoutFromPayload() write this bare id into
        // selectedElementId as a side effect and corrupt every future
        // TAKE/OUT call from this app until a real thumbnail is clicked
        // again. previewEvents.onmessage (index-horizontal.html) reads this
        // distinct field name specifically to avoid that - it updates
        // lastTakenElementId only, and takeElement()'s isSameElement check
        // compares the two id spaces by checking whether selectedElementId's
        // URL ends in "/" + this bare id.
        const previewPayload =
            `<payload><field name="source"><value>director</value></field>` +
            `<field name="directorElementId"><value>${elementId}</value></field></payload>`;

        await fetch(`http://127.0.0.1:9091/preview${studioQuery}`, {
            method: "POST",
            headers: { "Content-Type": "application/xml" },
            body: previewPayload
        });

        res.json({
            ok: true,
            source,
            elementId
        });

    } catch (err) {
        console.error("SEND ELEMENTID ERROR:", err);

        res.status(500).json({
            ok: false,
            error: err.message
        });
    }
});

module.exports = router;