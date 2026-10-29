# VS NOSH

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
| Find a file (editor mode) | `Cmd+P` |
| Command Palette (editor mode) | `Cmd+Shift+P` |

The persistent session strip contains terminal tabs, close buttons, New Terminal, and Open Editor / Return to Terminal. Ordinary launch selects the shell; explicit file, diff, or merge launches select an editor session. Each tab remembers its own surface, open files, diff inputs, editor splits, and unsaved buffers. Switching tabs does not close editors or terminate shells. Closing the last editor returns to its shell. Closing a session resolves save/discard/cancel decisions before removing its editor tabs and honors terminal process confirmation. Closing the final session creates a fresh shell.

Shell mode hides the panel header entirely and prevents sidebar, panel, and workbench commands from revealing tools. Normal terminal input, copy/paste, selection, scrolling, and find remain available. Editor mode restores Explorer, activity bar, status bar, and editor tabs. The layout controls and Open in Agents title-bar button are absent in both modes. The former Toggle Workbench Tools command is removed.

`e` supports local files and new unsaved files. It sends the invoking directory along with the originating terminal session identity. Open Editor uses shell directory detection, then the last known directory, then the initial shell directory. Explorer, search, and source control follow the active editor session’s directory; open files remain in that session even after `cd`. Directory arguments to `e` remain unsupported. `EDITOR='e --wait'` is supported, and switching surfaces or sessions does not release the wait.

The window uses a managed `.code-workspace` file in its own workspace storage. User-owned workspace files are not rewritten. Settings and the extension host are shared across tabs. Folder changes use the normal workspace service and notifications, but do not restart the extension host: doing so would break pending shell CLI requests. Extensions that assume the first workspace folder never changes may require an explicit extension-host restart. Remote development and fully isolated extension environments per tab are outside this milestone.

Editor groups remain alive while inactive and are excluded from active navigation. Save All, backups, and shutdown still include retained editors. Files opened in multiple sessions share the underlying document model. Session metadata uses persisted shell integration nonces; editor layouts use normal editor serialization and dirty-buffer backups. Reload/restart uses upstream terminal reconnection or revival. If a terminal cannot reconnect, its editor state is retained and a replacement shell is created when needed. A revived shell may be a new process.

## Terminal ownership and future floating terminals

The outer session controller is the only user-facing terminal creator. Integrated terminal creation, splits, terminal editors, terminal-backed tasks/debugging, and extension-created terminals are blocked. Other editor features, including debugging without a terminal, remain available. Guards exist at command, view-opening, layout, and terminal-creation boundaries, with context keys controlling terminal actions.

A future floating terminal should be a separate presentation host owned by the active editor session, with an explicit creation capability distinct from `terminalFirstSession`. Extend the terminal-creation policy with that capability, add its lifecycle/restore state to the session controller, and route only approved task/debug requests into that host. Keep the outer tab strip and shell-mode restrictions intact. Tests must cover closing the float, switching sessions, running processes, restoration, and CLI waits. No floating terminal is implemented in this version.

## Branding

The displayed app name is **VS NOSH**, with generated artwork at `resources/darwin/vs-nosh.png` and the multi-resolution macOS icon at `resources/darwin/vs-nosh.icns`. Electron packaging and DMG creation use the new icon. Internal command IDs, URL scheme, bundle identifier, and storage directories retain their existing `terminal-first` names to preserve compatibility.

## Validation

```sh
node --test extensions/terminal-first/test/cli.test.cjs
npm run build-fast -- --client-only
./scripts/test.sh --run vs/workbench/contrib/terminalFirst/test/browser/terminalFirstService.test --run vs/workbench/contrib/terminalFirst/test/browser/terminalFirstPolicy.test --run vs/workbench/services/editor/test/browser/editorGroupsService.test --run vs/workbench/services/editor/test/browser/editorService.test
```

For interactive acceptance, launch two windows and open files from both. Exercise new files, quoted paths, unsaved close cancellation, repeated toggles, multiple sessions, Vim `:w` / `:q` / search, `e --wait`, per-tab directories, blocked sidebar/terminal commands, cancelled session closes, and window reload. Check a long-running shell command and its PID before and after toggling. Plain Escape and Ctrl+C/D/R must retain their shell behavior. Also check light, dark, and high contrast themes.

On a first launch, complete VS Code's normal workspace trust prompt before starting a shell. Terminal First preserves that upstream behavior.

## Boundaries

The first milestone targets local macOS shells, with zsh as the primary smoke-test target. Remote development, embedded Neovim, tmux-specific behavior, installers, automatic updates, and additional platform support are deferred. The shell helper requires the built-in Terminal First extension; disabling it disables `e`. Terminal PATH mutations can be overridden by custom shell startup scripts, so preserve the injected PATH or re-enable upstream shell integration if `e` disappears from a customized login shell.
