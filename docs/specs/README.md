# VS NOSH Feature Specs

These specs describe every feature this fork adds on top of upstream VS Code `1.144.0` (`2c33b50b16c`), as implemented on the `terminal-first` branch on 2026-10-29, including uncommitted work in the tree at that time. They are written to be refined into release requirements: each spec records the intended behavior, the current implementation, known gaps, and the open decisions blocking a release.

User-facing documentation lives in [`TERMINAL_FIRST.md`](../../TERMINAL_FIRST.md) and [`README.md`](../../README.md). Where those documents and the code disagree, these specs describe the code and flag the drift (see [Documentation drift](#documentation-drift)).

## Specs

| # | Feature | Status | Spec |
| --- | --- | --- | --- |
| 1 | Shell-first sessions (title-bar tabs, shell/editor surfaces, per-session editors, managed workspace, policy gate) | Committed, reworked in working tree | [01-shell-first-sessions.md](01-shell-first-sessions.md) |
| 2 | `code` / `e` shell commands | Committed (`e`), `code` uncommitted | [02-shell-cli.md](02-shell-cli.md) |
| 3 | Floating terminal (per-session companion shell) | Committed, restyled in working tree | [03-floating-terminal.md](03-floating-terminal.md) |
| 4 | Floating file browser (Telescope-style file manager) | Committed, file operations uncommitted | [04-floating-file-browser.md](04-floating-file-browser.md) |
| 5 | Jump list (per-project curated file bookmarks) | Uncommitted, undocumented | [05-jump-list.md](05-jump-list.md) |
| 6 | Native Vim engine (preview) and VSCodeVim integration | Preview, enabled by default | [06-native-vim.md](06-native-vim.md) |
| 7 | Workbench simplification, branding, and distribution | Mixed | [07-workbench-branding-distribution.md](07-workbench-branding-distribution.md) |
| 8 | Terminal configuration roadmap | Planned | [08-terminal-configuration-roadmap.md](08-terminal-configuration-roadmap.md) |
| 9 | Tiling code workspace (tiles, layout commands, chords, focus-follows-mouse) | Uncommitted | [09-tiling-workspace.md](09-tiling-workspace.md) |
| 10 | Web app tiles: Jira board and Bitbucket (chromeless integrated browser tiles) | Uncommitted | [10-jira-board.md](10-jira-board.md) |
| 11 | Spaces (named tile layouts per session, strip above the status bar, chords and leader) | Uncommitted | [11-spaces.md](11-spaces.md) |

## Product summary

VS NOSH is a macOS fork of VS Code that opens as a full-window terminal and brings up the GUI editor on demand. A window holds several *sessions*; each session is a shell plus its own editor layout. Inside the editor, floating overlays (a companion terminal, a file browser, and a jump list) replace the side panels. Modal editing comes either from a pinned VSCodeVim extension or, as a preview, from a first-party Vim engine.

## Global gating

All fork behavior is gated by `terminalFirstEnabled` from `src/vs/platform/terminalFirst/common/terminalFirst.ts`, re-exported by `src/vs/workbench/services/terminalFirst/common/terminalFirstPolicy.ts` for workbench code:

```ts
isNative && isMacintosh && product.urlProtocol === 'terminal-first'
```

When that check is false, the fork behaves like upstream VS Code. Upstream files that must change call into fork-owned seams (`EditorPartHooks`, `EditorGroupRouting`, `TerminalPolicy`, `viewContainerHosts`) or branch once on the gate. The additive core APIs that stay active in every product (`beginUndoRedoTransaction`, the `RequiresDedicatedGroup` capability, `allGroups`, `includeInactive`, the browser view `chromeless` flag) are inert unless fork code uses them. The complete, checked list of modified upstream files is generated in [`docs/upstream/PATCHES.md`](../upstream/PATCHES.md); the merge procedure is in [`docs/upstream/SYNC.md`](../upstream/SYNC.md).

## Cross-cutting release blockers

These items affect several features. Each one is also covered in the relevant spec.

1. **Global leader acceptance.** Ctrl+Space now enters the editor (`e`) and returns to shell (`q`/Escape), preserving dirty buffers; verify across Vim engines and keyboard layouts.
2. **Keybinding collisions with macOS conventions.** Resolved: the fork's overlays use `Cmd+Shift+A/J/E/T` and leader routes; `Cmd+A`, `Cmd+J`, `Cmd+E`, and `Cmd+T` keep their upstream meaning. See spec 7.
3. **`code` shadows the real VS Code CLI** inside VS NOSH shells (spec 2).
4. **Documentation drift.** User-facing workflow shortcuts have been reconciled with the new leader controls.
5. **Native Vim acceptance.** The engine reads the full document text on every key and has not been accepted for IME, large files, or shared models (spec 6).
6. **Distribution.** There is no packaged installer, signing, notarization, update channel, or CI pipeline for the fork. A packaged-app launcher is provided; signing, notarization, and distribution acceptance remain outstanding (spec 7).
7. **Upstream maintenance cost.** The fork edits about 60 upstream files, most of them one-line call-outs into fork seams. `scripts/upstream-check.sh` verifies the manifest and `scripts/upstream-sync.sh` runs a merge dry run; each merge follows [`docs/upstream/SYNC.md`](../upstream/SYNC.md).

## Documentation alignment

The workflow guide now documents title-bar tabs, `code`/`e`, Ctrl+Space navigation, copy mode, `Cmd+Shift+T` for the floating terminal, `Cmd+Shift+E` for the file browser, and deferred trust prompting. The former Cmd+Escape toggle and visible Hide/surface-toggle buttons remain removed.

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
	--run vs/workbench/contrib/terminalFirst/test/browser/tiles.test \
	--run vs/workbench/contrib/terminalFirst/test/browser/nativeVim.test \
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
