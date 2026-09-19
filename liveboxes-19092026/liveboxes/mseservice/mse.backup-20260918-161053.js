const fs = require("fs");
const { resolveConfigPath } = require("../config-path");

function getConfig(studio) {
    return JSON.parse(fs.readFileSync(resolveConfigPath(studio), "utf8"));
}

function getMseConfig(studio, target = "onair") {
    const config = getConfig(studio);

    const MSE_HOST = config.mse.host;
    const MSE_PORT = config.mse.port;
    const MSE_PROFILE = target === "preview"
        ? (config.mse.profilepreview || config.mse.profile)
        : config.mse.profile;
    // MSE_PROTOCOL is configurable (config.mse.protocol) - defaults to
    // "http" so existing deployments that never set it keep working
    // unchanged. Without this, every MSE call (playlists, elements,
    // activate, take/out) was hardcoded to http:// and would silently
    // fail (connection refused/reset, or a protocol-mismatch response)
    // against an MSE server that actually requires https.
    const MSE_PROTOCOL = config.mse.protocol || "http";
    const MSE_URL = `${MSE_PROTOCOL}://${MSE_HOST}:${MSE_PORT}`;
    const PLAYLIST_ID = config.playlist.playlistid;

    return {
        MSE_HOST,
        MSE_PORT,
        MSE_PROFILE,
        MSE_URL,
        PLAYLIST_ID
    };
}

async function request(url, options = {}) {
    // Checked against the ACTUAL url being fetched, not config.mse.protocol -
    // getElement(url) in particular fetches an absolute URL that comes
    // straight from an MSE atom feed <link href="...">, which can point at
    // a completely different host/scheme (e.g. a separate https-only
    // endpoint for element payloads) than the plain config.mse.host/port
    // used to build MSE_URL for the playlist/element LIST calls. Gating
    // only on config.mse.protocol missed this case entirely: the list
    // fetch (http, per config) would succeed while every per-element fetch
    // (https href, self-signed cert) 500'd with no useful error. Same
    // whole-process TLS bypass tradeoff as before (see getMseConfig) -
    // just triggered by whichever URL actually needs it.
    if (url.startsWith("https:")) {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    }
    const response = await fetch(url, options);
    const body = await response.text();
    console.log("MSE REQUEST:", options.method || "GET", url, "STATUS:", response.status);
    console.log("MSE RESPONSE:", body);

    return {
        statusCode: response.status,
        body
    };
}

function getPlaylists(studio, target = "onair") {
    const { MSE_URL } = getMseConfig(studio, target);

    return request(`${MSE_URL}/directory/playlists/`, {
        method: "GET",
        headers: {
            Accept: "application/atom+xml"
        }
    });
}

async function getPlaylistActivation(studio, target = "onair") {
    const { MSE_URL, PLAYLIST_ID } = getMseConfig(studio, target);

    const response = await request(
        `${MSE_URL}/activation/storage/playlists/${PLAYLIST_ID}`,
        {
            method: "GET",
            headers: {
                Accept: "application/vnd.vizrt.playlistactivation+xml"
            }
        }
    );

    return {
        ...response,
        playlistId: PLAYLIST_ID
    };
}

function getElements(path, studio, target = "onair") {
    const { MSE_URL } = getMseConfig(studio, target);

    return request(`${MSE_URL}${path}`, {
        method: "GET",
        headers: {
            Accept: "application/atom+xml"
        }
    });
}

function getElement(url) {
    return request(url, {
        method: "GET",
        headers: {
            Accept: "application/vnd.vizrt.payload+xml"
        }
    });
}

function activatePlaylist(uuid, studio, target = "onair") {
    const { MSE_URL, MSE_PROFILE } = getMseConfig(studio, target);

    const body = `<playlistactivation>
  <active_on_profile>${MSE_URL}/profiles/${MSE_PROFILE}</active_on_profile>
</playlistactivation>`;

    return request(`${MSE_URL}/activation/storage/playlists/${uuid}`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/vnd.vizrt.playlistactivation+xml"
        },
        body
    });
}

function deactivatePlaylist(uuid, studio, target = "onair") {
    const { MSE_URL } = getMseConfig(studio, target);

    return request(`${MSE_URL}/activation/storage/playlists/${uuid}`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/vnd.vizrt.playlistactivation+xml"
        },
        body: "<playlistactivation/>"
    });
}

function cleanupPlaylist(uuid, studio, target = "onair") {
    const { MSE_URL, MSE_PROFILE } = getMseConfig(studio, target);

    return request(`${MSE_URL}/profiles/${MSE_PROFILE}/cleanup`, {
        method: "POST",
        headers: {
            "Content-Type": "text/plain"
        },
        body: `/element_collection/storage/playlists/${uuid}`
    });
}

function takeElementForProfile(elementUrl, studio, target) {
    const { MSE_URL, MSE_PROFILE } = getMseConfig(studio, target);
    console.log("MSE TAKE PROFILE:", MSE_PROFILE, "target=", target);

    return request(`${MSE_URL}/profiles/${MSE_PROFILE}/continue`, {
        method: "POST",
        headers: {
            "Content-Type": "text/plain"
        },
        body: elementUrl
    });
}

function takeElement(elementUrl, studio) {
    return takeElementForProfile(elementUrl, studio, "onair");
}

function takeElementPreview(elementUrl, studio) {
    return takeElementForProfile(elementUrl, studio, "preview");
}

function takeOutElement(elementUrl, studio, target = "onair") {
    const { MSE_URL, MSE_PROFILE } = getMseConfig(studio, target);

    return request(`${MSE_URL}/profiles/${MSE_PROFILE}/out`, {
        method: "POST",
        headers: {
            "Content-Type": "text/plain"
        },
        body: elementUrl
    });
}

module.exports = {
    getPlaylists,
    getPlaylistActivation,
    getElements,
    getElement,
    activatePlaylist,
    deactivatePlaylist,
    cleanupPlaylist,
    takeElement,
    takeElementPreview,
    takeOutElement
};
