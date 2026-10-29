# Terminal First

A terminal-first fork of Code - OSS for developers who want to live in the shell and open a GUI editor when they need one.

The app opens into a full-window terminal. Run `e src/app.ts` to edit a file with VS Code's editor and Vim-style modal editing, then press `Cmd+Escape` to return to the same shell. Your buffers, editor splits, shell processes, and scrollback stay in place as you switch.

This is an early macOS source build aimed at becoming a personal daily driver. Packaged releases and automatic updates are not available yet.

## The experience

- **Shell on launch.** Ordinary windows start in the terminal; explicit file launches open the editor.
- **An editor on demand.** `e file` opens local files in the originating window, including paths with spaces and files that do not exist yet. `e --wait file` waits until the requested files close.
- **Vim-style editing.** A pinned VSCodeVim extension provides modal editing. Its mode, pending keys, command line, and messages remain visible inside the editor while the status bar is hidden.
- **Less permanent UI.** Sidebars, activity bar, status bar, editor tabs, terminal tabs, minimap, breadcrumbs, and command center are hidden by default. Workbench tools remain available through commands and a reveal shortcut.
- **Several shell sessions.** Create, cycle through, and pick terminal sessions from the keyboard.
- **An isolated profile.** Development launchers keep settings, extensions, and shared data under `.build/terminal-first`, separate from an installed VS Code profile.

The editing engine is VS Code with VSCodeVim; this version does not embed a Neovim runtime. Your existing shell tools can remain at the center of navigation, builds, Git, and other development work, while VS Code's language and workbench features remain accessible.

## Build and run

Prerequisites: macOS, Node.js `24.22.1` as specified in [.nvmrc](.nvmrc), npm, and the Xcode command line tools. Additional native build requirements follow [upstream's contribution guide](https://github.com/microsoft/vscode/wiki/How-to-Contribute).

```sh
git clone --branch terminal-first https://github.com/noshpotosh/editor.git
cd editor
npm run install-fast
npm run build-fast
./scripts/setup-terminal-first-vim.sh
./scripts/terminal-first.sh /path/to/project
```

The setup script installs VSCodeVim `1.32.4` from its GitHub release and verifies its SHA-256 checksum. The initial launch downloads the development Electron runtime and prepares upstream built-in extensions. Complete the normal workspace trust prompt before starting a shell in a new workspace.

The launcher does not install a global command or edit shell dotfiles. To install another extension from a VSIX:

```sh
./scripts/terminal-first-cli.sh --install-extension /path/to/extension.vsix
```

## Everyday workflow

Inside the app's shell:

```sh
# Open one or several files in the GUI editor.
e src/app.ts
e src/app.ts 'notes with spaces.txt'

# Wait for the requested file to close.
e --wait COMMIT_EDITMSG

# Pass filenames beginning with a dash.
e -- -notes.txt
```

`e` resolves paths against the shell's current directory and opens files in that shell's window. Switching back to the terminal does not release `--wait`; closing its requested files does. Closing the last editor also returns to the shell, with the usual save/discard/cancel behavior for unsaved files.

Directory arguments are not supported by `e`. Open a project with `./scripts/terminal-first.sh /path/to/project` from outside the app. Within the app's shells, `EDITOR='e --wait'` can be used by programs that invoke an external editor.

| Action | macOS shortcut |
| --- | --- |
| Switch shell / editor | `Cmd+Escape` |
| New shell session | `Cmd+Option+N` |
| Previous / next shell session | `Cmd+Option+Left` / `Cmd+Option+Right` |
| Pick a shell session | `Cmd+Option+P` |
| Reveal / hide workbench tools | `Cmd+Option+U` |
| Find a file | `Cmd+P` |
| Command Palette | `Cmd+Shift+P` |

When no editor is open, switching to the editor opens Quick Open. Revealing workbench tools restores conventional chrome and opens Explorer. Shell mode fills the workbench again when you return to it.

## Implementation

The fork keeps VS Code's existing editor, terminal, extension host, and restoration machinery. The workbench controller changes layout and focus rather than recreating terminal processes or closing buffers. The built-in shell integration routes `e` through a window-scoped CLI connection and uses a persisted session identifier to return focus to the right terminal. A small editor overlay mirrors VSCodeVim's status entries.

See [TERMINAL_FIRST.md](TERMINAL_FIRST.md) for detailed behavior, restoration notes, validation steps, and limitations. The main additions live in the [workbench contribution](src/vs/workbench/contrib/terminalFirst) and [shell integration extension](extensions/terminal-first).

## Validation and current limits

The implementation has passed the full development build, client type checking, lint on changed TypeScript, layer checks, 49 focused Electron workbench tests, and 7 CLI tests. The tests cover mode switching, session routing, file arguments, waiting for file closure, terminal revival, and related terminal and status-bar behavior.

Visual and interactive acceptance is still pending: the Mac was locked during implementation. The interactive checklist is in [TERMINAL_FIRST.md](TERMINAL_FIRST.md#validation).

The first milestone targets local macOS shells, with zsh as the primary interactive test target. Remote development, embedded Neovim, tmux-specific integration, installers, automatic updates, and deeper removal of workbench features are deferred. Terminal reconnection and revival retain upstream VS Code's guarantees; a revived terminal may be a new process rather than the original process.

## Upstream and license

Based on [microsoft/vscode](https://github.com/microsoft/vscode), release `1.144.0`, commit `2c33b50b16c472efe58357d1d2a8a5414bc23fbf`. This repository contains the Code - OSS source, with the terminal-first changes maintained on the `terminal-first` branch. In the development checkout, `origin` points to `noshpotosh/editor` and `upstream` points to `microsoft/vscode`.

VSCodeVim is maintained by [VSCodeVim/Vim](https://github.com/VSCodeVim/Vim) and installed separately by the setup script. This is an independent source fork, not Microsoft's Visual Studio Code distribution.

Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the [MIT license](LICENSE.txt); third-party notices remain in [ThirdPartyNotices.txt](ThirdPartyNotices.txt).
