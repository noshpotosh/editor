# Spec 1: Shell-First Sessions

## Status

Committed in `679a6f01f20` and `f593d5d6849`. Reworked in the working tree: the shell/editor toggle command and strip buttons were removed, and startup flash prevention was added. Enabled whenever `terminalFirstEnabled` is true.

## Problem and goals

Developers who live in a terminal want the shell to be the primary surface and the GUI editor to appear only when they ask for it, without leaving the window or losing shell state.

Goals:

- The window opens as a full-window shell with no workbench chrome.
- A window holds several independent *sessions*. Each session is one shell plus the editor state that belongs to it.
- Switching sessions or surfaces never kills a process or closes an editor.
- In shell mode, workbench commands cannot reveal sidebars or panels behind the user's back.

## Behavior

### Startup

- **S1.1** An ordinary launch shows the active session's shell. A launch with files to open, diff, or merge shows that session's editor.
- **S1.2** The workbench grid stays invisible (`terminal-first-starting` class) until the session controller has settled the layout. Startup failures still remove the class so the window stays usable.
- **S1.3** The splash screen does not replay the saved editor layout (`workbench.ts` in `electron-browser`), so the editor layout never flashes before the shell.
- **S1.4** Before any shell starts, the window enters a *managed workspace*: `vs-nosh.code-workspace` in the window's workspace storage folder. Existing workspace-scoped settings are copied in. User-owned `.code-workspace` files are never rewritten. Entering the workspace happens first because it restarts the extension host, which owns the CLI socket (spec 2).
- **S1.5** If no sessions survive restoration, one fresh shell session is created.

### Sessions

- **S1.6** A session has an id (the shell integration nonce), a title (the live terminal title), a mode (`shell` or `editor`), a working directory, a main terminal, and optionally a companion floating terminal (spec 3).
- **S1.7** New Shell Session creates a shell in the active session's detected working directory and shows it in shell mode.
- **S1.8** Next/Previous cycle sessions with wraparound. Pick Session shows a quick pick. Each switch restores the target session in the mode it was last in.
- **S1.9** Closing a session:
  1. If either of its shells has child processes and `terminal.integrated.confirmOnKill` is `always` or `panel`, it asks for confirmation first.
  2. It activates the session's editors, so save/discard/cancel dialogs refer to visible files. Cancelling any dirty-editor prompt aborts the close.
  3. It disposes both shells, forgets per-session file browser state, and activates the next session.
  4. Closing the final session creates a fresh shell session.
- **S1.10** If a session's main shell exits while in shell mode, a replacement shell is created for that session.

### Surfaces

- **S1.11** Shell mode: the panel is maximized and centered at the bottom with its header hidden. Activity bar, status bar, sidebar, auxiliary bar, sashes, and the panel frame are hidden. The title-bar toolbar and window title are hidden.
- **S1.12** Editor mode: the panel is hidden and the status bar is shown. The activity bar, sidebar, and auxiliary bar are removed: `layout.ts` refuses to show the sidebar or auxiliary bar whenever `terminalFirstEnabled`, and views open as tiles (S9.18).
- **S1.13** Entering editor mode sets the session's directory, using the first available of: an explicit `cwd` from the CLI, the shell's detected cwd (shell integration), the stored session cwd, the shell's initial cwd, or the current workspace folder. The managed workspace's single folder is then replaced with that directory. A missing directory is an error.
- **S1.14** Closing the last editor in an editor-mode session returns that session to shell mode.
- **S1.15** `Ctrl+Space e` opens the editor; `Ctrl+Space q` or `Ctrl+Space Escape` returns to the shell without closing buffers.
- **S1.16** All surface changes are serialized through one `Sequencer`, so rapid key presses cannot interleave transitions.

### Per-session editors

