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
| Toggle floating terminal (editor mode) | `Ctrl+Backtick` |
| New shell session | `Cmd+Option+N` |
| Previous / next shell | `Cmd+Option+Left` / `Cmd+Option+Right` |
| Pick shell session | `Cmd+Option+P` |
| Browse files with preview (editor mode) | `Cmd+Shift+E` |
| Find a file (editor mode) | `Cmd+P` |
| Command Palette (editor mode) | `Cmd+Shift+P` |

The persistent session strip contains terminal tabs, close buttons, New Terminal, and Open Editor / Return to Terminal. Ordinary launch selects the shell; explicit file, diff, or merge launches select an editor session. Each tab remembers its own surface, open files, diff inputs, editor splits, and unsaved buffers. Switching tabs does not close editors or terminate shells. Closing the last editor returns to its shell. Closing a session resolves save/discard/cancel decisions before removing its editor tabs and honors terminal process confirmation. Closing the final session creates a fresh shell.

Shell mode hides the panel header entirely and prevents sidebar, panel, and workbench commands from revealing tools. Normal terminal input, copy/paste, selection, scrolling, and find remain available. Editor mode restores Explorer, activity bar, status bar, and editor tabs. The layout controls and Open in Agents title-bar button are absent in both modes. The former Toggle Workbench Tools command is removed.

`e` supports local files and new unsaved files. It sends the invoking directory along with the originating terminal session identity. Open Editor uses shell directory detection, then the last known directory, then the initial shell directory. Explorer, search, and source control follow the active editor session’s directory; open files remain in that session even after `cd`. Directory arguments to `e` remain unsupported. `EDITOR='e --wait'` is supported, and switching surfaces or sessions does not release the wait.

The window uses a managed `.code-workspace` file in its own workspace storage. User-owned workspace files are not rewritten. Settings and the extension host are shared across tabs. Folder changes use the normal workspace service and notifications, but do not restart the extension host: doing so would break pending shell CLI requests. Extensions that assume the first workspace folder never changes may require an explicit extension-host restart. Remote development and fully isolated extension environments per tab are outside this milestone.

Editor groups remain alive while inactive and are excluded from active navigation. Save All, backups, and shutdown still include retained editors. Files opened in multiple sessions share the underlying document model. Session metadata uses persisted shell integration nonces; editor layouts use normal editor serialization and dirty-buffer backups. Reload/restart uses upstream terminal reconnection or revival. If a terminal cannot reconnect, its editor state is retained and a replacement shell is created when needed. A revived shell may be a new process.

## Floating terminal and terminal ownership

In editor mode, press **Ctrl+Backtick**, click **Terminal** in the session strip, or run **Toggle Floating Terminal** to open a centered companion shell over the editor. Each outer session owns one companion shell, separate from its main shell. The first open uses the editor session’s directory and configured local terminal profile. Later opens preserve the shell’s process, directory, and scrollback.

The **Hide** button, shortcut, or a click in the editor outside the overlay hides it without terminating its process. Switching sessions or shell/editor modes also hides it. Plain Escape and Ctrl+C/D/R keep their terminal behavior; terminal find, copy/paste, scrolling, and selection remain available. The overlay follows the editor area when the window or sidebar is resized; it cannot be dragged or manually resized.

`e` from either shell opens files in its owning editor session and hides the overlay. `e --wait` still waits for the requested files to close, not for a mode change or dismissal. A companion shell’s `cd` alone does not update Explorer; an explicit `e` request uses its invoking directory as usual.

Reload/restart uses upstream terminal persistence and reconnection for both shells; the overlay always starts hidden. If the companion exits or cannot reconnect, the next toggle creates a replacement. Closing an outer session disposes both shells after save/discard/cancel decisions and configured running-process confirmation. Hiding the overlay never asks to kill a process.

The session controller owns terminal creation. The floating host has its own creation capability and keeps its shells outside the panel and outer tab strip. Integrated terminal creation, splits, terminal editors, terminal-backed tasks/debugging, and extension-created terminals remain blocked. Other editor features, including debugging without a terminal, remain available. Multiple companion shells, floating tabs/splits, dragging, resizing, and task/debug routing are deferred.

