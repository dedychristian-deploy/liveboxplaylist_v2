
const cors = require('cors');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');

//socket
const net = require("net");
const http = require("http");
const { sendVizCommand } = require("./services/command");
const mseRoutes = require("./mseservice/routes");
const { resolveConfigPath } = require("./config-path");


const app = express();
const port = 9091;

const DEFAULT_CONFIG = {
  mse: { host: "10.202.13.133", port: 8580, protocol: "http", profile: "LIVEBOXES", profilepreview: "PREVIEW" },
  pilotserver: { host: "10.202.13.133", port: 8177 },
  engine: { host: "10.202.13.192", port: 6100 },
  enginepreview: { host: "10.202.13.133", port: 6200 },
  playlist: { playlistid: "{26BB3B5A-5A8D-41EB-A109-CBD466C06241}" },
  template: { templateid: "10467" },
  director: { enabled: false },
  interaction: { mode: "desktop" }
};

// Multi-studio config: one process serves every studio, selected per-request
// via ?studio=<name> (see config-path.js). "config" (i.e. no ?studio=) is the
// default studio and keeps reading config.json exactly as before, so existing
// single-studio deployments/URLs are unaffected.
function loadConfigFor(studio) {
  const configPath = resolveConfigPath(studio);
  try {
    if (!fs.existsSync(configPath)) {
      fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf8");
      return structuredClone(DEFAULT_CONFIG);
    }
    const stored = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return {
      ...DEFAULT_CONFIG,
      ...stored,
      mse: { ...DEFAULT_CONFIG.mse, ...stored.mse },
      engine: { ...DEFAULT_CONFIG.engine, ...stored.engine },
      enginepreview: { ...DEFAULT_CONFIG.enginepreview, ...stored.enginepreview },
      pilotserver: { ...DEFAULT_CONFIG.pilotserver, ...stored.pilotserver },
      playlist: { ...DEFAULT_CONFIG.playlist, ...stored.playlist },
      template: { ...DEFAULT_CONFIG.template, ...stored.template },
      director: { ...DEFAULT_CONFIG.director, ...stored.director },
      interaction: { ...DEFAULT_CONFIG.interaction, ...stored.interaction }
    };
  } catch (err) {
    console.error(`CONFIG LOAD ERROR [studio=${studio || "config"}]:`, err.message);
    return structuredClone(DEFAULT_CONFIG);
  }
}

// Per-studio connection status (MSE/Engine health is different per studio).
const connectionStatusByStudio = new Map();
// Studios that have been seen at least once, so the periodic health-check
// loop knows which studios to poll without hardcoding a studio list.
const knownStudios = new Set(["config"]);

function studioKey(studio) {
  return studio || "config";
}

function noteStudio(studio) {
  knownStudios.add(studioKey(studio));
}

function getStatusFor(studio) {
  return connectionStatusByStudio.get(studioKey(studio)) || {
    mse: false,
    engine: false,
    previewEngine: false,
    lastCheck: null
  };
}

function checkTcp(host, port, timeout = 1200) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host, port: Number(port) });
    let done = false;
    const finish = ok => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeout);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function checkHttp(host, port, timeout = 1500) {
  return new Promise(resolve => {
    const req = http.get({ host, port: Number(port), path: "/", timeout }, res => {
      res.resume();
      resolve(true);
    });
    req.once("timeout", () => { req.destroy(); resolve(false); });
    req.once("error", () => resolve(false));
  });
}

async function checkConnectionsFor(studio) {
  const cfg = loadConfigFor(studio);
  const [mse, engine, previewEngine] = await Promise.all([
    checkHttp(cfg.mse.host, cfg.mse.port),
    checkTcp(cfg.engine.host, cfg.engine.port),
    checkTcp(cfg.enginepreview.host, cfg.enginepreview.port)
  ]);
  const status = { mse, engine, previewEngine, lastCheck: new Date().toISOString() };
  connectionStatusByStudio.set(studioKey(studio), status);
  return status;
}

async function checkAllKnownConnections() {
  for (const studio of knownStudios) {
    await checkConnectionsFor(studio);
  }
}

setInterval(checkAllKnownConnections, 300000);
setTimeout(checkAllKnownConnections, 100);

