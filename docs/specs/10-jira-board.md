# Spec 10: Web App Tiles (Jira Board, Bitbucket)

## Status

Uncommitted. Available in code (editor) mode. User documentation: [`TERMINAL_FIRST.md` — Tiling code workspace](../../TERMINAL_FIRST.md#tiling-code-workspace).

## Problem and goals

Checking the team's Jira board meant leaving the editor for a web browser. The board should open inside the tiled workspace, keep its login, and behave like any other tile. The upstream integrated browser (`contrib/browserView`) renders pages in an Electron `WebContentsView` rather than an iframe, so Jira Cloud (which refuses to be framed) and Atlassian SSO work unchanged.

## Behavior

- **S10.1** **VS NOSH: Open Jira Board** (`terminalFirst.tile.jira`, Ctrl+Option+B, leader `w b`, also "Jira Board" in the New Tile picker) opens the board in an integrated browser view placed as an editor tile under S9.2–S9.4.
- **S10.2** The board URL comes from `terminalFirst.jira.boardUrl`. When it is empty or not an http(s) URL, the command asks for one, trims it, and saves it to user settings. Cancelling or entering anything other than an http(s) URL opens nothing and saves nothing.
- **S10.3** The board uses one browser view with a stable ID (`vscode-browser:/vs-nosh-jira`). If any tile already shows it, the command focuses that tile instead of opening another. The view restores after a restart through the browser editor serializer.
- **S10.4** Logins persist through the integrated browser's shared user session.
- **S10.5** The floating terminal, file browser, jump list, and leader menu are tracked as browser overlays, so the native browser view yields to them when they overlap a browser tile. The overlay manager also re-checks overlays when their `hidden` attribute changes, which is how these overlays show and hide.
- **S10.6** The board view is *chromeless*: no navigation bar (URL, back/forward, reload buttons), no page inset, and no rounded page border, so the page fills the tile. Browser keyboard commands still work (Cmd+R reload, Cmd+[ / Cmd+] back/forward, Cmd+F find). The flag is part of the browser view state (`IBrowserEditorViewState.chromeless`), saved with the view, and available to any browser view. A board tile created before this change keeps its navigation bar until it is closed and reopened.
- **S10.7** **VS NOSH: Open Bitbucket** (`terminalFirst.tile.bitbucket`, Ctrl+Option+C, leader `w c`, also "Bitbucket" in the New Tile picker) behaves the same way with its own setting (`terminalFirst.bitbucket.url`) and browser view (`vscode-browser:/vs-nosh-bitbucket`). Both apps are entries in `webAppTiles` in `tiles.ts`; another app is one more entry plus a setting and a command.

## Implementation

- `contrib/terminalFirst/browser/tiles.ts`: `webAppTiles`, `TileService.openWebApp`, the `terminalFirst.jira.boardUrl` and `terminalFirst.bitbucket.url` settings, the commands and chords, and the New Tile picker entries.
- `contrib/browserView/common/browserView.ts`, `browserEditorInput.ts`: the `chromeless` view-state flag, revived, copied, and serialized only when set.
- `contrib/browserView/electron-browser/browserEditor.ts`, `media/browser.css`, `features/webContentsViewRendererFeature.ts`: a `chromeless` class on `.browser-root` hides the navbar and page frame; the renderer drops its 3 px inset.
- `contrib/browserView/electron-browser/overlayManager.ts`: VS NOSH overlay classes in `OVERLAY_DEFINITIONS`, and `hidden` in the overlay observer's attribute filter.

## Tests

- `contrib/terminalFirst/test/browser/tiles.test.ts`: prompting once and saving the URL, reusing an existing board tile, opening a configured board without asking, Bitbucket opening its own tile beside Jira, and rejecting a cancelled or non-http(s) URL.
- `contrib/browserView/test/electron-browser/browserEditorInput.test.ts`: the chromeless flag survives reopen, copy, and restore; malformed values are ignored.
- `contrib/browserView/test/electron-browser/overlayManager.test.ts`: a VS NOSH floating overlay is detected only while shown.

## Open decisions

- Resolved: leader `w b` opens the Jira board and `w c` opens Bitbucket.
- One page per app; multiple boards or repositories would need a list setting and a picker.