## Floating file browser

In editor mode, **Cmd+E**, the session strip’s **Files** button, or **Toggle Floating File Browser** opens a Telescope-style file manager. Cmd+P remains Quick Open. The browser and other floating tools are mutually exclusive; switching sessions or returning to shell mode dismisses the browser.

Results rise from a bottom prompt, with the best match nearest the prompt and a file or directory preview alongside. Type to fuzzy-filter the current folder. Up/Down or Ctrl+J/K moves the cursor; Enter enters the focused folder or opens the file in a pinned editor. Backspace on an empty prompt goes to the parent. Escape enters normal mode, where j/k moves, g goes to the parent, e goes home, w returns to the browser root, t changes that root, f toggles the recursive folder finder, and h toggles dotfiles. Use i or / to resume filtering; q or a second Escape closes.

Tab/Shift+Tab marks an entry and advances/reverses through the results. Marks survive directory changes and filtering; s (Ctrl+S in insert mode) toggles marks on visible entries. In normal mode, c creates, r renames, m moves, y copies, and d deletes. Insert mode provides Alt+C/R/M/Y/D for the same operations. Mark files, navigate to the destination, and use move/copy; without marks, these actions prompt for a relative destination. Rename collects all names before making changes. A trailing slash creates a folder; Shift+Enter creates from the filter prompt. Collisions never overwrite silently. Delete prefers Trash, follows Explorer confirmation preferences, and explicitly confirms permanent deletion and unsaved changes. File edits participate in VS Code’s working-copy and supported undo workflows; folder deletion may not be undoable.

Use **Actions / Help**, ? in normal mode, or Ctrl+/ in insert mode for searchable actions and shortcut help. Actions have remappable `terminalFirst.fileBrowser.*` command IDs. F6 cycles focus between the picker, preview, and actions control. Ctrl+D/U scrolls the preview without leaving the picker. o (Ctrl+O in insert mode) opens the focused entry with its default application.

Each editor session remembers its last folder, browser root, and hidden-file preference in memory. Reopening clears the filter and marks; a missing remembered folder falls back to the session directory. Browsing and changing the browser root do not change the workspace or shell directory. Dotfiles start hidden; ignored and excluded files remain visible. Folder finding includes empty directories and never recursively follows directory symlinks. Previews retain unsaved text from existing models; binary, unreadable, and files larger than 1 MiB show a placeholder and remain openable. The preview hides in narrow editor areas. Recursive file search and persistence across application restarts are not included.

## Branding

The displayed app name is **VS NOSH**, with generated artwork at `resources/darwin/vs-nosh.png` and the multi-resolution macOS icon at `resources/darwin/vs-nosh.icns`. Electron packaging and DMG creation use the new icon. Internal command IDs, URL scheme, bundle identifier, and storage directories retain their existing `terminal-first` names to preserve compatibility.

## Validation

```sh
node --test extensions/terminal-first/test/cli.test.cjs
npm run build-fast -- --client-only
./scripts/test.sh --run vs/workbench/contrib/terminalFirst/test/browser/fileBrowserModel.test --run vs/workbench/contrib/terminalFirst/test/browser/floatingFileBrowser.test --run vs/workbench/contrib/terminalFirst/test/browser/floatingTerminal.test --run vs/workbench/contrib/terminalFirst/test/browser/terminalFirstService.test --run vs/workbench/contrib/terminalFirst/test/browser/terminalFirstPolicy.test --run vs/workbench/services/editor/test/browser/editorGroupsService.test --run vs/workbench/services/editor/test/browser/editorService.test
```

For interactive acceptance, launch two windows and open files from both. Exercise new files, quoted paths, unsaved close cancellation, repeated toggles, multiple sessions, Vim `:w` / `:q` / search, `e --wait`, per-tab directories, blocked sidebar/terminal commands, cancelled session closes, and window reload. Check a long-running shell command and its PID before and after toggling. Exercise the floating terminal’s shortcut, Hide control, editor click dismissal, shell exit/recreation, and `e --wait` from its companion shell. Confirm a companion PID survives dismissal, session switches, and reload without adding outer tabs. Plain Escape and Ctrl+C/D/R must retain their shell behavior. Also check light, dark, and high contrast themes.