- **S1.17** Each session owns its own editor groups, splits, open files, diff inputs, and dirty buffers (`editorGroupsService.mainPart.sessions`). Inactive sessions' groups stay alive but are excluded from navigation.
- **S1.18** Save All, hot exit backups, and shutdown include editors in inactive sessions. All sessions' editor groups are activated once during startup so their backups are restored.
- **S1.19** A file open in several sessions shares one text model.
- **S1.20** Editor groups found at startup without a matching shell become "Recovered Session" entries in editor mode.

### Policy gate

- **S1.21** In shell mode, every `workbench.*` command is dropped, except reload, close window, quit, full screen, and zoom (`isTerminalFirstCommandAllowed`, enforced in `CommandService.executeCommand`).
- **S1.22** `workbench.action.terminal.*` commands are allowed only for in-terminal interactions: copy, paste, select all, clear, find, scroll, `sendSequence`, `sizeToContentWidth`. In editor mode they are allowed only while the floating terminal is visible.
- **S1.23** Terminal creation is blocked unless the session controller or floating host authorizes it. This blocks splits, terminal editors, terminal-backed tasks and debugging, and extension-created terminals. The blocked call fails with "Use the session strip to open a terminal…".

### Session strip

- **S1.24** SessionTabsWidget occupies the main window’s 36 px custom title bar. Tabs display mode glyphs and dirty indicators, plus close and New Terminal buttons. Controls are not draggable; gaps retain window dragging.
- **S1.25** The strip is a `tablist`. Only the active tab is in the tab order. Left/Right arrows switch sessions and keep focus on the newly active tab. Focus is restored after re-render.

### Persistence

- **S1.26** Session list, active id, managed workspace URI, cwd, and floating-terminal nonce and cwd are stored under `terminalFirst.sessions` (workspace scope, machine target) on `onWillSaveState`.
- **S1.27** After reload, sessions reattach to shells by matching persisted shell integration nonces, using upstream terminal reconnection or revival. A revived shell may be a new process. If a terminal cannot reconnect, its editor state is kept and a replacement shell is created on demand.

## Surface

| Command ID | Title | Key | Notes |
| --- | --- | --- | --- |
| `terminalFirst.newTerminal` | New Shell Session | `Cmd+Option+N` | |
| `terminalFirst.nextTerminal` | Next Shell Session | `Cmd+Option+Right` | |
| `terminalFirst.previousTerminal` | Previous Shell Session | `Cmd+Option+Left` | |
| `terminalFirst.pickTerminal` | Switch Shell Session | `Cmd+Option+P` | |
| `_terminalFirst.windowId` | (internal) | | Used by the CLI extension |
| `_terminalFirst.openFiles` | (internal) | | CLI entry point (spec 2) |
| ~~`terminalFirst.toggle`~~ | ~~Toggle Shell / Editor~~ | ~~`Cmd+Escape`~~ | Removed in working tree |

All commands are in the "VS NOSH" category.

Context keys: `terminalFirstEnabled`, `terminalFirstShell`, `terminalFirstFloatingEnabled` (true in editor mode).

Storage: `terminalFirst.sessions` (workspace).

## Implementation

| Concern | File |
| --- | --- |
| Session controller | `src/vs/workbench/contrib/terminalFirst/browser/terminalFirstService.ts` |
| Service interface | `src/vs/workbench/services/terminalFirst/common/terminalFirst.ts` |
| Gate, policy, context keys | `src/vs/workbench/services/terminalFirst/common/terminalFirstPolicy.ts` |
| Commands and default settings | `src/vs/workbench/contrib/terminalFirst/browser/terminalFirst.contribution.ts` |
| Session tabs widget | `src/vs/workbench/browser/parts/terminalFirst/sessionStripPart.ts`, `sessionStrip.css` |
| Per-session editor groups | `src/vs/workbench/browser/parts/editor/editorPart.ts`, `editorGroupView.ts`, `editorGroupsService.ts` (`sessions` API) |
| Command gate | `src/vs/workbench/services/commands/common/commandService.ts` |
| Terminal creation gate | `src/vs/workbench/contrib/terminal/browser/terminalService.ts` |
| Layout and part registration | `src/vs/workbench/browser/layout.ts`, `workbench.ts`, `services/layout/browser/layoutService.ts` |

