# Spec 4: Floating File Browser

## Status

The browser is committed in `b1a5c38c84b`. In the working tree, these are uncommitted: file operations (`fileBrowserOperations.ts`), marks, a Telescope-style bottom prompt, root and home navigation, the folder finder, an actions/help picker, and remappable command IDs. Available only in editor mode.

## Problem and goals

Explorer lives in a sidebar that VS NOSH keeps hidden. The user needs a keyboard-first, Telescope- or oil-style way to browse, preview, and manipulate files without leaving the editor. `Cmd+P` Quick Open stays available for fuzzy file finding.

## Behavior

### Opening and layout

- **S4.1** `Cmd+Shift+E`, leader `f b`, or the **Toggle Floating File Browser** command opens the browser over the editor area at 80% of its width and height. It is mutually exclusive with the other overlays, and it closes on a session or surface change.
- **S4.2** The browser opens at the session's remembered folder, falling back to the session directory if the folder is missing. Each session remembers its last folder, browser root, and hidden-file preference in memory only. Reopening clears the filter and marks. This state persists in workspace storage across restarts.
- **S4.3** Results rise from a bottom prompt, with the best match nearest the prompt. A preview pane sits alongside and is hidden when the overlay is narrower than 600 px.
- **S4.4** Browsing never changes the workspace folder or the shell cwd.

### Filtering and navigation

- **S4.5** The browser has two modes: insert (filtering) and normal. Typing fuzzy-filters the current folder. With the folder finder on, it filters folders recursively under the root.
- **S4.6** Enter opens a file as a pinned editor and closes the browser, or enters a folder. Backspace on an empty prompt goes to the parent folder.
- **S4.7** Dotfiles start hidden. Ignored and excluded files stay visible. The folder finder includes empty folders and does not follow directory symlinks recursively.

### Marks and operations

- **S4.8** Tab and Shift+Tab mark an entry and move forward or back. Marks survive filtering and directory changes. `s` (or `Ctrl+S` in insert mode) toggles marks on visible entries.
- **S4.9** The operations are create (`c`), rename (`r`), move (`m`), copy (`y`), and delete (`d`). In insert mode they are on Alt plus the same letter.
- **S4.10** Create: a trailing `/` creates a folder. Shift+Enter creates the prompt text directly.
- **S4.11** Move and copy with marks: the marked items go into the current folder. Without marks, the user is prompted for a destination relative to the current folder.
- **S4.12** Rename collects every new name before changing anything.
- **S4.13** Every batch is preflighted before any change: invalid names (empty, `.`, `..`, control characters, backslash), read-only sources or destinations, existing targets, moves into self, and overlapping targets each abort the whole batch. Nothing is ever overwritten.
- **S4.14** Delete moves items to the Trash when available and `files.enableTrash` allows it. It confirms when `explorer.confirmDelete` is set, and always confirms permanent deletes or deletes of items with unsaved changes.
- **S4.15** Changes go through `IBulkEditService` in one undo group, with confirmation before undo, so open editors and working copies follow renames. If a batch fails partway, the error says how many operations completed ("Completed N of M operations…"). Folder deletion may not be undoable.

### Preview and help

- **S4.16** Preview shows a read-only editor for text files, using live unsaved text if the file is open. Folders show a listing. Binary, unreadable, or larger than 1 MiB files show a placeholder and can still be opened.
- **S4.17** `Ctrl+D` and `Ctrl+U` scroll the preview. F6 cycles focus between list, preview, and actions. `o` (or `Ctrl+O`) opens the item with the system default app.
- **S4.18** `?` (or `Ctrl+/`) opens a searchable picker of every browser action with its keys.

## Keys

| Action (`terminalFirst.fileBrowser.*`) | Normal | Insert | Both |
| --- | --- | --- | --- |
| `down` / `up` | `j` / `k` | | `↓`/`↑`, `Ctrl+J`/`Ctrl+K` |
| `first` / `last` | `gg` (native Vim only) / `G` | | |
| `parent` | `h` / `g` | `Ctrl+G` | |
| `home` / `root` / `setRoot` | `e` / `w` / `t` | `Ctrl+E` / `Ctrl+W` / `Ctrl+T` | |
| `browser` (folder finder) | `f` | `Ctrl+F` | |
| `hidden` | `.` | `Ctrl+H` | |
| `all` (toggle marks) | `s` | `Ctrl+S` | |
| `systemOpen` | `o` | `Ctrl+O` | |
| `create` / `rename` / `move` / `copy` / `delete` | `c` / `r` / `m` / `y` / `d` | `Alt+C/R/M/Y/D` | |
| `accept` | (`l` with native Vim) | | `Enter` |
| `createPrompt` | | | `Shift+Enter` |
| `mark` / `markPrevious` | | | `Tab` / `Shift+Tab` |
| `escape` | | | `Esc` (insert → normal → close) |
| `close` | `q` | | |
| `insert` / `filter` | `i` / `/` | | |
| `backspace` | | `Backspace` | |
| `help` | `?` | `Ctrl+/` | |
| `focus` | | | `F6` |
| `previewDown` / `previewUp` | | | `Ctrl+D` / `Ctrl+U` |

Bindings use weight `ExternalExtension + 1001`, scoped to `terminalFirstBrowserFocused && !quickInputVisible` plus `terminalFirstBrowserMode`. Context keys: `terminalFirstBrowserVisible`, `terminalFirstBrowserFocused`, `terminalFirstBrowserMode` (`insert` or `normal`).

## Implementation

- `floatingFileBrowser.ts` and `.css`: UI, modes, preview, and action registration.
- `fileBrowserModel.ts`: listing, filtering, marks, the folder finder, and hidden-file state.
- `fileBrowserOperations.ts`: preflight and bulk-edit application.
- `nativeVimPickers.ts`: the native Vim key overlay (`h`, `l`, `.`, `gg`, `G`).
- `TerminalFirstService.toggleFloatingFileBrowser`: lifecycle and the generation guard against stale opens.

## Tests

- `fileBrowserModel.test.ts` (9 tests)
- `fileBrowserOperations.test.ts` (10 tests)
- `floatingFileBrowser.test.ts` (7 tests)

## Known gaps and risks

- `Cmd+Shift+E` replaces "Focus Explorer"; the Explorer tile stays on Ctrl+Option+E and `f e`. `Cmd+E` keeps its upstream meaning.
- There is no recursive *file* search; `Cmd+P` is the fallback.
- A batch that fails partway can leave a partly applied state. Undo covers files but may not cover folder deletion.
- Large folders render every entry. Folder-finder performance on large trees (for example, `node_modules`) is unmeasured.

## Open questions

1. Resolved: Vim. `h`/`l` parent/open, `.` hidden files, `G` last (and `gg` first with native Vim) apply in every engine; `g` stays as a second parent key.
2. Should the folder finder honor `files.exclude` and `.gitignore` by default?
3. Resolved: per-session folder, root, and hidden-file state persist in workspace storage (`terminalFirst.fileBrowser.sessions`).
4. Should there be a "reveal current file" entry point (open the browser at the active file's folder with it focused)?

## Release acceptance

- [ ] Open, filter, navigate, and open a file. Reopen and confirm the remembered folder.
- [ ] Mark files across two folders, then move and copy them into a third. Collisions abort with nothing changed.
- [ ] Rename a file that is open and dirty. The editor follows it and the dirty state is preserved.
- [ ] Delete to Trash and undo. Permanent delete confirms.
- [ ] Previews: large, binary, unsaved, and folder.
- [ ] All keys work in both engines. The help picker matches the actual bindings.
- [ ] Narrow window hides the preview. Themes and screen reader labels are correct.
