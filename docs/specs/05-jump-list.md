# Spec 5: Jump List

## Status

Uncommitted and not documented in `TERMINAL_FIRST.md` or `README.md`. Available only in editor mode.

## Problem and goals

When working across a handful of files, the user wants a short, ordered, hand-curated list of files per project that they can jump to instantly, in the style of Harpoon. It is separate from editor tabs, editor history, and Vim's automatic jump list.

## Behavior

- **S5.1** **Add File to Jump List** (`Cmd+Shift+A`, leader `j a`) appends the active file editor's file to the current project's list. The entry captures the cursor's line and column. Adding a file already in the list updates its position in the same slot; adding at the same position is a no-op. The result is announced to screen readers ("Added … / … is already in the jump list").
- **S5.2** The *project* is the nearest ancestor of the session directory that contains `.git`, or the session directory itself. The directory is found from the session cwd, the workspace folder, the shell's initial cwd, or the active file's folder, in that order.
- **S5.3** Lists are stored per project in profile storage. They survive restarts and are shared by all sessions and windows that resolve to the same project.
- **S5.4** **Toggle Floating Jump List** (`Cmd+Shift+J`, leader `j j`) shows a numbered list overlay titled "Jump List — `<project path>`". It is mutually exclusive with the other overlays. The cursor starts on the active file if it is listed.
- **S5.5** Rows show file icons and paths relative to the project, or absolute paths for files outside it, followed by the saved line number when available.
- **S5.5a** A preview pane beside the rows shows the focused file the same way the file browser does (S4.16): a read-only editor with live unsaved text, or a placeholder for binary, missing, or larger than 1 MiB files. It is hidden when the overlay is narrower than 600 px. While the next file loads, the previous preview stays on screen; there is no loading flash.
- **S5.6** Keys in the list:

  | Keys | Action |
  | --- | --- |
  | `j` / `↓`, `k` / `↑` | Move |
  | `gg` / `G` | First / last |
  | `dd` | Remove (remembered for put) |
  | `p` / `P` | Put the last removed entry after / before the cursor |
  | `u` / `Ctrl+R` | Undo / redo list edits |
  | `Ctrl+D` / `Ctrl+U` | Scroll the preview |
  | `Enter`, double-click | Open as pinned editor at the saved line and column and close |
  | `q`, `Esc`, Close button, editor click | Close |

- **S5.7** Opening a file that no longer exists shows an inline error and keeps the list open.
- **S5.8** When the list is empty, it shows: "No files yet. Focus a file editor and press Cmd+Shift+A to add it."
- **S5.9** IME composition and keys with Cmd or Alt held are ignored, so system shortcuts pass through.
- **S5.10** With native Vim enabled, normal-mode keys in the list also go through the Vim key layer (`nativeVimPickers.ts`). The Space-led menu has `j j` (open list) and `j a` (add file).

## Surface

| Command | Title | Key | When |
| --- | --- | --- | --- |
| `terminalFirst.addToJumpList` | Add File to Jump List | `Cmd+Shift+A` | Editor mode, `editorTextFocus`, `resourceScheme == file`, no overlay visible |
| `terminalFirst.toggleFloatingJumpList` | Toggle Floating Jump List | `Cmd+Shift+J` | Editor mode |

Both bindings use weight `ExternalExtension + 1000`, to rank above extension defaults. Context keys: `terminalFirstJumpListVisible`, `terminalFirstJumpListFocused`. Storage: `terminalFirst.jumpList.v1.<project comparison key>` (profile, machine), as `{ version: 1, entries: { resource: string, lineNumber?: number, column?: number }[] }`. Legacy string entries still load as file-only bookmarks. Invalid saved positions are ignored. Malformed entries are dropped one at a time, and a damaged list loads empty.

## Implementation

- `jumpListModel.ts`: project resolution, load, save, add, remove, put, and undo/redo stacks.
- `floatingJumpList.ts` and `floatingJumpList.css`: `WorkbenchList` UI and key handling.
- `filePreview.ts` and `filePreview.css`: the preview pane shared with the file browser.
- `TerminalFirstService.addToJumpList`, `toggleFloatingJumpList`, `hideJumpList`: lifecycle and the generation guard.

## Tests

- `jumpListModel.test.ts` (6 tests)
- `floatingJumpList.test.ts` (4 tests)

## Known gaps and risks

- Only `file:` resources are supported. Saved positions are fixed line and column numbers; they do not track edits to the file.
- The project key depends on `.git` discovery. Nested repositories and worktrees each get separate lists. A project without `.git` keys on the session cwd, so a `cd` changes which list is shown.
- Not documented for users.

## Open questions

1. Final keybindings for add and toggle?
2. Resolved: entries record a cursor position, restored by both the floating list and direct slot shortcuts.
3. Resolved: `terminalFirst.jumpToSlot1`–`9` (leader `j 1`–`j 9`) open a slot without showing the list; inside the list, `1`–`9` open a slot and `J`/`K` move the focused entry. Undo history survives reopening the same project's list.
4. Is the project key right for monorepos and worktrees?

## Release acceptance

- [ ] Add 3 files, reorder, remove, put, undo, and redo. The list persists across reload and across sessions in the same repository.
- [ ] Select All still works in the editor (after the rebind).
- [ ] Missing-file error, empty state, and close by every method.
- [ ] Works with VSCodeVim and with the native engine.
- [ ] User documentation added to `TERMINAL_FIRST.md`.