Design decisions:

- The terminal panel is reused as the shell surface instead of adding a new terminal host, so persistence, reconnection, and shell integration come from upstream.
- The extension host is shared by all sessions, and folder changes do not restart it, because a restart would break pending `e --wait` requests. Extensions that assume the first workspace folder never changes may misbehave.
- Launch authorization uses a `WeakSet` keyed by the launch config object instead of a global flag, so concurrent creations cannot borrow each other's permission.

## Tests

- `terminalFirstService.test.ts` (28 tests): session creation, switching, closing, mode transitions, persistence, floating interplay.
- `terminalFirstPolicy.test.ts` (5 tests): command gate.
- `editorGroupsService.test.ts` and `editorService.test.ts`: session-scoped editor groups.
- `terminalService.test.ts`, `localTerminalBackend.test.ts`: creation gate and reconnection.

## Known gaps and risks

- Global leader navigation now preserves dirty buffers when returning to the shell (S1.15).
- Status bar visibility has one source of truth: `present()` hides it in shell mode and shows it in editor mode (through `setPartHidden`); the `workbench.statusBar.visible: false` default only sets the startup state before the first presentation.
- The command gate returns `undefined` for blocked commands. Each blocked ID is logged once per window, and the first blocked workbench command in the shell shows a one-time hint that the command is available in the editor (Ctrl+Space e). Extensions still get no error.
- Workspace-scoped settings are copied once into the managed workspace. Later edits to an original `.code-workspace` file are not synced.
- Changing the workspace folder without an extension-host restart can leave language servers rooted at the previous folder.
- macOS and zsh only. Remote development, tmux, and per-session extension hosts are out of scope.

## Open questions

1. Resolved: global leader provides explicit editor/shell navigation.
2. Resolved: title-bar tabs show mode and dirty state.
3. Resolved: both; see Known gaps.
4. Resolved: `terminalFirst.renameSession` (leader `t r`, shell `Ctrl+Space R`) stores a custom title with the session; an empty title restores the shell title.
5. Resolved: visible in editor mode, hidden in shell mode (see Known gaps).

## Release acceptance

- [ ] Launch with no arguments shows only shell and strip, with no layout flash, in light, dark, and high-contrast themes.
- [ ] Launch with a file argument opens the editor directly.
- [ ] Create, switch (keys, strip, picker, arrow keys on the strip), and close several sessions. Shell PIDs survive switches.
- [ ] A long-running command keeps running across session and surface switches.
- [ ] Closing a session with dirty editors: save, discard, and cancel each behave correctly. Cancel leaves everything intact.
- [ ] Closing a session with a running process respects `confirmOnKill`.
- [ ] Closing the last session yields a fresh shell.
- [ ] In shell mode, `Cmd+B`, `Cmd+J`, `Cmd+Shift+E`, and similar shortcuts do nothing. Copy, paste, find, and scroll work in the terminal.
- [ ] Tasks, debugging with a terminal, and extensions that create terminals fail gracefully.
- [ ] Reload restores every session, its mode, its editors, and dirty buffers. PIDs are reported before and after.
- [ ] Workspace trust prompt on first launch still works.


### Startup integration update

Local folder launches are translated to a managed workspace in the main process before loading the renderer. Other launches retain the existing managed-workspace transition. The renderer recognizes managed files in workspace storage and avoids re-entering them. Shell launch configs directly supply PATH, the Electron runtime, and the window-scoped CLI pointer; extension registration and CLI initialization finish after presentation. `code/terminalFirst/*` performance marks expose each phase. The helper retries a missing pointer for up to two seconds.
