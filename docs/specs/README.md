# VS NOSH Feature Specs

These specs describe every feature this fork adds on top of upstream VS Code `1.144.0` (`2c33b50b16c`), as implemented on the `terminal-first` branch on 2026-10-29, including uncommitted work in the tree at that time. They are written to be refined into release requirements: each spec records the intended behavior, the current implementation, known gaps, and the open decisions blocking a release.

User-facing documentation lives in [`TERMINAL_FIRST.md`](../../TERMINAL_FIRST.md) and [`README.md`](../../README.md). Where those documents and the code disagree, these specs describe the code and flag the drift (see [Documentation drift](#documentation-drift)).

## Specs

| # | Feature | Status | Spec |
| --- | --- | --- | --- |
| 1 | Shell-first sessions (session strip, shell/editor surfaces, per-session editors, managed workspace, policy gate) | Committed, reworked in working tree | [01-shell-first-sessions.md](01-shell-first-sessions.md) |
| 2 | `code` / `e` shell commands | Committed (`e`), `code` uncommitted | [02-shell-cli.md](02-shell-cli.md) |
| 3 | Floating terminal (per-session companion shell) | Committed, restyled in working tree | [03-floating-terminal.md](03-floating-terminal.md) |
| 4 | Floating file browser (Telescope-style file manager) | Committed, file operations uncommitted | [04-floating-file-browser.md](04-floating-file-browser.md) |
| 5 | Jump list (per-project curated file bookmarks) | Uncommitted, undocumented | [05-jump-list.md](05-jump-list.md) |
| 6 | Native Vim engine (preview) and VSCodeVim integration | Uncommitted, opt-in | [06-native-vim.md](06-native-vim.md) |
| 7 | Workbench simplification, branding, and distribution | Mixed | [07-workbench-branding-distribution.md](07-workbench-branding-distribution.md) |

## Product summary

VS NOSH is a macOS fork of VS Code that opens as a full-window terminal and brings up the GUI editor on demand. A window holds several *sessions*; each session is a shell plus its own editor layout. Inside the editor, floating overlays (a companion terminal, a file browser, and a jump list) replace the side panels. Modal editing comes either from a pinned VSCodeVim extension or, as a preview, from a first-party Vim engine.

## Global gating

All fork behavior is gated by `terminalFirstEnabled` (`src/vs/workbench/services/terminalFirst/common/terminalFirstPolicy.ts`):

```ts
isNative && isMacintosh && product.urlProtocol === 'terminal-first'
```

When that check is false, the fork should behave like upstream VS Code. One exception exists today: the `defaultPinned` view-container property and the `beginUndoRedoTransaction` text-model API are unconditional core changes (see spec 7 and spec 6).

## Cross-cutting release blockers

These items affect several features. Each one is also covered in the relevant spec.

1. **No explicit way back to the shell from the editor (working tree).** The uncommitted changes removed the `terminalFirst.toggle` command (`Cmd+Escape`) and the strip's "Open Editor / Return to Terminal" button. The editor is now entered with `code` and left only by closing every editor in the session. `ITerminalFirstService.toggle()` and `showShell()` still exist but nothing calls them from the UI. Decide whether this is the intended model (spec 1).
2. **Keybinding collisions with macOS conventions.** `Cmd+A` (Select All) is taken over by Add File to Jump List whenever a file editor has focus. `Cmd+T` and `Cmd+E` are also rebound. See spec 5 and spec 7.
3. **`code` shadows the real VS Code CLI** inside VS NOSH shells (spec 2).
4. **Documentation drift.** Both user docs describe shortcuts and controls that no longer exist (below).
5. **Native Vim acceptance.** The engine reads the full document text on every key and has not been accepted for IME, large files, or shared models (spec 6).
6. **Distribution.** There is no packaged installer, signing, notarization, update channel, or CI pipeline for the fork. It runs only as a source build (spec 7).
7. **Upstream maintenance cost.** The fork edits about 40 upstream files (terminal service, editor part, command service, layout, text model, SCM, and others). Each upstream merge needs a re-validation pass. The list is in spec 7.

## Documentation drift

As of this snapshot, `TERMINAL_FIRST.md` and `README.md` still describe:

| Documented | Actual (working tree) |
| --- | --- |
| `Cmd+Escape` switches shell / editor | No such command; `code` opens the editor, closing all editors returns to the shell |
| `Ctrl+Backtick` toggles the floating terminal | `Cmd+T` |
| `Cmd+Shift+E` opens the file browser (in the workflow table) | `Cmd+E` (the prose section was updated) |
| Session strip has Files, Terminal, Open Editor / Return to Terminal buttons | Strip has session tabs, close buttons, and `+` only |
| Floating terminal has a **Hide** button | Removed; hide with `Cmd+T` or a click outside |
| Only `e` is installed | `code` and `e` are both on `PATH` |
| Jump list | Not documented anywhere |

## Validation entry points

```sh
node --test extensions/terminal-first/test/cli.test.cjs
npm run build-fast -- --client-only
./scripts/test.sh \
	--run vs/workbench/contrib/terminalFirst/test/browser/terminalFirstService.test \
	--run vs/workbench/contrib/terminalFirst/test/browser/terminalFirstPolicy.test \
	--run vs/workbench/contrib/terminalFirst/test/browser/floatingTerminal.test \
	--run vs/workbench/contrib/terminalFirst/test/browser/floatingFileBrowser.test \
	--run vs/workbench/contrib/terminalFirst/test/browser/fileBrowserModel.test \
	--run vs/workbench/contrib/terminalFirst/test/browser/fileBrowserOperations.test \
	--run vs/workbench/contrib/terminalFirst/test/browser/jumpListModel.test \
	--run vs/workbench/contrib/terminalFirst/test/browser/floatingJumpList.test \
	--run vs/editor/contrib/nativeVim/test/common/nativeVim.test \
	--run vs/editor/contrib/nativeVim/test/browser/nativeVimContribution.test \
	--run vs/workbench/services/editor/test/browser/editorGroupsService.test \
	--run vs/workbench/services/editor/test/browser/editorService.test \
	--run vs/workbench/contrib/terminal/test/browser/terminalService.test
```

## Spec template

Each spec uses these sections, so they can be refined consistently:

- **Status**: committed, uncommitted, or preview, plus the default state.
- **Problem and goals**: why the feature exists.
- **Behavior**: numbered requirements (`S1.3` = spec 1, requirement 3) that can be referenced from issues and tests.
- **Surface**: commands, keybindings, settings, context keys, and storage keys.
- **Implementation**: key files and design decisions.
- **Tests**: existing coverage.
- **Known gaps and risks**.
- **Open questions**: decisions needed before release.
- **Release acceptance**: the manual checklist.