On a first launch, complete VS Code's normal workspace trust prompt before starting a shell. Terminal First preserves that upstream behavior.

## Boundaries

The first milestone targets local macOS shells, with zsh as the primary smoke-test target. Remote development, embedded Neovim, tmux-specific behavior, installers, automatic updates, and additional platform support are deferred. The shell helper requires the built-in Terminal First extension; disabling it disables `e`. Terminal PATH mutations can be overridden by custom shell startup scripts, so preserve the injected PATH or re-enable upstream shell integration if `e` disappears from a customized login shell.

## Native Vim preview

The first-party Vim engine is available behind `"terminalFirst.vim.engine": "native"`. Reload after changing engines. If VSCodeVim is enabled, the app disables it in this profile and requests one further reload before native input takes ownership. `"extension"` restores VSCodeVim when the native engine disabled it; `"off"` disables modal input. Existing profiles continue to default to the extension while native acceptance testing is in progress.

Native editing includes Normal, Insert, Replace, Visual character/line/block modes; counted motions and operators; word, quote, bracket and paragraph text objects; registers, macros and dot repeat; searches, marks and jump navigation. Insert mode uses the existing editor typing, completion and snippet machinery. Modal edits and insert sessions use explicit undo transactions. Registers and macros live in memory for the current window. Jump navigation is scoped to the outer shell/editor session and is separate from the curated file jump list.

In Normal mode, Space opens a discoverable command hierarchy: `f` files, `b` buffers, `w` panes, `s` search, `c` code actions, `j` curated jumps, and `t` sessions/terminal. `Space ?` searches the available actions. Ctrl+W also enters the pane commands. `terminalFirst.vim.leader` changes the leader and `terminalFirst.vim.hintDelay` controls the default 250 ms hint delay. Pending leaders remain pending until completed or cancelled; Escape cancels without executing anything.

`terminalFirst.vim.remaps` accepts entries such as `{ "mode": "normal", "before": ["H"], "after": ["0"] }` or `{ "mode": "normal", "before": ["K"], "command": "editor.action.showHover" }`. Mappings are nonrecursive. Cycles, duplicate mappings, and ambiguous prefixes are rejected as a set. An unmatched partial sequence is replayed through the original modal input behavior.

Quick pickers start with ordinary filtering. Escape enters Normal mode, `j/k` moves, `gg/G` selects first/last, `i` or `/` returns to filtering, and `q/Escape` dismisses. With native Vim enabled, the floating file browser additionally uses `h/l` for parent/open, `.` for hidden files and `gg/G` for first/last. The browser's existing file-operation commands remain available. Shell input, including Escape and Ctrl keys, is unchanged.

The supported colon commands are `:w`, `:wa`, `:q`, `:wq`, `:x`, `:e [path]`, `:bn`/`:bnext`, `:bp`/`:bprevious`, `:bd`/`:bdelete`, `:buffers`/`:ls`, `:sp`/`:split`, `:vs`/`:vsplit`, and line numbers. Substitution uses `:s/pattern/replacement/`, optionally prefixed by `%` or the visual `'<,'>` range, with `g`, `i` and `c` flags. Patterns and replacement captures use JavaScript regular expressions (`$1`, `$&`, named captures), not Vim's regex dialect. Unsupported commands and invalid expressions report errors. Dirty buffer closing uses the standard save/discard/cancel flow.

Native Vim is still a preview: it does not execute vimrc, Vim plugins, arbitrary Ex commands or shell escapes. Full Vim parity is not claimed. Multi-cursor editing is available in Insert mode; Escape keeps the primary cursor. Complete IME/layout, completion/snippet, large-file, shared-model and full-session acceptance remains required before changing the default engine or removing the optional VSCodeVim setup path.
