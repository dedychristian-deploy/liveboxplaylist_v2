const path = require("path");

// Resolves the config file for a given studio name, e.g. resolveConfigPath("STD5")
// -> <repo root>/STD5.json. No studio (undefined/empty) -> config.json (default studio).
//
// NOTE: this is intentionally a pure/stateless function (studio -> path), not a
// setConfigPath()/getConfigPath() pair backed by shared module state. The server
// handles multiple studios concurrently in one process, so a shared mutable
// "current config path" would race between concurrent requests for different
// studios. Every caller must pass the studio explicitly per request.
function resolveConfigPath(studio) {
    const raw = (studio || "config").toString().trim() || "config";
    // studio comes from an HTTP query param (?studio=...): restrict to safe
    // filename characters so it can never escape the repo root (e.g. "../../x").
    const safeName = raw.replace(/[^a-zA-Z0-9_-]/g, "") || "config";
    return path.join(__dirname, `${safeName}.json`);
}

module.exports = {
    resolveConfigPath
};