const BASE_DIR = "K:";//====================
const BASE_DIR_FLOWICS = "B:/Flowics";//====
const TXT_DIR = path.join(BASE_DIR, "CDD/TEMP/TXT");//====


// bypass cors
app.use(cors());
app.use(express.json());
app.use(express.text());

app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
});

app.use("/template_images", express.static(path.join(__dirname, "template_images")));
app.use("/images", express.static(path.join(__dirname, "images")));
//app.use("/datareader/flowics", express.static(BASE_DIR_FLOWICS));//========
//app.use("/datareader/viz", express.static(BASE_DIR));//====================
app.use(['/datareader/flowics','/flowics'], express.static(BASE_DIR_FLOWICS));//========
app.use(['/datareader/viz','/viz'], express.static(BASE_DIR));//====================

// Middleware for statis file (project)
app.use('/html_library', express.static(path.join(__dirname, 'html_library')));
// Middleware for statis file
app.use('/files', express.static(BASE_DIR));
// Middleware for statis file (*.txt)
app.use('/txt', express.static(TXT_DIR));
// Middleware for statis file (*.xml)
app.use('/flowics_ajm', express.static(BASE_DIR_FLOWICS));

//app.use("/mse", mseRoutes);
app.use("/api", mseRoutes);


/* ====================== SETTINGS / STATUS ========================= */
// Every endpoint below is studio-scoped via ?studio=<name>. No ?studio= means
// the default studio (config.json) - existing single-studio callers keep
// working unchanged.
app.get("/api/settings", (req, res) => {
  noteStudio(req.query.studio);
  res.json(loadConfigFor(req.query.studio));
});

app.put("/api/settings", (req, res) => {
  const studio = req.query.studio;
  const body = req.body || {};
  // Partial updates: any field the caller doesn't send (e.g. the playlist
  // picker only sends { playlist: { playlistid } }) falls back to whatever
  // is already on disk instead of getting wiped to "" / NaN.
  const existing = loadConfigFor(studio);
  const next = {
    mse: {
      host: String(body.mse?.host || existing.mse?.host || "").trim(),
      port: Number(body.mse?.port || existing.mse?.port),
      // Not exposed in the Settings UI yet - preserved from whatever's
      // already stored (or "http" default) so saving Settings never wipes
      // out a manually-set "https" here.
      protocol: String(body.mse?.protocol || existing.mse?.protocol || "http").trim() || "http",
      profile: String(body.mse?.profile || existing.mse?.profile || "default").trim() || "default",
      profilepreview: String(body.mse?.profilepreview || existing.mse?.profilepreview || "PREVIEW").trim() || "PREVIEW"
    },
    engine: {
      host: String(body.engine?.host || existing.engine?.host || "").trim(),
      port: Number(body.engine?.port || existing.engine?.port)
    },
    enginepreview: {
      host: String(body.enginepreview?.host || existing.enginepreview?.host || existing.engine?.host || "").trim(),
      port: Number(body.enginepreview?.port || existing.enginepreview?.port || existing.engine?.port)
    },

        pilotserver: {
      host: String(body.pilotserver?.host || existing.pilotserver?.host || "").trim(),
      port: Number(body.pilotserver?.port || existing.pilotserver?.port)
    },
    playlist: {
      playlistid: String(body.playlist?.playlistid || existing.playlist?.playlistid || "").trim()
    },
    template: {
      templateid: String(body.template?.templateid || existing.template?.templateid || "").trim()
    },
    director: {
      enabled: body.director ? body.director.enabled !== false : existing.director?.enabled !== false
    },
    interaction: {
      mode: body.interaction?.mode
        ? (body.interaction.mode === "touchscreen" ? "touchscreen" : "desktop")
        : (existing.interaction?.mode === "touchscreen" ? "touchscreen" : "desktop")
    }
  };
  if (!next.mse.host || !next.engine.host || !next.enginepreview.host ||
      !Number.isInteger(next.mse.port) || !Number.isInteger(next.engine.port) ||
      !Number.isInteger(next.enginepreview.port)) {
    return res.status(400).json({ ok: false, error: "Invalid settings" });
  }
  fs.writeFileSync(resolveConfigPath(studio), JSON.stringify(next, null, 2), "utf8");
  noteStudio(studio);
  checkConnectionsFor(studio);
  res.json({ ok: true, settings: next });
});

