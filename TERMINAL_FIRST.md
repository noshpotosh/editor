# VS NOSH

A macOS development fork of VS Code that starts in a shell and opens the GUI editor on demand.

Repository: [noshpotosh/editor](https://github.com/noshpotosh/editor). Upstream: `microsoft/vscode`, release `1.144.0`, commit `2c33b50b16c472efe58357d1d2a8a5414bc23fbf` (recorded in `build/fork/upstream-base`). `scripts/upstream-sync.sh` adds the `upstream` remote and merges upstream changes following [docs/upstream/SYNC.md](docs/upstream/SYNC.md); [docs/upstream/PATCHES.md](docs/upstream/PATCHES.md) lists every upstream file the fork modifies.

## Build and run

Use Node `24.22.1` from `.nvmrc`, npm, and the macOS/Xcode command line tools required by upstream VS Code. This is a source development build; the first launch downloads Electron and prepares built-in extensions.

```sh
npm run install-fast
./scripts/terminal-first-app.sh --build /path/to/project
```

The packaged app is the everyday launcher: it loads a bundled, minified build and opens to a shell much faster than a development build. After the first `--build`, run `./scripts/terminal-first-app.sh /path/to/project` to launch, and add `--build` again after changing sources. While iterating on code, `npm run build-fast` followed by `./scripts/terminal-first.sh /path/to/project` runs the unbundled development build instead, which needs no packaging step but starts several seconds slower.

Native Vim controls are built in and enabled by default. For optional VSCodeVim support, run `./scripts/setup-terminal-first-vim.sh` and set `"terminalFirst.vim.engine": "extension"`. The setup script installs the pinned, checksum-verified VSCodeVim `1.32.4` VSIX from its GitHub release into this checkout's isolated extension directory. The launchers keep user data, extensions, and shared data under `.build/terminal-first`. They do not install a global command or change shell dotfiles. Other extensions can be installed with `./scripts/terminal-first-cli.sh --install-extension /path/to/extension.vsix`.

## Workflow

| Action | Command / shortcut |
| --- | --- |
| Open files from this window's shell | `e src/app.ts` |
| Open several files | `e src/app.ts 'notes with spaces.txt'` |
| Block until the requested files close | `e --wait COMMIT_EDITMSG` |
| Open a filename beginning with a dash | `e -- -notes.txt` |
| Open the editor in a directory | `e src/` |
| Open at a line and column | `e -g src/app.ts:12:4` |
| Open editor / return to shell | `Ctrl+Space e` / `Ctrl+Space q` |
| Toggle floating terminal (editor mode) | `Cmd+Shift+T` or leader `t t` |
| New shell session | `Cmd+Option+N` |
| Previous / next shell | `Cmd+Option+Left` / `Cmd+Option+Right` |
| Pick shell session | `Cmd+Option+P` |
| Rename session | leader `t r` (editor) / `Ctrl+Space R` (shell) |
| Browse files with preview (editor mode) | `Cmd+Shift+E` or leader `f b` |
| Add current file to jump list | `Cmd+Shift+A` or leader `j a` |
| Toggle jump list | `Cmd+Shift+J` or leader `j j` |
| Open jump list slot 1 to 9 | leader `j 1` … `j 9` |
| Find a file (editor mode) | `Cmd+P` |
| Command Palette (editor mode) | `Cmd+Shift+P` |

The title bar contains session tabs with shell/editor glyphs, dirty indicators, close buttons, and New Terminal. Sessions can be renamed (leader `t r` in the editor, `Ctrl+Space R` in the shell); a custom title outlives the shell's own title and is persisted. Ordinary launch selects the shell; explicit file, diff, or merge launches select an editor session. Each tab remembers its own surface, open files, diff inputs, editor splits, and unsaved buffers. Switching tabs does not close editors or terminate shells. Closing the last editor returns to its shell. Closing a session resolves save/discard/cancel decisions before removing its editor tabs and honors terminal process confirmation. Closing the final session creates a fresh shell.

Shell mode hides the panel header entirely and prevents sidebar, panel, and workbench commands from revealing tools. Normal terminal input, copy/paste, selection, scrolling, and find remain available. Editor mode shows a tiling workspace with editor tabs and a status bar. The activity bar, sidebar, and secondary sidebar are removed; views open as tiles instead. The layout controls and Open in Agents title-bar button are absent in both modes. The former Toggle Workbench Tools command is removed.

`code` and its alias `e` support local files and new unsaved files. It sends the invoking directory along with the originating terminal session identity. Open Editor uses shell directory detection, then the last known directory, then the initial shell directory. Explorer, search, and source control follow the active editor session’s directory; open files remain in that session even after `cd`. A single directory argument opens the editor in that directory; `-g file:line[:col]` opens at a position. `EDITOR='e --wait'` is supported, and switching surfaces or sessions does not release the wait.

The window uses a managed `.code-workspace` file in its own workspace storage. User-owned workspace files are not rewritten. Settings and the extension host are shared across tabs. Folder changes use the normal workspace service and notifications, but do not restart the extension host: doing so would break pending shell CLI requests. Extensions that assume the first workspace folder never changes may require an explicit extension-host restart. Remote development and fully isolated extension environments per tab are outside this milestone.

Editor groups remain alive while inactive and are excluded from active navigation. Save All, backups, and shutdown still include retained editors. Files opened in multiple sessions share the underlying document model. Session metadata uses persisted shell integration nonces; editor layouts use normal editor serialization and dirty-buffer backups. Reload/restart uses upstream terminal reconnection or revival. If a terminal cannot reconnect, its editor state is retained and a replacement shell is created when needed. A revived shell may be a new process.

## Tiling code workspace

Code mode uses a separate rounded, bordered card for each editor, view, or terminal tile. Gutters separate the cards and retain draggable resize dividers. The active tile uses the focus border, an inactive tile under the pointer shows a hover border, and the border color eases between them (no motion when the system prefers reduced motion). When the pointer rests on a tile, that tile becomes active and receives keyboard focus. Passing over a tile does not change focus, and neither does hovering while a menu, dialog, quick input, suggest, find, rename, or parameter-hint widget is open. Set `terminalFirst.tiles.focusFollowsMouse` to `false` to focus tiles only by click or keyboard. The activity bar is hidden. **New Tile** appears at the bottom-right of an empty code workspace. Leader `w a` opens the tile picker at any time. Leader `f e` opens or focuses Explorer. The floating file browser remains available with Cmd+Shift+E or leader `f b`.

New tiles split the focused tile equally: right when it is wider than tall, below otherwise. If that direction cannot fit, automatic placement tries the other direction. Explicit `w v` and `w s` splits keep their requested direction. If neither half can remain usable, the command explains why and leaves the layout unchanged. Files and diffs open in the most recently focused editor tile, creating one when needed; tool and terminal tiles do not accept unrelated file tabs.

Each outer session can have multiple editor and terminal tiles, and one tile per view. Physical **Ctrl+H/J/K/L** moves focus left/down/up/right in code mode, including editor Insert mode, Explorer, Git, and terminal tiles. Tile commands also have Hyprland-style **Ctrl+Option** chords. They work from editor, tool, and terminal tiles, including Vim Insert mode:

| Chord | Leader | Action |
| --- | --- | --- |
| Ctrl+Option+H/J/K/L | `w h/j/k/l` | Focus the tile left/below/above/right |
| Ctrl+Option+Shift+H/J/K/L | `w H/J/K/L` | Move the tile beside its neighbor |
| Ctrl+Option+X, then H/J/K/L | `w x h/j/k/l` | Swap the tile with its neighbor |
| Ctrl+Option+Arrow | `w r h/j/k/l` | Move the tile's edge toward that side |
| Ctrl+Option+O | `w o` | Flip the tile and its neighbor between side by side and stacked |
| Ctrl+Option+= | `w =` | Balance tile sizes |
| Ctrl+Option+F | `w m` | Toggle maximization |
| Ctrl+Option+Return | `w a` | New Tile picker |
| Ctrl+Option+E / G / T | `f e` / `w g` / `w t` | Explorer / Git Changes / terminal tile |
| Ctrl+Option+B | `w b` | Jira board tile (asks for the board URL the first time; see `terminalFirst.jira.boardUrl`) |
| Ctrl+Option+C | `w c` | Bitbucket tile (asks for the page URL the first time; see `terminalFirst.bitbucket.url`) |
| Ctrl+Option+Q | `w q` | Close the tile |

## View tiles

Every view opens as a tile, including Explorer, Source Control, Search, Problems, Output, Debug Console, and views contributed by extensions. The only exception is the terminal panel, which remains the shell surface. VS NOSH has no sidebar or secondary sidebar. Opening a view from the Command Palette, a keybinding, or an extension (for example `Focus on Outline View`, `workbench.view.scm`, or a tree view's `reveal`) opens or focuses its tile.

The New Tile picker is grouped into **Workspace** (Editor, Terminal), **Tools** (Explorer, Changes, Search, Problems, Output, Debug Console, and the other built-in views), **Web** (Jira Board, Bitbucket), and **Extensions** (views contributed by extensions). Every row shows an icon, a name, what it opens, and its chord when one exists; typing filters names and descriptions together. A container whose title is empty is named after its first view, so no row or tile tab is ever blank. Containers with several views also list each movable view as `Container › View`; picking one gives it a tile of its own and moves it out of its container, as dragging a view does upstream. Run **Reset View Locations** to return it. Each session has at most one tile per view; opening the view again focuses that tile. When several sessions tile the same view, they share one instance, so tree expansion and webview state are kept across session switches. Background reveals that do not request focus open a tile only if there is room, and they do so silently.

Extensions and keybindings can open a view tile directly:

```js
vscode.commands.executeCommand('terminalFirst.tile.openView', { id: 'myExtension.myView', direction: 'right', preserveFocus: true });
```

`id` is a view or view container ID. `direction` (`left`, `right`, `up`, or `down`) and `preserveFocus` are optional. With no argument, the command opens a picker of views. After a reload, a tile whose extension has not registered yet shows a placeholder until the view becomes available.

### Keyboard navigation inside view tiles

Moving focus into a view tile (Ctrl+H/J/K/L, Ctrl+Option+G, leader `w g`, or a rested pointer) lands on the view's list with a visible cursor on the first or last-used row; a collapsed view expands first. With native Vim on, every list and tree inside a view tile accepts `j`/`k` (rows), `h`/`l` (collapse, or expand and open while keeping the cursor), `o` (open keeping the cursor), Enter (open and move focus), `gg`/`G`, Ctrl+D/U (pages), `za`/`zo`/`zc` (folds), `/` (find or type-to-navigate), Space (leader), `.` (a picker of the focused row's actions, the view header actions, and the tile actions, so Stage, Discard, Refresh, or Collapse All are one keystroke away), `m` (the row's context menu), `F6`/Shift+F6 (cycle list, view header toolbar, tile toolbar; Escape returns to the list), and `?` (searchable help). Type-to-navigate waits for `/` while Vim is on, so `j` never filters. Text inputs inside views keep ordinary typing. Set `terminalFirst.vim.listActionKeys` to `true` for single-key row actions: `s`/`u`/`d` stage, unstage, and discard in Changes; `r`/`a`/`A`/`d`/`D`/`y`/`x`/`p` rename, create, delete, copy, cut, and paste in Explorer. Delete and discard still confirm. Keys are remappable through their `terminalFirst.tileList.*` command IDs.

Resizing moves an edge, not a size. If there is a neighbor on that side, the tile grows into it; otherwise the tile shrinks from the opposite side. Each step is `terminalFirst.tiles.resizeStep` pixels (default 40). After leader `w r`, resize mode stays active: repeat `h/j/k/l` and `=` without the prefix. Escape or any other key leaves resize mode.

Layout commands restore a maximized tile first. Closing a tile focuses the neighbor that takes over its space. Directional focus stops at the workspace edge unless `terminalFirst.tiles.wrapFocus` is enabled. These shortcuts leave the main shell, floating tools, and quick input alone. The commands are also available under **VS NOSH** in the Command Palette. Editors retain their file tabs. Closing the final tile leaves an empty code workspace; use leader `q` to return to the shell.

Tile arrangements, sizes, inputs, and active groups use the existing per-session editor persistence. Old layouts restore as editor tiles. Switching sessions or returning to shell mode retains buffers and terminal processes. Terminal tiles use the session directory and normal terminal profiles, close confirmations, and reconnection behavior. Their `e` and `e --wait` commands return to the owning session. The floating terminal remains a separate companion shell on Cmd+Shift+T or leader `t t`.

## Floating terminal and terminal ownership

In editor mode, press **Cmd+Shift+T**, use leader `t t`, or run **Toggle Floating Terminal** to open a centered companion shell over the editor. Each outer session owns one companion shell, separate from its main shell. The first open uses the editor session’s directory and configured local terminal profile. Later opens preserve the shell’s process, directory, and scrollback.

The header names the owning session, the shell, and its current directory, and has a close control. The shortcut, the close control, or a click in the editor outside the overlay hides it without terminating its process. Switching sessions or shell/editor modes also hides it. Plain Escape and Ctrl+C/D/R keep their terminal behavior; terminal find, copy/paste, scrolling, and selection remain available. The overlay follows the editor area when the window or sidebar is resized; it cannot be dragged or manually resized.

`e` from either shell opens files in its owning editor session and hides the overlay. `e --wait` still waits for the requested files to close, not for a mode change or dismissal. A companion shell’s `cd` alone does not update Explorer; an explicit `e` request uses its invoking directory as usual.

Reload/restart uses upstream terminal persistence and reconnection for both shells; the overlay always starts hidden. If the companion exits or cannot reconnect, the next toggle creates a replacement. Closing an outer session disposes both shells after save/discard/cancel decisions and configured running-process confirmation. Hiding the overlay never asks to kill a process.

The session controller owns terminal creation. The floating host has its own creation capability and keeps its shells outside the panel and outer tab strip. Terminal tiles are created through New Tile. Ordinary integrated-terminal creation and splits, terminal-backed tasks/debugging, and extension-created terminals remain blocked. Other editor features, including debugging without a terminal, remain available. Multiple companion shells, floating tabs/splits, dragging, resizing, and task/debug routing are deferred.

## Floating file browser

In editor mode, **Cmd+Shift+E**, leader `f b`, or **Toggle Floating File Browser** opens a Telescope-style file manager. Cmd+P remains Quick Open. The browser and other floating tools are mutually exclusive; switching sessions or returning to shell mode dismisses the browser.

Results rise from a bottom prompt, with the best match nearest the prompt and a file or directory preview alongside. Type to fuzzy-filter the current folder. Up/Down or Ctrl+J/K moves the cursor; Enter enters the focused folder or opens the file in a pinned editor. Backspace on an empty prompt goes to the parent. Escape enters normal mode, where j/k moves, h (or g) goes to the parent, l opens, G goes to the last row, e goes home, w returns to the browser root, t changes that root, f toggles the recursive folder finder, and `.` toggles dotfiles; with native Vim, gg goes to the first row. The same keys apply with every Vim engine. Use i or / to resume filtering; q or a second Escape closes.

Tab/Shift+Tab marks an entry and advances/reverses through the results. Marks survive directory changes and filtering; s (Ctrl+S in insert mode) toggles marks on visible entries. In normal mode, c creates, r renames, m moves, y copies, and d deletes. Insert mode provides Alt+C/R/M/Y/D for the same operations. Mark files, navigate to the destination, and use move/copy; without marks, these actions prompt for a relative destination. Rename collects all names before making changes. A trailing slash creates a folder; Shift+Enter creates from the filter prompt. Collisions never overwrite silently. Delete prefers Trash, follows Explorer confirmation preferences, and explicitly confirms permanent deletion and unsaved changes. File edits participate in VS Code’s working-copy and supported undo workflows; folder deletion may not be undoable.

Use **Actions / Help**, ? in normal mode, or Ctrl+/ in insert mode for searchable actions and shortcut help. Actions have remappable `terminalFirst.fileBrowser.*` command IDs. F6 cycles focus between the picker, preview, and actions control. Ctrl+D/U scrolls the preview without leaving the picker. o (Ctrl+O in insert mode) opens the focused entry with its default application.

Each editor session remembers its last folder, browser root, and hidden-file preference, and the memory survives restarts. Reopening clears the filter and marks; a missing remembered folder falls back to the session directory. Browsing and changing the browser root do not change the workspace or shell directory. Dotfiles start hidden; ignored and excluded files remain visible. Folder finding includes empty directories and never recursively follows directory symlinks. Previews retain unsaved text from existing models; binary, unreadable, and files larger than 1 MiB show a placeholder and remain openable. The preview hides in narrow editor areas. Recursive file search is not included.

## Branding

The displayed app name is **VS NOSH**, with generated artwork at `resources/darwin/vs-nosh.png` and the multi-resolution macOS icon at `resources/darwin/vs-nosh.icns`. Electron packaging and DMG creation use the new icon. Internal command IDs, URL scheme, bundle identifier, and storage directories retain their existing `terminal-first` names to preserve compatibility.

Every Terminal First surface takes its colors from registered `terminalFirst.*` theme colors that default to existing workbench colors, so any theme works and each surface can be overridden through `workbench.colorCustomizations`. See [Theming and customization](docs/specs/07-workbench-branding-distribution.md#theming-and-customization) for the full list.

## Validation

```sh
node --test extensions/terminal-first/test/cli.test.cjs
npm run build-fast -- --client-only
./scripts/test.sh --run vs/workbench/contrib/terminalFirst/test/browser/tileListNavigation.test --run vs/workbench/contrib/terminalFirst/test/browser/terminalFirstNavigation.test --run vs/workbench/contrib/terminalFirst/test/browser/fileBrowserModel.test --run vs/workbench/contrib/terminalFirst/test/browser/floatingFileBrowser.test --run vs/workbench/contrib/terminalFirst/test/browser/floatingTerminal.test --run vs/workbench/contrib/terminalFirst/test/browser/terminalFirstService.test --run vs/workbench/contrib/terminalFirst/test/browser/terminalFirstPolicy.test --run vs/workbench/services/editor/test/browser/editorGroupsService.test --run vs/workbench/services/editor/test/browser/editorService.test
```

For interactive acceptance, launch two windows and open files from both. Exercise new files, quoted paths, unsaved close cancellation, repeated toggles, multiple sessions, Vim `:w` / `:q` / search, `e --wait`, per-tab directories, blocked sidebar/terminal commands, cancelled session closes, and window reload. Check a long-running shell command and its PID before and after toggling. Exercise the floating terminal’s shortcut, Hide control, editor click dismissal, shell exit/recreation, and `e --wait` from its companion shell. Confirm a companion PID survives dismissal, session switches, and reload without adding outer tabs. Plain Escape and Ctrl+C/D/R must retain their shell behavior. Also check light, dark, and high contrast themes.

Shell mode suppresses ordinary notification toasts and the startup trust prompt. Urgent notifications remain visible; other notifications stay in the center and appear as a count beside the session tabs. Clicking the count enters the editor and opens the center. The first entry to an untrusted editor workspace requests trust. Your Do Not Disturb preference is unchanged.

## Boundaries

The first milestone targets local macOS shells, with zsh as the primary smoke-test target. Remote development, embedded Neovim, tmux-specific behavior, installers, automatic updates, and additional platform support are deferred. The shell helper requires the built-in Terminal First extension; disabling it disables `e`. Terminal PATH mutations can be overridden by custom shell startup scripts, so preserve the injected PATH or re-enable upstream shell integration if `e` disappears from a customized login shell.

## Native Vim preview

The first-party Vim engine is enabled by default with `"terminalFirst.vim.engine": "native"`. Reload after changing engines. If VSCodeVim is enabled, the app disables it in this profile and requests one further reload before native input takes ownership. `"extension"` restores VSCodeVim when the native engine disabled it; `"off"` disables modal input. Profiles without an explicit engine setting use native Vim; explicit `"extension"` and `"off"` settings are respected.

Native editing includes Normal, Insert, Replace, Visual character/line/block modes; counted motions and operators; word, quote, bracket and paragraph text objects; registers, macros and dot repeat; searches, marks and jump navigation. Insert mode uses the existing editor typing, completion and snippet machinery. Modal edits and insert sessions use explicit undo transactions. Registers, file marks, macros, and the last search persist per profile across windows and restarts; set `terminalFirst.vim.persistRegisters` to `false` to keep them in memory only. Jump navigation is scoped to the outer shell/editor session and is separate from the curated file jump list.

In Normal mode, Space opens a discoverable command hierarchy: `f` files, `b` buffers, `w` panes, `s` search, `c` code actions, `j` curated jumps, and `t` sessions/terminal. `Space ?` searches the available actions. Ctrl+W also enters the pane commands. `terminalFirst.vim.leader` changes the leader and `terminalFirst.vim.hintDelay` controls the default 250 ms hint delay. Pending leaders remain pending until completed or cancelled; Escape cancels without executing anything.

`terminalFirst.vim.remaps` accepts entries such as `{ "mode": "normal", "before": ["H"], "after": ["0"] }` or `{ "mode": "normal", "before": ["K"], "command": "editor.action.showHover" }`. Mappings are nonrecursive. Cycles, duplicate mappings, and ambiguous prefixes are rejected as a set. An unmatched partial sequence is replayed through the original modal input behavior.

Pane commands operate on whole tiles: `wn`/`wp` cycle focus, `wh`/`wj`/`wk`/`wl` focus left/down/up/right, and `wH`/`wJ`/`wK`/`wL` move a tile beside its neighbor. Prefix these with your leader, or use `Ctrl+W` followed by the suffix after `w`. `wv`/`ws` open the New Tile picker with an explicit right/below split. `wx` plus a direction swaps tiles, `wo` toggles the split direction, `w=` balances sizes, and `wr` enters resize mode. `wq` closes the tile, subject to save and running-process confirmations. `:sp`/`:split` and `:vs`/`:vsplit` split the current editor tile below/right and show the current file in the new tile, subject to the same room checks. Buffer commands `bn`/`bp` cycle within the current editor tile in tab order; `bb` lists that tile’s buffers by recent use. The equivalent Ex commands (`:bn`, `:bp`, `:buffers` and their aliases) also stay within the current tile.

Quick pickers start with ordinary filtering. Escape enters Normal mode, `j/k` moves, `gg/G` selects first/last, `i` or `/` returns to filtering, and `q/Escape` dismisses. With native Vim enabled, the floating file browser additionally uses `h/l` for parent/open, `.` for hidden files and `gg/G` for first/last. The browser's existing file-operation commands remain available. Shell input, including Escape and Ctrl keys, is unchanged.

The supported colon commands are `:w`, `:wa`, `:q`, `:wq`, `:x`, `:e [path]`, `:bn`/`:bnext`, `:bp`/`:bprevious`, `:bd`/`:bdelete`, `:buffers`/`:ls`, `:sp`/`:split`, `:vs`/`:vsplit`, and line numbers. Substitution uses `:s/pattern/replacement/`, optionally prefixed by `%` or the visual `'<,'>` range, with `g`, `i` and `c` flags. Patterns and replacement captures use JavaScript regular expressions (`$1`, `$&`, named captures), not Vim's regex dialect. Unsupported commands and invalid expressions report errors. Dirty buffer closing uses the standard save/discard/cancel flow.

Native Vim is still a preview: it does not execute vimrc, Vim plugins, arbitrary Ex commands or shell escapes. Full Vim parity is not claimed. Multi-cursor editing is available in Insert mode; Escape keeps the primary cursor. Complete IME/layout, completion/snippet, large-file, shared-model and full-session acceptance remains outstanding; the optional VSCodeVim setup path is retained as a fallback.


## Global leader and scrollback

Press **Ctrl+Space** in the shell, editor, or floating terminal with any Vim engine. In the shell, `e` opens the editor, `n`/`p` switch sessions, `s` picks a session, `c` creates one, `x` closes it, `r` reloads, and `?` shows help. In the editor, `q` or Escape returns to the shell while preserving buffers; the existing file, buffer, pane, search, code, jump-list, and terminal groups remain available. Native Vim also accepts its configured normal-mode leader and Ctrl+W. Pending leader keys are consumed rather than sent to the terminal.

Leader `[` enters copy mode in the main shell or focused floating terminal. Vim counts, motions, search (`/`, `?`, `n`, `N`), `v`, and `V` operate on a read-only snapshot. Yank with a Vim yank operation or Enter; the result goes to the clipboard and copy mode exits. `[[`/`]]` navigate recorded shell-integration command markers. `q` or Escape exits without copying. Shell output continues; buffer trimming, terminal resize, and changing sessions may end copy mode safely. Alternate-screen applications are excluded.

For VSCodeVim, map normal-mode Space to the same leader:

```json
"vim.normalModeKeyBindingsNonRecursive": [
  { "before": ["<space>"], "commands": ["terminalFirst.leader"] }
]
```

## Terminal appearance and packaged launch

VS Code’s default Dark Modern theme remains the baseline. VS NOSH Dark and Light remain available as opt-in themes for further refinement; neither is selected automatically. Terminal defaults use JetBrains Mono with SF Mono/Menlo fallbacks, size 13, line height 1.2, a blinking block cursor, 10,000 lines of scrollback, GPU acceleration, and unmodified theme contrast. `terminalFirst.terminal.padding` controls padding in pixels (default 12); changes apply live. Fonts are not bundled.

On Apple Silicon, `./scripts/terminal-first-app.sh` builds the bundled app once and launches it with the same isolated directories as the dev launcher. Use `--build` to rebuild after changing sources. The development launcher skips prelaunch when Electron and client output already exist, so rebuild changed sources before launching. See [the configuration roadmap](docs/specs/08-terminal-configuration-roadmap.md) for planned configuration features and [startup verification](docs/specs/07-workbench-branding-distribution.md) for measured results and outstanding acceptance work.
