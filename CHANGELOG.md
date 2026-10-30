# VS NOSH changelog

Changes of the fork on top of upstream VS Code. Upstream release notes are at https://code.visualstudio.com/updates.

## Unreleased (upstream base 1.144.0)

- Upstream maintainability: fork behavior now reaches upstream code through seams (`EditorPartHooks`, `EditorGroupRouting`, `TerminalPolicy`, view container hosts) and one platform gate module. `build/fork/upstream-patches.json` lists every modified upstream file; `scripts/upstream-check.sh` verifies it and `scripts/upstream-sync.sh` merges upstream releases. See `docs/upstream/SYNC.md`.
- View tiles: moving focus into a tile lands on its list with a visible cursor. `.` lists the focused row's own context-menu actions for every view, including extension trees, by borrowing the view's menu. A tile holding a single moved view is named after that view. With native Vim on, every list in a tile accepts `j`/`k`/`h`/`l`, `gg`/`G`, Ctrl+D/U, folds, `/`, Space (leader), `.` (row, view, and tile actions), `m` (context menu), `F6` (toolbars), and `?` (help). Opt-in single-key row actions: `terminalFirst.vim.listActionKeys`.
- New Tile picker: grouped into Workspace, Tools, Web, and Extensions; every row has an icon, a name, and a description; empty container titles fall back to the first view's name, also on tile tabs.
- Shortcuts: `Cmd+A`, `Cmd+J`, `Cmd+E`, and `Cmd+T` keep their upstream meaning. The fork's overlays use `Cmd+Shift+A/J/E/T` and leader `j a`, `j j`, `f b`, `t t`.
- Tiles ease their border when focus moves and show a hover border under a resting pointer (`terminalFirst.tile.hoverBorder`); reduced-motion settings disable the transition.
- Leader `w b` and `w c` open the Jira board and Bitbucket tiles.
- Debugging no longer opens Run and Debug or the Debug Console tiles on its own (`debug.openDebug` and `debug.internalConsoleOptions` default to `neverOpen`).
- Report Issue files against `noshpotosh/editor`.
- Shell CLI: `e <dir>` opens the editor in a directory, `e -g file:line:col` opens at a position, and help and errors use the invoked name.
- Blocked workbench commands are logged once and the first one in the shell shows a hint to open the editor.
- Jump list: slots (`j 1` to `j 9`, digits in the list), `J`/`K` reordering, undo history kept across reopening.
- Sessions can be renamed (`t r`, shell `Ctrl+Space R`); the floating terminal header shows session, shell, and directory with a close control.
- File browser uses the Vim vocabulary in every engine and remembers each session's folder across restarts.
- Native Vim persists registers, marks, macros, and the last search per profile (`terminalFirst.vim.persistRegisters`), closes an undo transaction when a key fails, and avoids a whole-document copy on visual selection.
