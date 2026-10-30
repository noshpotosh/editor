# VS NOSH changelog

Changes of the fork on top of upstream VS Code. Upstream release notes are at https://code.visualstudio.com/updates.

## Unreleased (upstream base 1.144.0)

- The shell starts in untrusted folders instead of waiting behind a trust dialog (`terminal.integrated.allowInUntrustedWorkspace` defaults to true); entering the editor still asks for trust.
- Startup measurement: `scripts/terminal-first-perf.sh` times packaged launches and quits; **Developer: Terminal First Startup Marks** lists the startup marks and slowest contributions; packaged builds now ship a Node compile cache (`quality: stable`), and the packaged launcher rebuilds when sources moved (`--build-only`, `--no-build-check`).
- Spaces: a session can hold several named tile layouts over the same directory and shell. With two or more, a space switcher appears at the left of the status bar (pills, collapsing into one entry past four). `Ctrl+Option+1`…`9`, `Ctrl+Option+[`/`]`, `Ctrl+Option+N`, leader `1`…`9`, and the leader `Tab` group switch, create, rename, close, and pick spaces. New spaces start from a preset (`terminalFirst.spaces.presets`: Code, Review, or your own) or empty with the New Tile picker; New Session from Preset (`t p`, shell `Ctrl+Space o`) opens a directory with a preset in one step. Layouts saved before spaces restore as `Space 1`.
- Upstream maintainability: fork behavior now reaches upstream code through seams (`EditorPartHooks`, `EditorGroupRouting`, `TerminalPolicy`, view container hosts) and one platform gate module. `build/fork/upstream-patches.json` lists every modified upstream file; `scripts/upstream-check.sh` verifies it and `scripts/upstream-sync.sh` merges upstream releases. See `docs/upstream/SYNC.md`.
- View tiles: moving focus into a tile lands on its list with a visible cursor. `.` lists the focused row's own context-menu actions for every view, including extension trees, by borrowing the view's menu. A tile holding a single moved view is named after that view. With native Vim on, every list in a tile accepts `j`/`k`/`h`/`l`, `gg`/`G`, Ctrl+D/U, folds, `/`, Space (leader), `.` (row, view, and tile actions), `m` (context menu), `F6` (toolbars), and `?` (help). Opt-in single-key row actions: `terminalFirst.vim.listActionKeys`.
- New Tile picker: grouped into Workspace, Tools, Web, and Extensions; every row has an icon, a name, and a description; empty container titles fall back to the first view's name, also on tile tabs.
- Shortcuts: `Cmd+A`, `Cmd+J`, `Cmd+E`, and `Cmd+T` keep their upstream meaning. The fork's overlays use `Cmd+Shift+A/J/E/T` and leader `j a`, `j j`, `f b`, `t t`.
- Tiles ease their border color when focus moves and show an opaque hover border under a resting pointer (`terminalFirst.tile.hoverBorder`, the midpoint of the active and inactive borders); reduced-motion settings disable the transition.
- The hover border also shows on the only open tile. The tiles sit in a rounded tray with no visible outer border in standard themes; contrast themes retain their outline. Session tabs no longer paint an editor-tab background on the title bar; the active tab lifts off the title bar like the command center (`terminalFirst.sessionTab.activeBackground` defaults to `commandCenter.activeBackground`).
- Vim keys and the `.` actions picker work in extension tree views, and the first row gets the cursor even when the tree fills in after the tile is focused.
- Leader `w b` and `w c` open the Jira board and Bitbucket tiles.
- Debugging no longer opens Run and Debug or the Debug Console tiles on its own (`debug.openDebug` and `debug.internalConsoleOptions` default to `neverOpen`).
- Report Issue files against `noshpotosh/editor`.
- Shell CLI: `e <dir>` opens the editor in a directory, `e -g file:line:col` opens at a position, and help and errors use the invoked name.
- Blocked workbench commands are logged once and the first one in the shell shows a hint to open the editor.
- Jump list: slots (`j 1` to `j 9`, digits in the list), `J`/`K` reordering, undo history kept across reopening.
- Sessions can be renamed (`t r`, shell `Ctrl+Space R`); the floating terminal header shows session, shell, and directory with a close control.
- File browser uses the Vim vocabulary in every engine and remembers each session's folder across restarts.
- Native Vim persists registers, marks, macros, and the last search per profile (`terminalFirst.vim.persistRegisters`), closes an undo transaction when a key fails, and avoids a whole-document copy on visual selection.
