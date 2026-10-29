# Terminal First

A macOS development fork of VS Code that starts in a shell and opens the GUI editor on demand.

Repository: [noshpotosh/editor](https://github.com/noshpotosh/editor). Upstream: `microsoft/vscode`, release `1.144.0`, commit `2c33b50b16c472efe58357d1d2a8a5414bc23fbf`. The `origin` remote tracks this fork and `upstream` tracks Microsoft's repository.

## Build and run

Use Node `24.22.1` from `.nvmrc`, npm, and the macOS/Xcode command line tools required by upstream VS Code. This is a source development build; the first launch downloads Electron and prepares built-in extensions.

```sh
npm run install-fast
npm run build-fast
./scripts/setup-terminal-first-vim.sh
./scripts/terminal-first.sh /path/to/project
```

The setup script installs the pinned, checksum-verified VSCodeVim `1.32.4` VSIX from its GitHub release into this checkout's isolated extension directory. The launchers keep user data, extensions, and shared data under `.build/terminal-first`. They do not install a global command or change shell dotfiles. Other extensions can be installed with `./scripts/terminal-first-cli.sh --install-extension /path/to/extension.vsix`.

## Workflow

| Action | Command / shortcut |
| --- | --- |
| Open files from this window's shell | `e src/app.ts` |
| Open several files | `e src/app.ts 'notes with spaces.txt'` |
| Block until the requested files close | `e --wait COMMIT_EDITMSG` |
| Open a filename beginning with a dash | `e -- -notes.txt` |
| Switch shell / editor | `Cmd+Escape` |
| New shell session | `Cmd+Option+N` |
| Previous / next shell | `Cmd+Option+Left` / `Cmd+Option+Right` |
| Pick shell session | `Cmd+Option+P` |
| Reveal / hide workbench tools | `Cmd+Option+U` |
| Find a file | `Cmd+P` |
| Command Palette | `Cmd+Shift+P` |

The editor retains its open buffers, cursor positions, and splits when you return to the shell. Closing the final editor also returns to the shell. Closing an unsaved buffer retains VS Code's normal save/discard/cancel behavior. Vim's mode, pending keys, command line, and messages appear in a small overlay inside the active editor while the normal status bar is hidden.

Terminals keep their processes and scrollback across mode switches. Reload and application restart use upstream terminal restoration, including its distinction between reconnecting a live process and reviving a new one. A stable pointer to the window's CLI socket lets restored shells reach a restarted extension host. Session identity uses the terminal's persisted shell integration nonce, independently of whether shell integration injection is enabled.

`e` supports local files and new unsaved files. It resolves paths against the invoking shell's working directory and targets the originating window, even if another window has focus. Directory arguments are rejected; use `./scripts/terminal-first.sh /path/to/project` from outside the app to open a workspace. `--wait` remains blocked when switching surfaces and releases when its requested files close. It is also suitable for `EDITOR='e --wait'` within the app's shells.

## Validation

```sh
node --test extensions/terminal-first/test/cli.test.cjs
npm run build-fast -- --client-only
./scripts/test.sh --run vs/workbench/contrib/terminalFirst/test/browser/terminalFirstService.test
```

For interactive acceptance, launch two windows and open files from both. Exercise new files, quoted paths, unsaved close cancellation, repeated toggles, multiple sessions, Vim `:w` / `:q` / search, `e --wait`, tool reveal, and window reload. Check a long-running shell command and its PID before and after toggling. Plain Escape and Ctrl+C/D/R must retain their shell behavior. Also check light, dark, and high contrast themes.

On a first launch, complete VS Code's normal workspace trust prompt before starting a shell. Terminal First preserves that upstream behavior.

Validated in this checkout: full development build, client type checking, lint on changed TypeScript, layer checks, 49 focused Electron workbench tests, and 7 CLI tests. The Electron suites cover the mode controller, terminal process management, terminal revival, and extension status-bar behavior. Vim installation and shell-bridge activation were also checked. Visual and interactive acceptance remains pending because the Mac was locked during implementation.

## Boundaries

The first milestone targets local macOS shells, with zsh as the primary smoke-test target. Remote development, embedded Neovim, tmux-specific behavior, installers, automatic updates, and removing upstream workbench features are deferred. The shell helper requires the built-in Terminal First extension; disabling it disables `e`. Terminal PATH mutations can be overridden by custom shell startup scripts, so preserve the injected PATH or re-enable upstream shell integration if `e` disappears from a customized login shell.
