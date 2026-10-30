# Spec 6: Vim Editing (VSCodeVim Integration and Native Engine Preview)

## Status

- VSCodeVim integration (pinned VSIX, setup script, inline mode indicator) is committed.
- The native engine is uncommitted and opt-in (`terminalFirst.vim.engine: "native"`). The default remains `"extension"`.

## Problem and goals

Modal editing is a core part of the terminal-first workflow. VSCodeVim works, but it is an external extension with its own keybinding conflicts, latency, and status-bar plumbing. The native engine aims at a smaller, first-party Vim that works with VS NOSH's sessions, pickers, and overlays, with no extension host round trip.

## Behavior: engine selection

- **S6.1** `terminalFirst.vim.engine` is `native`, `extension` (default), or `off`. Changing it shows "Reload the window to change the Vim engine."
- **S6.2** `native` or `off` with VSCodeVim enabled: VS NOSH disables VSCodeVim for the profile, records that it did so (`terminalFirst.vim.disabledExtension`), and asks for one more reload. Native input takes over only after that reload.
- **S6.3** `extension` after a native-initiated disable: VS NOSH re-enables VSCodeVim and asks for a reload. VSCodeVim disabled by the user is left alone.
- **S6.4** With `extension`, VSCodeVim's status entries are shown as an inline overlay in the focused editor (`terminalFirstVimStatus.ts`), because the status bar is hidden by default.

## Behavior: native engine

- **S6.5** Modes: Normal, Insert, Replace, Visual (character, line, block), Operator-pending, Search, and Command line.
- **S6.6** Counted motions and operators. Word, quote, bracket, and paragraph text objects. `f`/`t` repeat. Marks, searches, and jumps.
- **S6.7** Registers (including `+` and `*` for the clipboard), macros, and dot repeat. Registers, marks, and macros are kept in memory for the window (`VimSharedState`) and are lost on reload.
- **S6.8** Insert mode uses the normal editor typing pipeline, so completion, snippets, auto-closing, and multi-cursor work. Escape keeps the primary cursor.
- **S6.9** Each modal edit and each insert session is one undo step, implemented with a new `ITextModel.beginUndoRedoTransaction()` (S6.20).
- **S6.10** The Vim jump list (`Ctrl+O`/`Ctrl+I`) is scoped to the outer session and is separate from the curated jump list (spec 5).
- **S6.11** Ex commands: `:w`, `:wa`, `:q`, `:wq`, `:x`, `:e [path]`, `:bn`/`:bnext`, `:bp`/`:bprevious`, `:bd`/`:bdelete`, `:buffers`/`:ls`, `:sp`/`:split`, `:vs`/`:vsplit`, `:<line>`, and `:[%|'<,'>]s/pat/rep/[gic]`. Substitution uses JavaScript regular expressions (`$1`, `$&`, named groups), not Vim regex. Unsupported commands report an error. Closing a dirty buffer uses the standard save/discard/cancel flow.
- **S6.12** Not supported: vimrc, plugins, arbitrary Ex commands, and shell escapes. Full Vim parity is not claimed.

## Behavior: leader menu

- **S6.13** In Normal mode, the leader key (default Space) or `Ctrl+W` starts a sequence. After `hintDelay` ms (default 250), a hint panel lists the available continuations. Escape cancels. An incomplete sequence stays pending.

  | Group | Keys → command |
  | --- | --- |
  | `f` files | `ff` Quick Open · `fe` file browser · `fs` save |
  | `b` buffers | `bb` all editors · `bn` / `bp` next / previous · `bd` close |
  | `w` panes (also `Ctrl+W`) | `wh` `wj` `wk` `wl` focus · `wv` / `ws` split · `wq` close group |
  | `s` search | `ss` find in files · `sy` workspace symbols |
  | `c` code | `ca` quick fix · `cr` rename · `cf` format · `cd` next diagnostic |
  | `j` jumps | `jj` open jump list · `ja` add file |
  | `t` terminal | `tt` floating terminal · `ts` pick session · `tn` new session |
  | `?` | Search all actions (also the command **Search Native Vim Actions**) |

## Behavior: remaps

- **S6.14** `terminalFirst.vim.remaps` takes `{ mode, before: string[], after?: string[], command?: string }` entries. `after` and `command` are mutually exclusive. Modes: `normal`, `insert`, `visual`, `visualLine`, `visualBlock`, `operator`, `replace`.
- **S6.15** Mappings are nonrecursive. Cycles, duplicates, and ambiguous prefixes reject the *whole* set. An unmatched partial sequence is replayed through the normal modal input.

## Behavior: pickers

- **S6.16** In any quick pick, the first Escape enters a picker Normal mode: `j`/`k` move, `gg`/`G` first/last, `i` or `/` return to filtering, Enter accepts, `q` or Escape closes. The prompt shows the available keys.
- **S6.17** In the file browser's normal mode: `h` goes to the parent, `l` opens, `.` toggles hidden files, and `gg`/`G` go to first/last (spec 4).
- **S6.18** Terminal input is never intercepted.

