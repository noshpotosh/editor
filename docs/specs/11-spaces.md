# Spec 11: Spaces

## Status

Uncommitted. Available in code (editor) mode. User documentation: [`TERMINAL_FIRST.md` — Spaces](../../TERMINAL_FIRST.md#spaces).

## Problem and goals

A session had exactly one tile grid, so switching between writing code (Explorer, editor, terminal) and reviewing changes (Changes, editor, Bitbucket) meant rebuilding the layout each time. Spaces let a session keep several named tile layouts over the same directory and shell, switch between them from a strip and from the keyboard, and keep each layout's buffers, tiles, and view state alive while another is shown. Nothing about sessions changes: a space never has its own shell, directory, floating terminal, or jump list.

## Behavior

- **S11.1** Every session has at least one space. A session created before spaces existed, or restored from storage without a `spaces` list, has one space named `Space 1` whose layout is the session's previous layout.
- **S11.2** A space is a retained editor-part layout. The first space of a session is retained under the session id; every other space under `sessionId#spaceId` (`spaceLayoutKey`). `EditorPartSessions` and its `editorpart.sessions` memento are unchanged.
- **S11.3** Switching spaces hides the floating tools, activates the space's layout, keeps buffers, tile sizes, terminal processes, and view state, and fires `onDidChangeSessions`. Selecting a space from the shell enters the editor.
- **S11.4** View tiles are scoped to a space: `ViewTileInput.sessionId` holds the layout key, so opening a view in a space that has no tile for it creates one even when another space of the session already has one; opening it again focuses the existing tile. Spaces share one composite per container (S9.22).
- **S11.5** New Space first offers **Empty** and every preset from `terminalFirst.spaces.presets` (S11.13). Empty asks for a name (prefilled with the first free `Space N`, blank keeps the suggestion), shows the new empty space, and opens the New Tile picker (`terminalFirst.tile.new`). A preset names the space after itself (`Review`, then `Review 2`), shows the space, and applies the preset (`_terminalFirst.tile.applyPreset`). Escape at either step creates nothing. Rename Space prompts with the current name; a blank answer leaves it unchanged.
- **S11.6** Close Space closes every editor of the space after save, discard, or cancel decisions and running-process confirmations; cancelling keeps the space and restores its layout. After closing, the neighbouring space at the same position (or the last one) becomes active. Closing the only space leaves one fresh empty space named `Space 1`. The closed layout is disposed after its successor is shown.
- **S11.7** Closing a session applies S11.6's first phase to every space (cancellation in any space keeps the session and all its spaces), then disposes every space layout after the successor session is shown. `e --wait` resolves when the file closes in any space of the owning session. A session's dirty indicator is the union of its spaces' dirty states; each space reports its own.
- **S11.8** `terminalFirst.sessions` (workspace scope) stores `spaces: { id, name }[]` and `activeSpace` per session. After a reload, the active space is reactivated. A retained layout whose key names an unknown space of a known session is kept as `Recovered Space`; one whose session is unknown becomes a `Recovered Session` holding that space.
- **S11.9** The space switcher is one left-aligned status bar entry (`terminalFirst.spaces`, priority 11000, through `IStatusbarService.addEntry`; no upstream change). It exists only while the active session is in editor mode and has at least two spaces. Its label is a layout glyph whose command is `terminalFirst.space.pick`; its custom content is one pill per space (`N Name`, the active pill filled, a dot on dirty spaces, a hover with the chord) that switches on click. Past four spaces the pills disappear and the label becomes `N Name` with a chevron, so many spaces cost one entry. Status bar keyboard navigation reaches the label, which opens the picker.
- **S11.10** Commands `terminalFirst.space.new|next|previous|rename|close|pick|select1…select9` are in the Command Palette under VS NOSH with precondition editor mode. Chords (`dockedNavigation`, weight `ExternalExtension + 1000`, physical Control on macOS): `Ctrl+Option+N`, `Ctrl+Option+]`, `Ctrl+Option+[`, `Ctrl+Option+1…9`. They are listed in `terminal.integrated.commandsToSkipShell` so terminal tiles pass them on. `Ctrl+Option+N` overrides upstream's secondary `list.focusDown` key while a tile list is focused.
- **S11.11** Leader (editor mode): `1`…`9` select by position; `Tab n` new, `Tab r` rename, `Tab x` close, `Tab ]` next, `Tab [` previous, `Tab Tab` pick. The leader normalizes the window's `Tab` key to the Vim name `<Tab>` so the group works from the window and from the native Vim engine alike; hints print it as `Tab`.
- **S11.12** Colors: `terminalFirst.space.activeBackground` (default `statusBarItem.prominentBackground`), `terminalFirst.space.activeForeground` (default `statusBarItem.prominentForeground`), and `terminalFirst.space.hoverBackground` (default `statusBarItem.hoverBackground`).
- **S11.13** `terminalFirst.spaces.presets` is an array of `{ name, tiles: { tile, direction?, size?, from? }[] }`; its default holds the built-in **Code** (editor; Explorer left, 0.25; terminal below the editor, 0.3) and **Review** (editor; Changes left, 0.3; Bitbucket right, 0.5) presets, so users edit the list in place. `tile` is `editor`, `terminal`, `web:<app>`, or a view or view container ID. `TileService.applyPreset` opens the tiles in order: step `from` (default: the previous step) is activated, the tile opens toward `direction` (automatic placement when absent), and `size` resizes the new tile to that share of the split cell. A tile that cannot open (unknown view, web app with no configured URL) is skipped without prompting. Focus ends on the first opened tile. Malformed entries are dropped by `validateSpacePresets`; a malformed field is ignored, not the preset.
- **S11.14** `terminalFirst.newSessionFromPreset` (leader `t p` in the editor, `o` in the shell; `New Session from Preset` in the palette) asks for a directory (prefilled with the active session directory; `~` and relative paths resolve against it; must exist and be a directory), then a preset (S11.5's list), creates a shell session in that directory, names its first space after the preset, enters the editor there, and applies the preset.

## Surface

| Command | Chord (macOS) | Leader |
| --- | --- | --- |
| `terminalFirst.space.new` | `Ctrl+Option+N` | `Tab n` |
| `terminalFirst.space.next` / `previous` | `Ctrl+Option+]` / `[` | `Tab ]` / `Tab [` |
| `terminalFirst.space.select1` … `select9` | `Ctrl+Option+1` … `9` | `1` … `9` |
| `terminalFirst.space.rename` | — | `Tab r` |
| `terminalFirst.space.close` | — | `Tab x` |
| `terminalFirst.space.pick` | — | `Tab Tab` |
| `terminalFirst.newSessionFromPreset` | — | `t p` (editor), `o` (shell) |

## Implementation

- `src/vs/workbench/contrib/terminalFirst/common/spaces.ts`: `DEFAULT_SPACE_ID`, `spaceLayoutKey`, `parseSpaceLayoutKey`, `nextSpaceName`, `defaultSpaceName` (S11.1, S11.2).
- `src/vs/workbench/contrib/terminalFirst/browser/terminalFirstService.ts`: `Session.spaces`/`activeSpace`, `layoutKeys`, `activeLayoutKey`, `closeLayouts`/`disposeLayouts`, the `*Space` methods, storage and recovery (S11.3, S11.5 to S11.8). `src/vs/workbench/services/terminalFirst/common/terminalFirst.ts`: `ITerminalFirstSpace`, `ITerminalFirstSession.spaces`, the service methods.
- `src/vs/workbench/contrib/terminalFirst/browser/tiles.ts` `activeScope`, `tileEditor.ts` `ViewTileInput` (S11.4).
- `src/vs/workbench/contrib/terminalFirst/browser/spaceStatus.ts`, `spaceStatus.css` (S11.9). No upstream file changes.
- `src/vs/workbench/contrib/terminalFirst/common/spacePresets.ts` (types, defaults, `validateSpacePresets`, `describeSpacePreset`), `tiles.ts` `applyPreset` and the setting registration (S11.13), `terminalFirstService.ts` `pickPreset`, `newSpace`, `newSessionFromPreset` (S11.5, S11.14).
- `src/vs/workbench/contrib/terminalFirst/browser/spaceCommands.ts` (S11.10), `terminalFirstLeader.ts` (S11.11), `common/terminalFirstColorRegistry.ts` (S11.12).

## Tests

- `test/browser/spaces.test.ts`: layout keys, name suggestions, preset validation and descriptions.
- `test/browser/terminalFirstService.test.ts`: new space activation, picker, persistence; preset-named spaces and a cancelled pick; new session from a preset; wrap-around switching and out-of-range slots; close with neighbour, last space, and cancel; restore, defaults, and recovery; session close across spaces; per-space dirty state.
- `test/browser/spaceStatus.test.ts`: the entry appears at two spaces with pills, collapses past four, and leaves for one space or the shell.
- `test/browser/tiles.test.ts`: one tile per view per space; a preset opens, sizes, and skips tiles as specified.

## Known gaps and risks

- Moving a tile from one space to another is not available; reopen the view or file in the target space.
- Cloning the current space into a new one is not offered; presets cover the common starting points.
- Vim jump navigation (`Ctrl+O`/`Ctrl+I`) stays per session, so jumping can land in a file that is open in another space; the file opens in the active space.
- The switcher's pills are mouse targets; keyboard users reach the entry's glyph (which opens the picker) or use the chords and leader.

## Open decisions

- Whether `Ctrl+Option+Shift+1…9` should move the focused tile to that space (Hyprland's `movetoworkspace`).
