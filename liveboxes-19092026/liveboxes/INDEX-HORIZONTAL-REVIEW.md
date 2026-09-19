# Code Review — `html_files/index-horizontal.html`

Review-only document. No code was changed to produce this — see file/line
references throughout to verify against the live file.

## 1. What this page is

Single-page operator console ("Pilot Edge") for driving a Viz Engine output
through box-layout templates fed by live camera/RTMP inputs. One process
(`server.js`) serves it and can host multiple **studios** (`?studio=NAME` in
the URL — see `withStudio()`, [index-horizontal.html:2616-2620](html_files/index-horizontal.html#L2616-L2620)),
each with its own config, MSE connection and Engine connection.

It talks to three different backends:
- **MSE** (Media Sequencer Engine) via the `/api/*` routes in
  `mseservice/routes.js` (playlists, elements, take/out/cleanup/activate).
- **Viz Engine** via `sendVizCommand()` → `GET /vizsend` → `services/command.js`
  → a raw TCP command socket. This is how box layout/order changes are
  actually pushed into the running Viz scene (see §5).
- **MediaMTX** (the `aux1..aux8` HTTP endpoints) for the live camera/RTMP
  preview feeds shown in Input Sources and the persistent preview boxes.

## 2. Page layout (what's on screen)

- **Preview panel** (`#layoutPreview` + persistent A/B banks) — shows the
  layout that will go on air next.
- **On Air panel** (`#onAirPreviewA/B` + persistent A/B banks) — what's
  actually live.
- **Control panel** — BACK / TAKE / OUT / CLEAN UP / RELOAD PLAYLIST buttons.
- **Input Sources panel** — 8 iframes (`#input01`-`#input08`), one per aux
  camera feed.
- **Data Element List panel** (`#templateStrip`) — playlist elements pulled
  from MSE, click one to preview it.
- **Settings modal**, **Playlist picker modal**, **Quick Zoom overlay**.

## 3. Global state

| Variable | Holds |
|---|---|
| `currentLayoutData` | The layout being edited/previewed right now (`{boxType, boxTypeName, boxOrder}`) |
| `originalLayoutData` | Snapshot of the layout as it arrived from MSE, before any drag/delete edits — restored by BACK |
| `onAirLayoutData` | The layout currently on air |
| `layoutEdited` | True once the operator drags/deletes a box in `currentLayoutData` |
| `selectedElementId` / `lastTakenElementId` | Which MSE element is selected vs. what was last actually taken (drives the "same element / different element" branching in `takeElement()`) |
| `boxLayouts` | Static list of the 19 known layouts (name ↔ index ↔ box count), [index-horizontal.html:2642-2662](html_files/index-horizontal.html#L2642-L2662) |
| `persistentLayoutNames` | Set of layout names that use the cached AUX1-12 box system (see §4) — **currently identical to all 19 `boxLayouts` names**, see finding F1 |
| `templateConfig` / `auxConfig` | Fetched once from `/api/template-config` and `/api/aux-config` |
| `playlistElements` | Cards rendered into the Data Element List panel |

## 4. The "persistent AUX" preview system

This is the central piece of logic in the file, and it's deliberately
unusual, so it's worth calling out on its own.

Instead of creating a new `<iframe>`/`<img>` per camera every time the
layout changes, **12 source boxes are created once at startup** per stage
(Preview A, Preview B, On Air A, On Air B, Quick Zoom) and never destroyed:

- `initTruePersistent2BoxStage()` ([index-horizontal.html:3032-3045](html_files/index-horizontal.html#L3032-L3045)) —
  guarded by `stage.dataset.ready === "1"`, only ever runs its creation loop
  once per stage.
- `createPersistentInput()` ([index-horizontal.html:2918-3030](html_files/index-horizontal.html#L2918-L3030)) —
  also self-guards via `stage.querySelector('.p2-box[data-input="N"]')`, so
  it never recreates a box that already exists.
- Explicit comments state the intent: *"Every persistent stage gets
  AUX1-AUX12 once at app startup. No source is created during an operator
  action."* ([index-horizontal.html:3036-3038](html_files/index-horizontal.html#L3036-L3038), [3280-3281](html_files/index-horizontal.html#L3280-L3281), [3300](html_files/index-horizontal.html#L3300)).

Switching layouts (`renderTruePersistent2Box()`,
[index-horizontal.html:3198-3278](html_files/index-horizontal.html#L3198-L3278)) never touches `.src` on these
boxes — it only repositions them (`grid-column`/`grid-row`), toggles the
`p2-hidden` class, and updates the label text. On Air / Preview use A/B bank
pairs so a layout switch can cross-dissolve (old bank fades out while the new
one, already fully rendered, fades in).

Right now the stream element is `<img src="/images/liveN.png">` (a static
placeholder), not a live feed — the live-iframe version
(`stream.src = auxConfig[input]`) is present but intentionally commented out
([index-horizontal.html:2926-2935](html_files/index-horizontal.html#L2926-L2935)), per earlier discussion, because
turning all persistent boxes (up to 12 live per stage × 5 stages) into live
MediaMTX iframes at once was judged too heavy. The Input Sources panel
(`#input01`-`#input08`) is the one place meant to show the real live feed,
via `applyAuxSources()` ([index-horizontal.html:4218-4223](html_files/index-horizontal.html#L4218-L4223)) — see finding F4.

## 5. Layout edit → Viz Engine round trip

Editing is local-first and only reaches Viz Engine on TAKE:

- **Drag one preview box onto another** → `dragstart`/`drop` handlers
  ([index-horizontal.html:2985-3025](html_files/index-horizontal.html#L2985-L3025)) → `postMessage({action:"swapBoxes",...})`
  → caught by the page's own `message` listener
  ([index-horizontal.html:3535-3557](html_files/index-horizontal.html#L3535-L3557)) → swaps the two boxes' `input`
  values in `currentLayoutData.boxOrder` (**positions don't move, only which
  camera feed is shown where**) → `layoutEdited = true` → re-renders via
  `showLayoutPreview()`.
- **Delete (×) a box** → `postMessage({action:"deleteBox",...})` → same
  listener ([index-horizontal.html:3559-3606](html_files/index-horizontal.html#L3559-L3606)) → removes it from
  `boxOrder`, renumbers the rest, re-resolves `boxTypeName` down a size
  (preserving the `_SP_V` family suffix if present) → `layoutEdited = true`.
- **TAKE** (`takeElement()`, [index-horizontal.html:3755-3969](html_files/index-horizontal.html#L3755-L3969)) branches on
  Quick Zoom / `layoutEdited` / same-vs-different element, and for an edited
  layout serializes `boxOrder` to a compact string (`"BOX_01:0,BOX_02:1,..."`)
  and calls, via `sendVizCommand()`:
  - `SCRIPT INVOKE msg_layout_edited <boxType>|<boxData>`
  - `SCRIPT INVOKE Execute` / `Execute2` (on `$BOX_LAYOUTS`)
  - or, for a fresh/non-edited element, `SCRIPT INVOKE reorder_clear <boxType>`

  These names match a Viz Artist script one-to-one — e.g. the `artist2.txt`
  snippet in this session's selection defines exactly
  `msg_layout_edited(dataLayout)`, `reorder_clear(boxType)`,
  `reorder_edited_fast(boxType, boxData)` and reads the same
  `"BOX_01:0,BOX_02:1"`-style string this file builds. That script is the
  server-side (Viz Engine) half of this feature: it reorders the actual
  `BOX_LAYOUTS` container children to match what the operator dragged in the
  browser.

## 6. Other flows (brief)

- **Startup** ([index-horizontal.html:4544-4552](html_files/index-horizontal.html#L4544-L4552)): load playlist elements,
  template config, aux config (currently disabled, see F4), then
  `reconnectServices()` (pings `/api/reconnect`, re-reads settings,
  activates the configured playlist) and starts a 130s status-poll interval.
- **Live preview push**: server-side `POST /preview` (from Director/local)
  broadcasts over SSE (`GET /preview-events`); this page's
  `previewEvents.onmessage` ([index-horizontal.html:3495-3525](html_files/index-horizontal.html#L3495-L3525)) treats every
  incoming payload as a brand-new base layout (resets `originalLayoutData`,
  clears `layoutEdited`) and calls `showLayoutPreview()`.
- **CLEAN UP** (`cleanUp()`, [index-horizontal.html:4066-4109](html_files/index-horizontal.html#L4066-L4109)) wipes the MSE
  playlist server-side and resets all local preview/on-air/selection state.
- **Quick Zoom** (`openPersistentQuickZoom()`/`closePersistentQuickZoom()`,
  [index-horizontal.html:3052-3125](html_files/index-horizontal.html#L3052-L3125)) — double-click a box to stage a
  temporary single-box (`1BOX`/`1BOX_SP`/`1BOX_SP_V`, matched to the source
  layout's family) TAKE of just that input, without disturbing
  `currentLayoutData`.
- **Settings / Playlist picker / Reconnect** — standard fetch-populate-modal
  → PUT-on-save pattern against `/api/settings`; nothing unusual.

## 7. Findings

Ranked by how confident/impactful each one is; none of these were fixed.

**F1 — The "non-persistent layout" fallback path looks unreachable.**
`persistentLayoutNames` ([index-horizontal.html:3190](html_files/index-horizontal.html#L3190)) lists exactly the
same 19 names as `boxLayouts` ([index-horizontal.html:2642-2662](html_files/index-horizontal.html#L2642-L2662)). Every
place that builds a layout object (`extractLayoutFromPayload`, the delete
handler, Quick Zoom's hardcoded targets) draws `boxTypeName` from
`boxLayouts` or a subset of it — so `data.boxTypeName` is always in
`persistentLayoutNames`. That means the `else` branches in
`showLayoutPreview()` ([index-horizontal.html:3357-3379](html_files/index-horizontal.html#L3357-L3379)) and
`showOnAirPreview()` ([index-horizontal.html:3445-3489](html_files/index-horizontal.html#L3445-L3489)) — which load
`/layouts/${boxTypeName}.html` into a plain iframe — appear to never run in
the current app. If so, the whole `html_files/layouts/*.html` per-layout
file set (each hardcoding its own `aux${input+1}` URLs) is now dead weight
from this page's perspective, kept alive only by that unreachable fallback.
Worth confirming deliberately before ever relying on or deleting either
side.

**F2 — Dead code: `sendToViz()` / `setBoxIndex()` / `sendBoxIndexCommands()`.**
Fully implemented ([index-horizontal.html:3622-3713](html_files/index-horizontal.html#L3622-L3713)) but nothing calls
`sendToViz()` — no `onclick`, no listener anywhere in the file. The only
trace of a UI hook is `#sendToVizButton` used purely as a CSS selector
(`::before` content rules at [index-horizontal.html:887](html_files/index-horizontal.html#L887) and
[1054](html_files/index-horizontal.html#L1054)) — there is no `<button id="sendToVizButton">` element in
the page. All three functions are unreachable.

**F3 — Unreachable branch inside `takeElement()`.**
The block commented `// NORMAL - DIFFERENT ELEMENT`
([index-horizontal.html:3917-3940](html_files/index-horizontal.html#L3917-L3940)) is guarded by
`if (!isSameElement)` — but the block immediately above it, `// DIFFERENT
ELEMENT - FRESH TAKE` ([index-horizontal.html:3879-3914](html_files/index-horizontal.html#L3879-L3914)), is guarded by
the exact same condition and always `return`s. So whenever `!isSameElement`
is true, execution never reaches the second block; it can only be dead code.

**F4 — `loadAuxConfig()` is currently disabled.**
`applyAuxSources()` (which sets `.src` on `#input01`-`#input08`) is only
ever called from `loadAuxConfig()`, and that call is commented out at the
one place it's referenced:
```
4547:            //loadAuxConfig();
```
As the file stands, `aux-config.json` is never fetched and the Input
Sources iframes never receive a `src` — they stay empty. (Flagged in this
session's earlier review too; noting it again here since it's still the
current state.)

**F5 — Duplicate `id="outButton"` on two different buttons.**
```
2228:            <button id="outButton" type="button" onclick="takeOutElement()" disabled>OUT</button>
2229:            <button id="outButton" type="button" onclick="cleanUp()">CLEAN UP</button>
```
Invalid HTML — two elements share one id. `document.getElementById` returns
only the first match, so `updateActionButtons()`
([index-horizontal.html:2892-2900](html_files/index-horizontal.html#L2892-L2900)) doing `outButton.disabled = ...`
only ever affects the real OUT button; the CLEAN UP button's `id` is
functionally inert. Not currently causing visible breakage (CLEAN UP has no
`disabled` logic relying on its id), but it's a latent trap for any future
code that queries `#outButton` expecting one specific button.

**F6 — Two independent places define the aux-URL mapping.**
This file's `aux-config.json`/`auxConfig` drives the Input Sources panel
(when F4 is fixed) and the commented-out persistent-box live path. The
`html_files/layouts/*.html` files each hardcode their own
`` `http://127.0.0.1:8889/aux${input + 1}?...` `` formula independently. If
F1 is correct and those files are effectively dead in this app's current
flow, this is moot; if they're still reachable some other way (e.g. opened
directly), remapping an aux feed requires editing two unrelated places to
stay consistent.

## 8. Minor observations (not bugs)

- Several old implementations are left in as commented-out code alongside
  the active one (e.g. `2926-2934`, the `3BOX_SP`/`3BOX_SP_V` grid rules
  around `3131-3179`). Harmless, but adds noise when reading the file top to
  bottom.
- `loadPlaylistElements()` fetches `/api/settings` twice in a row
  ([index-horizontal.html:2681](html_files/index-horizontal.html#L2681) and [2688](html_files/index-horizontal.html#L2688)) — the first
  response (`cfg`) is fetched and discarded without being used for anything
  visible; the second (`configResponse`/`config`) is what's actually used.

## 9. Deep dive: delete-box → relayout logic

Scope: what happens end-to-end when the operator clicks the "×" on a
persistent preview box, all inside `window.addEventListener("message", ...)`
at [index-horizontal.html:3559-3607](html_files/index-horizontal.html#L3559-L3607) (plus the button itself at
[index-horizontal.html:2940-2964](html_files/index-horizontal.html#L2940-L2964)).

### 9.1 Step by step

1. **Delete button exists only when allowed.** `createPersistentInput()`
   only appends the "×" button when `onair` is false (it's a Preview-only
   affordance) ([index-horizontal.html:2939](html_files/index-horizontal.html#L2939)), and its `click` handler
   itself re-checks the same guard before doing anything
   ([index-horizontal.html:2953-2957](html_files/index-horizontal.html#L2953-L2957)):
   - `currentLayoutData.boxOrder.length <= 1` → refuse (can't delete the
     last box).
   - `noDeleteLayoutNames.has(currentLayoutData.boxTypeName)` → refuse.
     Today that set only contains `"3BOX_SP"`
     ([index-horizontal.html:3196](html_files/index-horizontal.html#L3196)) — an arrangement-only layout
     where boxes can be dragged/swapped but never removed.
   - `renderTruePersistent2Box()` also *hides* the × button entirely under
     the same two conditions ([index-horizontal.html:3238-3243](html_files/index-horizontal.html#L3238-L3243)), so the
     click-time guard is really a second line of defense, not the only one.
2. **Optimistic hide, then hand off.** The clicked box gets `.p2-hidden`
   added immediately, then `postMessage({action:"deleteBox", boxName})` is
   sent to the page's own `window` — same trick `swapBoxes` uses, so both
   edits funnel through one listener instead of two separate code paths.
3. **The listener re-validates from scratch** (`currentLayoutData` must
   exist, length > 1, not in `noDeleteLayoutNames` — [index-horizontal.html:3563-3567](html_files/index-horizontal.html#L3563-L3567)) and only then mutates state.
4. **Family suffix decision** ([index-horizontal.html:3573-3576](html_files/index-horizontal.html#L3573-L3576)): if the
   current layout name ends in `_SP_V`, that suffix is preserved when
   re-resolving the smaller layout (so `4BOX_SP_V` minus one box becomes
   `3BOX_SP_V`, not `3BOX`). Every other family — plain `NBOX`,
   `2BOX_BIG_SMALL`, `7BOX_CENTER`, plain `_SP` (which can't reach here
   anyway, see step 1) — collapses to the plain `NBOX` name on delete. This
   is a deliberate simplification, not an oversight: there's no
   `"2BOX_CENTER"`/`"1BOX_BIG_SMALL"` to fall back to, so collapsing to
   plain is the only sane choice for those families.
5. **Filter by box name, then renumber** ([index-horizontal.html:3579-3587](html_files/index-horizontal.html#L3579-L3587)):
   the deleted entry is removed from `boxOrder` by matching `item.box`
   (the position slot's name), and the survivors are renamed
   `BOX_01, BOX_02, ...` in their existing order. Each survivor's `.input`
   (which camera it shows) travels with it unchanged — deleting a slot
   never changes which cameras are visible, only how many slots exist and
   what they're numbered.
6. **Re-resolve the layout name** ([index-horizontal.html:3592-3599](html_files/index-horizontal.html#L3592-L3599)): looks
   up `boxLayouts.find(item => item.boxTypeName === \`${remainingBoxes}BOX${suffix}\`)`
   and, if found, adopts its `boxType`/`boxTypeName`. **If not found, the
   old `boxType`/`boxTypeName` are silently left in place** — see 9.2.
7. `layoutEdited = true`, then `showLayoutPreview(currentLayoutData)`
   re-renders (cross-dissolve, same as any other layout change) and
   `updateActionButtons()` re-enables TAKE.

Nothing here talks to Viz Engine. The edit is purely local until the
operator presses TAKE, at which point `takeElement()`'s `layoutEdited`
branch ([index-horizontal.html:3817-3876](html_files/index-horizontal.html#L3817-L3876)) serializes the *current*
(possibly-shrunk) `boxOrder` and sends it via `msg_layout_edited` /
`Execute` / `Execute2` — see §5 above and `reorder_edited_fast` in
`artist2.txt`.

### 9.2 Bug: deleting down to 11 boxes leaves a stale layout

`boxLayouts` ([index-horizontal.html:2642-2662](html_files/index-horizontal.html#L2642-L2662)) defines the plain
`NBOX` family for these counts only: **1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12** —
**11 is missing**. The only layout with 12 boxes is `12BOX` itself
(`boxType: 13`), so this is reachable exactly one way: start on a `12BOX`
layout and delete any single box.

Trace: `remainingBoxes` becomes `11`, suffix is `""` (`"12BOX"` doesn't end
in `_SP_V`), so the lookup searches for a `boxTypeName` of exactly
`"11BOX"`. It isn't in the array, `newLayout` is `undefined`, and the
`if (newLayout)` block at [index-horizontal.html:3596-3599](html_files/index-horizontal.html#L3596-L3599) is skipped —
`currentLayoutData.boxType`/`boxTypeName` stay `13`/`"12BOX"` while
`boxOrder` now only has 11 entries. Two concrete effects follow from that
mismatch:

- **Visual**: `showLayoutPreview()` still sees `"12BOX"` in
  `persistentLayoutNames` (it's unaffected by the count mismatch) and
  renders through `persistentLayoutRules["12BOX"]`, which defines fixed
  grid coordinates for all of `BOX_01`..`BOX_12`. With only 11 named boxes
  now existing, 11 of the 12 grid cells fill in and **one cell is left
  empty** — the layout doesn't reflow into a proper 11-box mosaic, it looks
  like a 12-box grid with a hole in it.
- **On TAKE**: the stale `boxType` (`13`, i.e. `"12BOX"`) is what gets
  serialized into `dataLayout` and sent to Viz Engine via
  `msg_layout_edited`/`Execute`. Viz Engine's `reorder_edited_fast` looks up
  its own `BOX_LAYOUTS` child at index `13` (the 12-box template) using a
  `boxData` string that only names 11 boxes — so whatever container Viz
  considers the "12th" box for that template is left in the "fill empty
  indexes with unused boxes" fallback inside `reorder_edited_fast`
  (`artist2.txt`), rather than being told it doesn't exist. The Viz-side and
  browser-side pictures should still roughly agree (both effectively show
  "12BOX minus one"), but neither actually resolves to a real 11-box
  template — because there isn't one.

This is self-correcting on the *next* delete: from that stale state,
deleting again computes `remainingBoxes = 10`, and `"10BOX"` **does** exist
in `boxLayouts`, so `boxType`/`boxTypeName` snap back in sync. It's a
one-step glitch, not a permanent stuck state, but it's a real, reachable
inconsistency between `boxOrder.length` and `boxType`/`boxTypeName` for
exactly one delete out of the whole feature's range.

### 9.3 Open question (not a confirmed bug) — worth checking against the Viz scene

The wire format sent to Viz on an edited TAKE is `` `${item.box}:${item.input}` ``
(box **name** : camera **input index**) — e.g. `"BOX_01:0,BOX_02:1"`. On the
Viz Artist side, `reorder_edited_fast` in `artist2.txt` parses each pair as
`boxName:targetIndex` and moves the container found by `boxName` to array
position `targetIndex` in the `BOX_LAYOUTS` sub-scene's own child list.

In the browser, `box` is a **position/geometry-slot identity** (its on-screen
place, defined per layout in `persistentLayoutRules`) and `input` is the
**camera identity** shown there — that's explicit in the swap-boxes comment
at [index-horizontal.html:2975-2978](html_files/index-horizontal.html#L2975-L2978): *"box (position) stays put"*,
only the input (camera) moves. For `reorder_edited_fast`'s
`boxName:targetIndex` reading to produce the intended result, the Viz scene's
own `BOX_01`..`BOX_12` sub-containers under each `BOX_LAYOUTS` template would
need to be the ones with a **fixed camera binding** (so moving "the container
named BOX_03" to a numeric slot means "put camera 3's feed at that slot"),
which only lines up with the browser's model if the naming coincidentally
matches on both sides. This isn't something I can confirm or refute from
`index-horizontal.html` or `artist2.txt` alone — it depends on how the actual
Viz scene's containers are bound, which isn't visible from either script.
Worth a quick sanity check directly in Viz Artist/Pilot next time a delete +
TAKE is tested against a live Engine, rather than assuming the naming lines
up.