## Surface

| Setting | Type | Default |
| --- | --- | --- |
| `terminalFirst.vim.engine` | `native` \| `extension` \| `off` | `extension` |
| `terminalFirst.vim.leader` | 1 character | `" "` |
| `terminalFirst.vim.hintDelay` | 0–2000 ms | `250` |
| `terminalFirst.vim.remaps` | array | `[]` |

Command: `terminalFirst.vim.help` (Search Native Vim Actions). Storage: `terminalFirst.vim.disabledExtension` (profile). VSCodeVim defaults applied by the fork: `vim.showmodename`, `vim.useCtrlKeys`, `vim.showMarksInGutter`, and `vim.statusBarColorControl: false`.

## Implementation

| Concern | File |
| --- | --- |
| Modal grammar (host-agnostic, UTF-16 offsets) | `src/vs/editor/contrib/nativeVim/common/nativeVim.ts` |
| Remap compiler and validation | `src/vs/editor/contrib/nativeVim/common/vimRemapping.ts` |
| Service contract | `src/vs/editor/contrib/nativeVim/common/nativeVimService.ts` |
| Editor host (key capture, cursor rendering, IME, model edits) | `src/vs/editor/contrib/nativeVim/browser/nativeVimContribution.ts`, `nativeVim.css` |
| Workbench service: leader menu, Ex commands, settings, engine switching | `src/vs/workbench/contrib/terminalFirst/browser/nativeVim.ts`, `nativeVim.css` |
| Picker and overlay layer | `src/vs/workbench/contrib/terminalFirst/browser/nativeVimPickers.ts` |
| VSCodeVim status overlay | `src/vs/workbench/api/browser/terminalFirstVimStatus.ts` |
| Undo transaction API | `src/vs/editor/common/model.ts`, `model/textModel.ts` |
| VSCodeVim install | `scripts/setup-terminal-first-vim.sh` (v1.32.4, SHA-256 pinned) |

- **S6.20** `beginUndoRedoTransaction()` returns a disposable. While any transaction is open, `pushStackElement` and `popStackElement` are no-ops, and nested transactions share one element. This is an **unconditional change to the core text model** and applies even when `terminalFirstEnabled` is false.

## Tests

- `nativeVim.test.ts` (24 tests): grammar.
- `nativeVimContribution.test.ts` (13 tests): editor host.

The workbench service, leader menu, Ex commands, remap validation UI, and pickers have no dedicated tests.

## Known gaps and risks

- **Performance.** The engine works on the full document string (`model.getValue()`, cached per version id), and IME composition compares full-text snapshots. Each edit then copies the whole buffer. Large files will lag. A model-backed `VimHost` is needed before the engine becomes the default.
- **Undo transaction safety.** If a transaction is not disposed (for example, an exception mid-insert, or a model swap), the model stops creating undo stops. The interface comment says the owner must end it before undo, model switch, or dispose. This needs defensive tests and a watchdog.
- **Leader hints** hard-code "Space" in the `?` picker descriptions even when the leader is changed.
- The `off` engine also disables VSCodeVim. Confirm this is intended.
- Registers, marks, and macros are not persisted (no viminfo or shada equivalent).
- The help picker, the browser's `(Native Vim)` labels, and the jump-list hints each describe keys separately. A single source of truth would keep them in sync.
- The acceptance areas still required (from `TERMINAL_FIRST.md`): IME and keyboard layouts, completion and snippets, large files, shared models across sessions, and a full session workflow.

## Open questions

1. What is the bar for switching the default to `native` and dropping the VSCodeVim setup step?
2. Should the core undo transaction API be upstreamed, or isolated behind the gate?
3. Persist registers, marks, and macros?
4. Which Ex commands are required for 1.0 (for example `:noh`, `:g`, `:norm`, `:r`)?
5. Vim regex compatibility for `:s` and `/`: translate patterns, or document JavaScript regex?

## Release acceptance

- [ ] Engine switching in all directions (`extension` ↔ `native` ↔ `off`) with the reload prompts. VSCodeVim state is restored correctly.
- [ ] Japanese and Chinese IME, dead keys, and non-US layouts (AZERTY, Dvorak) in every mode.
- [ ] Completion, snippets, and multi-cursor in Insert mode. A single undo step per insert.
- [ ] A 50k-line file: key latency stays under one frame for motions and edits.
- [ ] The same file open in two sessions: edits, undo, and marks behave.
- [ ] Every leader action, `Ctrl+W`, remap validation errors, and picker normal mode.
- [ ] `:w`, `:q`, `:wq`, `:x` with dirty buffers, `e --wait` release, and `:s` with flags and ranges.
