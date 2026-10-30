# Spec 3: Floating Terminal

## Status

Committed in `b1a5c38c84b`. The working tree removes the **Hide** button, moves the shortcut from `Ctrl+Backtick` to `Cmd+Shift+T` (leader `t t`), and moves the shared overlay chrome into `floatingOverlay.css`. Available only in editor mode.

## Problem and goals

The editor has no integrated panel terminal. The user still needs a quick shell while editing, without leaving editor mode or losing the session's main shell.

## Behavior

- **S3.1** In editor mode, `Cmd+Shift+T`, leader `t t`, or the **Toggle Floating Terminal** command shows a centered overlay terminal over the editor area. The same keys hide it again.
- **S3.2** Each session owns at most one companion shell, separate from its main shell. It never appears as a strip tab or panel terminal.
- **S3.3** The first open starts in the session's stored floating cwd, then the session's editor directory, then the main shell's initial cwd, using the configured local terminal profile. Contributed (extension) profiles are skipped.
- **S3.4** Later opens reuse the same process, so cwd, scrollback, and running jobs persist.
- **S3.5** Hiding (shortcut, or a mouse-down in the editor outside the overlay) never terminates or prompts. Switching sessions, changing surface, or opening another overlay also hides it. Only one floating tool is visible at a time.
- **S3.6** Escape and `Ctrl+C`, `Ctrl+D`, `Ctrl+R` go to the shell. Find, copy, paste, selection, scrolling, and the terminal context menu work.
- **S3.7** The overlay follows the editor area on window and sidebar resizes. It cannot be dragged or resized.
- **S3.8** `e` and `code` from the companion shell open in the owning session and hide the overlay (S2.6). `cd` in the companion does not move Explorer.
- **S3.9** If the companion exits, the overlay hides and the next toggle creates a replacement.
- **S3.10** On reload, companions reconnect via upstream persistence (matched by `floatingNonce`). The overlay always starts hidden.
- **S3.11** Closing the session disposes the companion after the S1.9 confirmations.

## Surface

| Item | Value |
| --- | --- |
| Command | `terminalFirst.toggleFloatingTerminal`, "Toggle Floating Terminal", `Cmd+Shift+T`, precondition `terminalFirstFloatingEnabled` |
| Context keys | `terminalFirstFloatingVisible`, `terminalFirstFloatingFocused` |
| Launch flag | `IShellLaunchConfig.terminalFirstFloating` (hidden from user, force-persisted) |

## Implementation

- `floatingTerminal.ts` and `floatingTerminal.css`: the host element. It attaches the existing `ITerminalInstance` and shows a title header.
- `floatingOverlay.ts` and `floatingOverlay.css`: shared centered geometry and chrome, used by all three overlays.
- `TerminalFirstService.toggleFloatingTerminal` and `hideFloating`: lifecycle and focus.
- `terminalService.ts`, `terminalGroup.ts`, `terminalInstanceService.ts`: floating instances bypass groups and panel promotion. Background revival restores them as floating.
- `terminalFirstPolicy.floatingVisible` opens the terminal interaction allowlist (S1.22) while the overlay is shown.

## Tests

`floatingTerminal.test.ts` (1 test), plus floating cases in `terminalFirstService.test.ts` and `terminalService.test.ts`.

## Known gaps and risks

- `Cmd+Shift+T` replaces "Reopen Closed Editor"; `Cmd+T` keeps its upstream meaning.
- With the Hide button gone, mouse-only users can dismiss the overlay only by clicking the editor.
- The overlay has no visible indication of its owning session or cwd beyond the terminal title.
- No support for multiple companions, tabs, splits, dragging, or resizing.
- Task and debug output cannot be routed here.

## Open questions

1. Should the overlay be resizable, or remember a size?
2. Resolved: `Cmd+T` is back on Go to Symbol in Workspace; the floating terminal uses `Cmd+Shift+T` and leader `t t`.
3. Should tasks run in the companion terminal instead of being blocked?

## Release acceptance

- [ ] Toggle repeatedly. The PID is stable, and scrollback and cwd are preserved.
- [ ] Hide by shortcut and by editor click. A running job continues.
- [ ] Escape and `Ctrl+C`, `Ctrl+D`, `Ctrl+R` reach the shell. Find, copy, and paste work.
- [ ] `exit` in the companion, then toggle, creates a new shell.
- [ ] Reload: the companion PID survives and the overlay starts hidden.
- [ ] Session switch hides the overlay. Each session has its own companion.
- [ ] Light, dark, and high-contrast themes. Resize the window and sidebar while open.


## Shared terminal controls

The companion uses the same configured terminal padding, font, and theme as the main shell. Ctrl+Space invokes the global leader regardless of Vim engine; leader `[` copies scrollback, and editor leader `t t` toggles the companion. Copy mode consumes keys while active and leaves the shell running. Session/surface changes cancel it. CLI environment injection is workbench-owned for both shells.
