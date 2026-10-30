# Spec 2: `code` and `e` Shell Commands

## Status

`e` is committed (`679a6f01f20`). `code`, and support for running with no file arguments, are uncommitted. Both are provided by the built-in `terminal-first` extension and are only active inside VS NOSH shells.

## Problem and goals

From any VS NOSH shell, the user must be able to open files in *this* window's editor, in the session the command was typed in, and use it as `$EDITOR` for git and other tools.

## Behavior

- **S2.1** `e <file>...` and `code <file>...` open each file as a pinned editor in the session that owns the invoking shell, then switch that session to editor mode.
- **S2.2** `code` (or `e`) with no arguments switches the invoking session to editor mode, rooted at the shell's current directory, and focuses the editor.
- **S2.3** Paths resolve relative to the shell's cwd. Spaces and quoting are preserved. Files that do not exist open as new unsaved editors.
- **S2.4** `--` ends option parsing (`e -- -notes.txt`). Unknown options are errors. `--help` prints usage.
- **S2.5** `--wait` blocks until every requested file has been closed in its owning session. Switching surfaces, switching sessions, or hiding overlays does not release the wait. `EDITOR='e --wait'` is supported.
- **S2.6** Commands typed in a session's floating terminal (spec 3) open in that same session and hide the overlay.
- **S2.7** The invoking directory is sent with each request and becomes the session's editor directory (S1.13).
- **S2.8** Directory arguments are rejected. Non-`file:` URIs are rejected.
- **S2.9** Outside a VS NOSH shell, the command fails with "Run code inside a Terminal First shell." Messages are prefixed `code:` for both binaries.
- **S2.10** If the shell's session no longer exists, the request fails with a message telling the user to open a new shell session.

## Mechanism

1. On activation, the extension (`extensions/terminal-first/extension.cjs`) asks the workbench for its window id (`_terminalFirst.windowId`). It then writes a pointer file `window-<id>.json` containing the extension host's CLI socket path (`VSCODE_IPC_HOOK_CLI`), written atomically with mode `0600`, into its global storage.
2. Through a persistent environment variable collection, it prepends `extensions/terminal-first/bin` to `PATH` and sets `TERMINAL_FIRST_NODE` (Electron's binary) and `TERMINAL_FIRST_CLI_POINTER`.
3. Each terminal also gets `TERMINAL_FIRST_SESSION`, the shell integration nonce of that terminal.
4. `bin/e` and `bin/code` are shell scripts that run `cli.cjs` with `ELECTRON_RUN_AS_NODE=1`.
5. `cli.cjs` posts `{ type: 'terminalFirstOpen', fileURIs, terminalSession, wait, cwd }` to the socket. `extHostCLIServer.ts` routes the request to `_terminalFirst.openFiles`, which calls `TerminalFirstService.openFiles`.
6. The workbench initializes the shell environment (`terminalFirst.initializeShell`) before creating any shell, so the first shell already has `PATH` set.

## Surface

| Item | Value |
| --- | --- |
| Binaries | `extensions/terminal-first/bin/e`, `extensions/terminal-first/bin/code` |
| Environment | `PATH` prefix, `TERMINAL_FIRST_NODE`, `TERMINAL_FIRST_CLI_POINTER`, `TERMINAL_FIRST_SESSION` |
| Commands | `terminalFirst.initializeShell` (extension), `_terminalFirst.windowId`, `_terminalFirst.openFiles` (workbench) |
| Activation | `onStartupFinished`, `onCommand:terminalFirst.initializeShell` |

## Implementation

`extensions/terminal-first/{extension.cjs,cli.cjs,bin/*,package.json,package.nls.json}`, `src/vs/workbench/api/node/extHostCLIServer.ts`, `src/vs/workbench/api/node/extHostExtensionService.ts`, and `TerminalFirstService.openFiles`.

## Tests

`extensions/terminal-first/test/cli.test.cjs` (8 tests): argument parsing, help, `--`, quoting, relative paths, `--wait`, launcher argument preservation, and bare `code` sending only the cwd. The workbench side is covered by `terminalFirstService.test.ts`.

## Known gaps and risks

- **`code` shadows VS Code's own CLI** inside VS NOSH shells. Scripts or muscle memory that expect `code --install-extension`, `code --diff`, `code -r`, or `code <folder>` will get "Unknown option" or a directory error. Decide which `code` options to support or pass through, or rename.
- The help text says `Usage: code …` even when invoked as `e`.
- Directory arguments are unsupported, even though `code .` is the most common VS Code invocation.
- Custom shell startup files that reset `PATH` remove the commands. The workaround is documented but not detected.
- Disabling the built-in extension silently disables both commands.
- Pointer files in global storage are never cleaned up after windows close.
- Diff, merge, goto (`file:line:col`), and `--new-window` are not supported.

## Open questions

1. Should `code` be a fuller VS Code CLI (`.` / folder, `-g file:line`, `--diff`) or should only `e` be installed?
2. Should `code <dir>` set the session directory and open the editor there?
3. Should the wait handshake survive a window reload?

## Release acceptance

- [ ] `e a.ts 'b c.ts' new.txt` from nested directories in two windows opens in the right window and session.
- [ ] `code` with no arguments opens the editor at the current cwd. After `cd`, a second `code` re-roots Explorer.
- [ ] `git commit` with `EDITOR='e --wait'` blocks until the editor closes, across session switches.
- [ ] `e` from the floating terminal opens in the owning session.
- [ ] `e` outside VS NOSH, and in a shell whose session was closed, print the documented errors.
- [ ] Works in zsh with a heavy `.zshrc` (oh-my-zsh, starship), and in bash.