app.get("/api/status", async (req, res) => {
  const studio = req.query.studio;
  noteStudio(studio);
  if (!connectionStatusByStudio.has(studioKey(studio))) {
    await checkConnectionsFor(studio);
  }
  const cfg = loadConfigFor(studio);
  const status = getStatusFor(studio);
  res.json({
    mse: { connected: status.mse, host: cfg.mse.host, port: cfg.mse.port },
    engine: { connected: status.engine, host: cfg.engine.host, port: cfg.engine.port },
    previewEngine: {
      connected: status.previewEngine,
      host: cfg.enginepreview.host,
      port: cfg.enginepreview.port
    },
    profile: cfg.mse.profile,
    profilePreview: cfg.mse.profilepreview,
    lastCheck: status.lastCheck
  });
});

app.post("/api/reconnect", async (req, res) => {
  const studio = req.query.studio;
  noteStudio(studio);
  const status = await checkConnectionsFor(studio);
  res.json({ ok: true, status });
});

/* ======================  PREVIEW RECEIVER  ======================== */

// Each SSE client is tagged with the studio it connected for, so a payload
// received for one studio is never broadcast to another studio's frontend.
let previewClients = [];

// Whichever studio's tab most recently opened /preview-events. Trio env
// scripts (executionlogic.xml, exectake.txt) are static XML - they have no
// way to know which studio the operator currently has open in the browser,
// so they never send ?studio= at all. Rather than editing those scripts
// per studio (or per switch), /preview below falls back to this when no
// studio is given, so a single Trio script keeps working no matter which
// studio tab is actually open right now. Explicit ?studio= callers (the
// browser's own withStudio() calls) are unaffected - this is only a
// fallback for the "unspecified" case.
let activeStudio = null;

app.get("/preview-events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const studio = studioKey(req.query.studio);
  activeStudio = studio;
  previewClients.push({ studio, res });

  req.on("close", () => {
    previewClients = previewClients.filter(client => client.res !== res);
  });
});

function broadcastPayload(payload, studio) {
  const message = JSON.stringify(payload);
  const target = studioKey(studio);

  for (const client of previewClients) {
    if (client.studio === target) {
      client.res.write(`data: ${message}\n\n`);
    }
  }
}

