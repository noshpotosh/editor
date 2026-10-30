# Spec 9: Tiling Code Workspace

## Status

Uncommitted. On by default in code (editor) mode. User documentation: [`TERMINAL_FIRST.md` — Tiling code workspace](../../TERMINAL_FIRST.md#tiling-code-workspace).

## Problem and goals

Code mode should behave like a keyboard-driven tiling window manager (Hyprland's dwindle layout is the reference) while staying on upstream editor groups. Tiles must never become unusably small or leak empty cells. Layout operations need direct chords, a leader route, and Command Palette entries. Focus must stay predictable with both mouse and keyboard.

## Behavior

- **S9.1** Every tile is an editor group in the session's grid. Editor tiles hold file tabs. View tiles and terminal tiles hold one dedicated input (`EditorInputCapabilities.RequiresDedicatedGroup`) and reject other tabs.
- **S9.2** A new tile halves the focused tile along its longer side (right when wider than tall, otherwise below). Automatic placement falls back to the other axis. An explicit direction does not fall back.
- **S9.3** A split happens only if both halves meet the tile minimum (230×190 px, `editorTileLayout.ts`). Otherwise the command shows "There is not enough room for another tile…" and leaves the layout unchanged. File opens from a dedicated tile throw the same message.
- **S9.4** If a new tile's content cannot open, the new empty tile is removed. This includes a terminal tile that the session controller declines (`openTerminalTile` resolves `false`) or one that fails to launch.
- **S9.5** Each session has at most one tile per view container, matched by container ID *and* session ID. Opening it again focuses the existing tile.
- **S9.6** Copying a group that holds a dedicated input (Split Editor, Alt-drag) creates an empty split instead of duplicating the terminal or tool.
- **S9.7** Directional focus targets the most recently used neighbor in that direction. It wraps only when `terminalFirst.tiles.wrapFocus` is `true`. `next`/`previous` always wrap in grid order.
- **S9.8** **Move** re-docks the tile on the far side of its neighbor. **Swap** exchanges the grid cells of the tile and its neighbor, so each takes the other's size. Focus stays on the moved tile.
- **S9.9** **Toggle split** flips the tile and its first neighbor (left, up, right, down order) between side by side and stacked. The left/top tile stays first. The shared cell is halved. If the shared cell is too small, the no-room message from S9.3 is shown.
- **S9.10** **Resize** moves the tile's edge toward the given side. It grows into a neighbor on that side, otherwise shrinks from the opposite side, by `terminalFirst.tiles.resizeStep` px. The grid clamps to tile minimums.
- **S9.11** **Balance** evens all tile sizes.
- **S9.12** Move, swap, toggle split, resize, balance, and open restore a maximized tile first. Activating another tile also restores it (upstream).
- **S9.13** Closing a tile focuses the neighbor that absorbs its space: the first neighbor sharing a full edge, else the first spatial neighbor. Closing the last tile leaves an empty workspace.
- **S9.14** Focus follows the pointer after it rests on a tile for 120 ms. It is cancelled by leaving the tile or pressing a mouse button, and suppressed while a context menu, dialog, quick input, suggest, find, rename, or parameter-hint widget is open. Disabled by `terminalFirst.tiles.focusFollowsMouse: false`.
- **S9.15** Leader `w r` opens a resize submap. `h/j/k/l` and `=` repeat without the prefix. Escape or any other key exits.
- **S9.16** `:sp`/`:split` and `:vs`/`:vsplit` create an editor tile below/right under S9.2–S9.4 and copy the current file editor into it. Dedicated inputs are not copied.
- **S9.17** Closed terminal tiles drop their shell-integration nonce from the session, so `e` from a stale nonce no longer routes there. Nonces persist across shutdown so reconnected tiles keep routing.
- **S9.18** In editor mode, opening any view container or view opens or focuses its tile. This covers the activity bar, `workbench.view.*`, `<view>.focus`, `IViewsService.openView`, and extension `reveal`. Sidebar, panel, and auxiliary-bar containers are all routed. The terminal container (`TERMINAL_VIEW_ID`) is excluded because it is the shell surface. The sidebar and auxiliary bar never show (S1.12).
- **S9.19** A view that shares its container with other active views, and is movable (`canMoveView`), can be tiled alone. It moves into a generated container (`moveViewToLocation`), and that container is tiled. The move persists until Reset View Locations.
- **S9.20** `terminalFirst.tile.openView` takes `{ id, direction?, preserveFocus? }`, where `id` is a view or container ID and `direction` is `left`, `right`, `up`, or `down`. It opens the view as a tile. With no argument, it shows a picker of views. This is the supported extension entry point.
- **S9.21** View tiles persist their container ID. A tile whose container has not been registered yet (the extension is not yet loaded) shows a placeholder and fills in when the container registers. Layouts that persisted the older `{ kind: 'explorer' | 'scm' }` form restore as the matching containers.
- **S9.22** There is one composite per view container per window. Session tiles hand it over when they become visible, so singleton-backed views (extension tree views, webview views, Explorer) are created once and keep their state. It is disposed when the last tile for that container closes in any session.
- **S9.23** A background open (no focus requested) that finds no room fails silently. Only focused opens show the no-room message from S9.3.

## Surface

All commands are `terminalFirst.tile.*`, in category **VS NOSH**. Chords use Ctrl+Option (physical Control on macOS), weight `ExternalExtension + 1000`. They apply when `dockedNavigation` holds (editor mode, no floating tool or quick open). Chorded commands are in `DEFAULT_COMMANDS_TO_SKIP_SHELL`, so they work in terminal tiles.

| Command | Chord | Leader |
| --- | --- | --- |
| `focusLeft/Down/Up/Right` | Ctrl+Option+H/J/K/L | `w h/j/k/l` |
| `moveLeft/Down/Up/Right` | Ctrl+Option+Shift+H/J/K/L | `w H/J/K/L` |
| `swapLeft/Down/Up/Right` | Ctrl+Option+X, H/J/K/L | `w x h/j/k/l` |
| `resizeLeft/Down/Up/Right` | Ctrl+Option+Arrow | `w r h/j/k/l` (submap) |
| `toggleSplit` | Ctrl+Option+O | `w o` |
| `balance` | Ctrl+Option+= | `w =`, `w r =` |
| `maximize` | Ctrl+Option+F | `w m` |
| `new` | Ctrl+Option+Return | `w a` |
| `explorer` / `scm` / `terminal` | Ctrl+Option+E / G / T | `f e` / `w g` / `w t` |
| `openView` (args: S9.20) | — | — |
| `close` | Ctrl+Option+Q | `w q` |
| `splitRight` / `splitDown` | — | `w v` / `w s` |
| `splitEditorRight` / `splitEditorDown` | — | `:vs` / `:sp` |
| `next` / `previous` | — | `w n` / `w p` |

| Setting | Default | Effect |
| --- | --- | --- |
| `terminalFirst.tiles.focusFollowsMouse` | `true` | S9.14 |
| `terminalFirst.tiles.wrapFocus` | `false` | S9.7 |
| `terminalFirst.tiles.resizeStep` | `40` | S9.10 |

## Implementation

- `src/vs/workbench/contrib/terminalFirst/browser/tiles.ts`: `TileService`, commands, keybindings, and settings.
- `src/vs/workbench/services/editor/common/editorTileLayout.ts`: tile minimums, `tileFits`, `tileSplitDirection`, `tileSplitSizes`, and the shared no-room message.
- `src/vs/workbench/browser/parts/editor/editorPart.ts`: `swapGroups` (grid `swapViews`) and the dedicated-input guard in `copyGroup`.
- `src/vs/workbench/browser/parts/editor/editorGroupView.ts`: tile inset, minimum sizes, and focus-follows-mouse.
- `src/vs/workbench/contrib/terminalFirst/browser/tileEditor.ts`: `ViewTileInput` (type ID `terminalFirst.toolTile`), its serializer, `ViewTileEditor`, and the per-window `ViewTileComposites` cache.
- `src/vs/workbench/services/views/browser/viewContainerHost.ts`: the host resolver that `ViewsService` and `AbstractPaneCompositePart.openPaneComposite` consult. `TileService` registers the only resolver.
- `src/vs/workbench/contrib/terminalFirst/browser/terminalFirstLeader.ts`: leader entries and repeatable submaps (`repeat` actions).

## Tests

- `contrib/terminalFirst/test/browser/tiles.test.ts`: split rules; and, on a real grid, the `TileService` operations (open/no-room/rollback, swap, toggle split, balance, edge resize, close fallback, maximize restore) and focus-follows-mouse on/off.
- `contrib/terminalFirst/test/browser/nativeVim.test.ts`: leader and Ctrl+W routes, the resize submap, swap prefix, and `:sp`/`:vs`.
- `contrib/terminalFirst/test/browser/terminalFirstService.test.ts`: terminal tile ownership and nonce pruning.
- `services/editor/test/browser/editorService.test.ts`: dedicated-group routing and room checks.

## Known gaps and risks

- Edge resize changes the tile's size. In a row of three or more tiles, the grid decides which sibling gives up the space, so the change may not land on the edge you named.
- Toggle split re-docks the tile within its neighbor's cell. With nested layouts this can change more structure than Hyprland's `togglesplit` would.
- Background reveals (an extension calling `OutputChannel.show(true)` on activation, Problems auto-reveal) can add tiles when there is room.
- There is no floating tile, scratchpad, per-tile workspace, mouse drag to move whole tiles, animation, or configurable gap size.
- Ctrl+Option chords may collide with AltGr layouts on non-macOS platforms (the fork targets macOS only).

## Open questions

- Should Ctrl+Option+Shift+H/J/K/L swap (Hyprland `movewindow` in dwindle) rather than re-dock?
- Should the 120 ms hover delay be configurable?
- Should background reveals create view tiles at all, or only focus an existing one? Should `debug.openDebug` and `debug.internalConsoleOptions` default to `neverOpen`?

## Release acceptance

1. Create four tiles with Ctrl+Option+Return. Each split halves the focused tile along its longer side.
2. Swap, toggle split, balance, and resize with the chords and the `w r` submap.
3. Maximize a tile, then move or swap. The tile is restored first.
4. Close a middle tile. Its sibling receives focus.
5. Run `:vs` in Vim. A new right tile shows the same file.
6. Hover across tiles while a suggest widget is open. Focus does not move.
7. Switch sessions while a terminal tile opens. No empty tile is left behind.
8. Reload. The layout and one tile per view per session are restored.
9. Open an extension tree view and a webview view from the New Tile picker and with `<view>.focus`. Each lands in a tile with working title actions. Cmd+B does not show a sidebar.
10. Tile the same extension view in two sessions and switch between them. It keeps its state and shows only in the visible session.
11. Tile Outline alone, then run Reset View Locations. Outline returns to Explorer.