app.post("/preview", express.text({ type: "*/*", limit: "10mb" }), (req, res) => {
  const payload = req.body;

  if (!payload || typeof payload !== "string") {
    return res.status(400).send("Payload required");
  }

  // No ?studio= (any Trio-originated payload - READ, director_reset,
  // send_elementid all POST here without one) -> target whichever studio
  // most recently opened /preview-events, instead of always the "config"
  // default. See activeStudio above.
  const studio = req.query.studio || activeStudio;
  noteStudio(studio);

  const sourceMatch = payload.match(/<field\s+name=["\']source["\'][^>]*>\s*<value>\s*([^<]+?)\s*<\/value>/i);
  const source = sourceMatch ? sourceMatch[1].trim().toLowerCase() : "local";

  console.log("PAYLOAD RECEIVED", `source=${source}`, `studio=${studioKey(studio)}`);
  console.log(payload);

  const cfg = loadConfigFor(studio);
  if (source === "director" && cfg.director?.enabled === false) {
    console.log("DIRECTOR PAYLOAD BLOCKED");
    return res.status(204).end();
  }

  broadcastPayload(payload, studio);

  res.status(200).send("OK");
});

/* ================================================================== */

// Main Route
app.get('/', (req, res) => {
  res.send('Hello, This server for Pilot Edge Test!');
});

app.get("/mse", (req, res) => {
  res.sendFile(path.join(__dirname, "html_files/index-horizontal.html"));
});

app.get("/liveboxes", (req, res) => {
  res.sendFile(path.join(__dirname, "html_files/index-horizontal.html"));
});


app.use("/layouts",express.static(path.join(__dirname, "html_files/layouts")));

//endpoint for *.txt file path
app.get('/get-txt-files', (req, res) => {
  const folderPath = TXT_DIR;
  fs.readdir(folderPath, (err, files) => {
    if (err) {
      return res.status(500).send('Error reading the directory');
    }

    // Filter only for *.txt file 
    const txtFiles = files.filter(file => file.endsWith('.txt'));
    res.json(txtFiles);
  });
});

//endpoint for *.xml file path
app.get('/get-xml-files', (req, res) => {
  const folderPath = BASE_DIR_FLOWICS;
  fs.readdir(folderPath, (err, files) => {
    if (err) {
      return res.status(500).send('Error reading the directory');
    }

    // Filter only for *.txt file 
    const xmlFiles = files.filter(file => file.endsWith('.xml'));
    res.json(xmlFiles);
  });
});


/* ================================================================== */

//endpoint for get list in the folder K:/CDD or BASE_DIR
app.get("/list", (req, res) => {
  try {
    const relPath = req.query.path || "";
    const type = req.query.type || "folder";

    const dir = path.join(BASE_DIR, relPath);

    const resolvedBase = path.resolve(BASE_DIR);
    const resolvedDir = path.resolve(dir);

    if (!resolvedDir.startsWith(resolvedBase)) {
      return res.status(403).json({ error: "Access denied" });
    }

    const items = fs.readdirSync(dir, { withFileTypes: true });

    let result;

    if (type === "file") {
      result = items
        .filter(i => i.isFile())
        .map(i => i.name);
    } else {
      result = items
        .filter(i => i.isDirectory())
        .map(i => i.name);
    }

    res.json(result);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//write utf8
app.post("/write", (req, res) => {
  try {
    const { fileName, content } = req.body;

    if (!fileName) {
      return res.status(400).json({ error: "fileName required" });
    }

    const fullPath = path.join(BASE_DIR, fileName);
    if (!path.resolve(fullPath).startsWith(path.resolve(BASE_DIR))) {
      return res.status(403).json({ error: "Access denied" });
    }
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, content || "", "utf8");
    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//read utf8??
app.post("/read", (req, res) => {
  try {
    const { fileName } = req.body;

    if (!fileName) {
      return res.status(400).json({ error: "fileName required" });
    }
    const fullPath = path.join(BASE_DIR, fileName);
    if (!path.resolve(fullPath).startsWith(path.resolve(BASE_DIR))) {
      return res.status(403).json({ error: "Access denied" });
    }
    const content = fs.readFileSync(fullPath, "utf8");
    res.json({ success: true, data: content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/template-config", (req, res) => {
    try {
        const file = path.join(__dirname, "template-config.json");
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// List of aux stream URLs (MediaMTX/RTMP playback endpoints), one per
// Input Sources slot (input01 -> aux[0], input02 -> aux[1], ...). Not
// per-studio - same physical aux feeds for every studio, edit aux-config.json
// directly to remap an input to a different aux stream.
app.get("/api/aux-config", (req, res) => {
    try {
        const file = path.join(__dirname, "aux-config.json");
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Lookup table for the SelectType_Box_XX code stored on each MSE element
// (e.g. "0" -> "Live Locator") - used to build the box label text
// client-side. Not per-studio - same fixed set of codes everywhere, edit
// selectiontype.json directly to change a label.
app.get("/api/selection-types", (req, res) => {
    try {
        const file = path.join(__dirname, "selectiontype.json");
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Viz scene tree paths used by the TOGGLE_BOX_XX (Source Panel drag-drop)
// commands - scenePath (TOGGLE_BOX_XX SHOW/switch targets) and
// geomBasePath (FF_TAGxx geometry lookups). Not per-studio - same scene
// everywhere, edit scene-config.json directly if the template's own tree
// layout ever changes instead of hardcoding it in the client.
app.get("/api/scene-config", (req, res) => {
    try {
        const file = path.join(__dirname, "scene-config.json");
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
/* ================================================================== */

/* ======================  VIZ COMMAND  ============================= */

app.get("/vizsend", async (req, res) => {
  const { cmd } = req.query;
  if (!cmd) {
    return res.json({ ok: false, error: "MISSING_PARAM" });
  }
  try {
    // Engine host/port come from the requested studio's own config, not a
    // fixed default - each studio can point at its own Viz Engine.
    const cfg = loadConfigFor(req.query.studio);
    const target = req.query.target === "preview" ? "preview" : "onair";
    const engine = target === "preview" ? cfg.enginepreview : cfg.engine;
    const decodedCmd = decodeURIComponent(cmd);
    console.log(`VIZSEND [${target}] -> ${engine.host}:${engine.port} CMD:`, decodedCmd);
    const response = await sendVizCommand(
      engine.host,
      engine.port,
      decodedCmd
    );
    console.log(`VIZSEND [${target}] RESPONSE:`, response);
    res.json({ ok: true, response });
  } catch (err) {
    console.error(`VIZSEND [${req.query.target === "preview" ? "preview" : "onair"}] ERROR:`, err.message);
    res.json({ ok: false, error: err.message });
  }
});

app.post("/vizsend-batch", async (req, res) => {
  const { commands } = req.body;
  if (!commands || !Array.isArray(commands)) {
    return res.json({ ok: false, error: "MISSING_COMMANDS_ARRAY" });
  }
  try {
    const cfg = loadConfigFor(req.query.studio);
    const target = req.query.target === "preview" ? "preview" : "onair";
    const engine = target === "preview" ? cfg.enginepreview : cfg.engine;

    console.log(`VIZSEND-BATCH [${target}] -> ${engine.host}:${engine.port} (${commands.length} commands)`);

    const t0 = Date.now();
    const responses = [];
    for (const cmd of commands) {
      const response = await sendVizCommand(engine.host, engine.port, cmd);
      responses.push(response);
    }

    console.log(`VIZSEND-BATCH [${target}] DONE in ${Date.now() - t0}ms`);
    res.json({ ok: true, responses });
  } catch (err) {
    console.error(`VIZSEND-BATCH [${req.query.target === "preview" ? "preview" : "onair"}] ERROR:`, err.message);
    res.json({ ok: false, error: err.message });
  }
});

/* ================================================================== */

/* ======================  DATA READER  ============================= */

function createList(route, baseDir) {
  // ROOT LIST 
  app.get(`/${route}/list`, (req, res) => {
    handleList("", req, res, baseDir, route);
  });
  // SUBFOLDER LIST 
  app.get(`/${route}/list/*`, (req, res) => {
    handleList(req.params[0] || "", req, res, baseDir, route);
  });
}

function handleList(sub, req, res, baseDir, route) {

  const ext = req.query.ext;
  const target = path.join(baseDir, sub);
  if (!path.resolve(target).startsWith(path.resolve(baseDir))) {
    return res.status(403).json({ error: "Access denied" });
  }
  fs.readdir(target, { withFileTypes: true }, (err, items) => {
    if (err) return res.status(404).json({ error: "Folder not found" });
    let result = items.map(i => ({
      name: i.name,
      type: i.isDirectory() ? "folder" : "file",
      url: i.isDirectory()
        ? `/list/${sub ? sub + "/" : ""}${i.name}`
        : `/${sub ? sub + "/" : ""}${i.name}`


        //? `/${route}/list/${sub ? sub + "/" : ""}${i.name}`
        //: `/${route}/${sub ? sub + "/" : ""}${i.name}`
    }));
    if (ext) {
      result = result.filter(r =>
        r.type === "file" && r.name.endsWith(ext)
      );
    }
    res.json(result);
  });
}

function createWrite(route, baseDir) {
  app.post(`/${route}/write`, (req, res) => {
    
    const { filePath, content } = req.body;
    if (!filePath) return res.status(400).json({ error: "filePath required" });
    const full = path.join(baseDir, filePath);
    if (!path.resolve(full).startsWith(path.resolve(baseDir))) {
      return res.status(403).json({ error: "Access denied" });
    }
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFile(full, content || "", "utf8", err => {
      if (err) return res.status(500).json({ error: "Write failed" });
      res.json({ success: true });
    });
  });
}
createList("flowics", BASE_DIR_FLOWICS);
createList("viz", BASE_DIR);

createWrite("flowics", BASE_DIR_FLOWICS);
createWrite("viz", BASE_DIR);
/* ================================================================== */

// Running server
app.listen(port, () => {
  console.log(`Server running on http://0.0.0.0:${port}`);
});
