# VS NOSH Implementation Plan (IMP_PLAN.md)

> **For a cold agent:** this file is the implementation plan for the VS NOSH fork. Every workstream names its files, the seams it must use, how to verify, and what it must not touch. Start by reading "How to work in this repo", then pick the first `todo` row in the Status table, work it to done, update the row with the commit hash, and move on. Written 2026-10-30 against branch `terminal-first` at commit `8079947e2f6` plus its uncommitted working tree.

## Context

VS NOSH is a macOS fork of VS Code (`terminal-first` branch, upstream base `microsoft/vscode` `2c33b50b16c`, release 1.144.0). It opens as a shell and brings up a tiling editor workspace on demand. The fork's features are documented in `TERMINAL_FIRST.md` and specified in `docs/specs/01..10`. Three problems prompted this plan:

1. **Production readiness.** Every spec carries a "Known gaps" list, and several surfaces are keyboard-hostile. The clearest example: `Ctrl+L` into the Source Control or Explorer tile lands focus on a tree with no focused row, and `j`/`k` do nothing (Source Control) or need a click first. The floating file browser (Telescope-style, `floatingFileBrowser.ts`) is the keyboard model every tile should match.
2. **Upstream merge cost.** The fork edits about 75 upstream files. Two hotspots (`editorPart.ts` +170, `editorGroupView.ts` +104, `terminalService.ts` 10 scattered hunks) carry most of the conflict risk. Several changes are not gated by `terminalFirstEnabled`. There is no `upstream` git remote, no patch manifest, and no sync script, even though `TERMINAL_FIRST.md` claims an `upstream` remote exists.
3. **The New Tile picker** (`TileService.pick()` in `tiles.ts`) is an ad-hoc flat list: some rows are icon-only, only container rows have icons, nothing says what a row opens, and it has no tests.

Decisions already made by the owner (do not re-ask):

| Decision | Choice |
| --- | --- |
| Upstream maintainability depth | Refactor hotspots into seams, fix all ungated changes, add patch manifest and sync script |
| New Tile picker shape | One flat list, grouped: Workspace, Tools, Web, Extensions; every row has icon + name + description |
| Vim keys in lists | Every list/tree focused inside a view tile when native Vim is on; focus first row on tile entry |
| Keybinding collisions | Move all four (`Cmd+A`, `Cmd+J`, `Cmd+E`, `Cmd+T`) to leader sequences plus `Cmd+Shift` alternates; restore upstream Cmd shortcuts |
| Shells after Cmd+Q (2026-10-30) | Fresh shells; sessions and layouts restore, scrollback does not (`terminal.integrated.persistentSessionReviveProcess: never`) |
| Copilot in the packaged app (2026-10-30) | Dropped from the build |
| Login-shell env probe (2026-10-30) | Keeps running for the extension host, never gates the shell |
| Extension host at launch (2026-10-30) | Starts after the shell is presented, bounded at about 2 s after `Restored` |

## How to work in this repo

- Read `.claude/CLAUDE.md` first (tabs, nls, disposables, no `any`, JSDoc, one snapshot assertion per test where possible).
- Fork-only code lives in `src/vs/workbench/contrib/terminalFirst/`, `src/vs/editor/contrib/nativeVim/`, `src/vs/workbench/browser/parts/terminalFirst/`, `src/vs/workbench/services/terminalFirst/`, `extensions/terminal-first/`, `extensions/theme-vs-nosh/`. **Prefer adding code there.** Touch an upstream file only through the seams defined in Workstream A, and record every upstream edit in `docs/upstream/PATCHES.md` (created in A).
- The gate is `terminalFirstEnabled` from `src/vs/workbench/services/terminalFirst/common/terminalFirstPolicy.ts`. Nothing fork-specific may run when it is false.
- Build and test:
  ```sh
  npm run build-fast -- --client-only
  ./scripts/test.sh --run vs/workbench/contrib/terminalFirst/test/browser/<name>.test
  npm run eslint -- <changed files>
  npm run valid-layers-check   # only when moving files across layers
  ```
  Launch for manual checks: `npm run build-fast && ./scripts/terminal-first.sh /path/to/project`.
- Update `TERMINAL_FIRST.md` and the matching `docs/specs/NN-*.md` (add requirement IDs `SN.x`) in the same change as the code.
- Commit per workstream step; do not batch workstreams into one commit.

## Workstream order

Run in this order. A first, because B, C, and D must land on the new seams rather than on code that A moves.

| # | Workstream | Why this position |
| --- | --- | --- |
| A | Upstream seams, gating, patch manifest, sync tooling | Everything else should be written against the seams |
| B | Keyboard model for view tiles | Highest user-visible pain |
| C | New Tile picker redesign | Self-contained, small |
| D | Keybinding collisions + hardening backlog | Many small items, each independently shippable |
| E | Spaces | Self-contained, builds on `EditorPartSessions` |
| F | Startup and quit performance | Measurement-driven; every step is judged by `scripts/terminal-first-perf.sh` |

---

## Workstream A: upstream maintainability

### Goal

Shrink the fork's footprint in upstream files to one-line call-outs into fork-owned seams, gate or remove every unconditional change, and add a patch manifest plus sync tooling so each upstream merge is a predictable procedure.

### Verified facts that shape the design

- **Layering** (`eslint.config.js` `local/code-import-patterns`): `src/vs/platform/*/common` may import only `vs/base` and `vs/platform`. `vs/code`, `vs/workbench/api`, `vs/editor/contrib`, and `electron-main` files may all import `vs/platform`. `vs/workbench/browser/**` may import `vs/workbench/services/**` but **not** `vs/workbench/contrib/**`. `contrib/**` may import `vs/workbench/browser` and `services` but not `api`. `common` cannot import `browser`. Check with `npm run valid-layers-check`.
- **Upstream already exposes** enough for most fork behavior to become listeners: `IEditorGroupsService.onDidAddGroup/onDidRemoveGroup`, public `IEditorGroupView.element`, public `EditorPart.createState()/applyState()`, `ViewsRegistry.deregisterViews(views, container)`, `IViewDescriptor.when`, `IWorkbenchLayoutService.getContainer(window, Parts.TITLEBAR_PART)`, `ITerminalService.onDidCreateInstance`. Note: `onDidAddGroup` does **not** fire for groups restored from serialized state, so DOM decorators must iterate `part.groups` once at startup, then subscribe.
- The fork already ships `registerDefaultConfigurations` (`terminalFirst.contribution.ts:44-80`) with `workbench.activityBar.location: 'hidden'`, `workbench.layoutControl.enabled: false`, `scm.showActionButton: false`, `git.showCommitInput: false`, `chat.titleBar.openInAgentsWindow.enabled: false`. Several upstream hunks duplicate those defaults and can be deleted.
- Upstream test files `editorGroupsService.test.ts`, `editorService.test.ts`, `terminalService.test.ts`, `localTerminalBackend.test.ts` contain fork tests that depend on fork-only API. They must move to fork test files so the upstream files return to pristine.
- No `upstream` remote exists. `docs/specs/README.md` claims only two unconditional changes (false). Spec 7's "Upstream surface" list is stale (missing electron-main, browserView, viewsService, build/lib/extensions.ts, and more).

### A0. Baseline

1. Checkpoint the uncommitted working tree: `git add -A && git commit -m "Checkpoint tiled workspace WIP before seam refactor"` then `git tag fork/pre-seams`. Every later step is measured as `git diff 2c33b50b16c..HEAD -- <upstream file>` shrinking.
2. Create `build/fork/upstream-base` containing `2c33b50b16c`.
3. `git remote add upstream https://github.com/microsoft/vscode.git && git fetch upstream --tags`.

### A1. Gating consistency

**One policy definition, importable from every layer.** Create:

- `src/vs/platform/terminalFirst/common/terminalFirstProduct.ts` (imports only `vs/base`):
  ```ts
  export const TERMINAL_FIRST_URL_PROTOCOL = 'terminal-first';
  /** Title bar height the session strip needs; shared with electron-main sheet offsets. */
  export const TERMINAL_FIRST_TITLEBAR_HEIGHT = 36;
  export function isTerminalFirstProduct(urlProtocol: string | undefined, platform = { isMacintosh, isNative }): boolean {
  	return platform.isNative && platform.isMacintosh && urlProtocol === TERMINAL_FIRST_URL_PROTOCOL;
  }
  ```
- `src/vs/platform/terminalFirst/common/terminalFirst.ts`: `export const terminalFirstEnabled = isTerminalFirstProduct(product.urlProtocol);` plus re-exports.
- `src/vs/workbench/services/terminalFirst/common/terminalFirstPolicy.ts` keeps context keys, `terminalFirstPolicy`, `isTerminalFirstCommandAllowed`, but re-exports `terminalFirstEnabled` from the platform module instead of computing it.

Replace raw string checks:

| File | Replace with |
| --- | --- |
| `platform/windows/electron-main/windowImpl.ts` | `terminalFirstEnabled ? TERMINAL_FIRST_TITLEBAR_HEIGHT : …` |
| `platform/windows/electron-main/windowsMainService.ts` | `terminalFirstEnabled && …` |
| `code/electron-main/app.ts` | `terminalFirstEnabled` |
| `workbench/api/node/extHostExtensionService.ts` | `isTerminalFirstProduct(this._initData.environment.appUriScheme)` |
| `code/electron-browser/workbench/workbench.ts` | one `const terminalFirst = isTerminalFirstProduct(configuration.product.urlProtocol, { isMacintosh: safeProcess.platform === 'darwin', isNative: true })` from `terminalFirstProduct.js` (no `product` import, safe in bootstrap) |
| `workbench/electron-browser/parts/titlebar/titlebarPart.ts` | literal `36` → `TERMINAL_FIRST_TITLEBAR_HEIGHT` |

**Import placement rule:** in every upstream file that still imports `terminalFirst`, the import is the **last** line of the import block (today it is first in ~22 files; the check script in A6 enforces this).

**Decision per unconditional change:**

| Change | Decision | How |
| --- | --- | --- |
| `env.TERMINAL_FIRST_SESSION = nonce` (`terminalProcessManager.ts:554`, `localTerminalBackend.ts:349`) | Gate | `if (terminalFirstEnabled) { … }`. Cannot move: the nonce is minted inside the process manager. Move the env assertion from `localTerminalBackend.test.ts` to new `contrib/terminalFirst/test/browser/terminalSessionEnv.test.ts` |
| `statusBarExtensionPoint.ts` fires `updated` always | Gate the fire, keep the optional field | `if (terminalFirstEnabled) { fire }`; `terminalFirstVimStatus.ts` needs the field |
| `api/browser/terminalFirstVimStatus.ts` registered for all macOS | Gate registration | wrap in `if (terminalFirstEnabled)`; file stays in `api/browser` (needs `IExtensionStatusBarItemService`), listed as fork-owned |
| `nativeVimContribution.ts:194` unconditional `registerEditorContribution` | Gate | `if (terminalFirstEnabled)` via the platform module; keep runtime check as defense in depth |
| `workspaceEditingService.ts` `await startExtensionHosts()` | Gate | `const started = …; if (terminalFirstEnabled) { await started; }` |
| `defaultPinned` (`common/views.ts`, `paneCompositeBar.ts`, `debug.contribution.ts`) | Remove | activity bar is hidden by default so pin state is never visible; delete all three hunks |
| `editorGroupView.layout()` rewrite | Restore upstream body; fork via layout hook (A2) | current `titleHeight.total` substitution is behavior-equivalent to upstream |
| `editorPart.disposeGroups()` `clear()` → `activeSessionGroups?.clear()` | Rewrite upstream-equivalent | `this.groupViews.delete(group.id)` inside the loop; remove trailing `clear()` |
| `DEFAULT_COMMANDS_TO_SKIP_SHELL` prepend (`contrib/terminal/common/terminal.ts`) | Move to fork | add `terminal.integrated.commandsToSkipShell` to `registerDefaultConfigurations` built from the fork's `terminalFirst.tile.*` id list; zero upstream diff |
| `beginUndoRedoTransaction` (`model.ts`, `textModel.ts`) | Keep and document | needs `_commandManager`; additive, `@internal`, inert at depth 0; upstreaming candidate |
| `browser/editor.ts` `whenEditorClosed(acceptClose)` | Move to fork | copy as `whenEditorClosedInGroups` into `terminalFirstService.ts` (only caller); zero upstream diff |
| `allGroups?`, `getEditors({ includeInactive })`, `workingCopy*` one-liners | Keep | add a fast path in `editorService.getEditors`: skip the filter when `allGroups.length === groups.length`, else filter with a `Set` of visible ids computed once |
| `scmViewPane.ts` two `!terminalFirstEnabled &&` | Delete | redundant with `scm.showActionButton: false` and `git.showCommitInput: false` defaults |
| `titlebarPart.ts` `layoutControlEnabled` | Delete | redundant with `workbench.layoutControl.enabled: false` |
| `agentSessionsActions.ts` `notEquals('terminalFirstEnabled', true)` | Verify, likely delete | the action's `when` already honors `chat.titleBar.openInAgentsWindow.enabled` |
| `layout.ts` six early returns + `STATUSBAR_PART` case | Keep | a re-hide listener would flicker; the `STATUSBAR_PART` case is an upstream gap. Import last |
| `commandService.ts` policy check | Keep (2 lines) | only choke point covering extension-host and CLI commands |
| `paneCompositePart.ts`, `viewsService.ts` host redirects | Keep, shrink | in `viewsService.ts` add one private `hostedViewPaneContainer(container)` helper so the 7 call sites become one-liners |
| `workbench.ts` CSS class, `notificationsToasts.ts`, `partsSplash.ts`, `panelPart.ts`, `relauncher`, `remoteAgentHost`/`agentHostService`, `extHostCLIServer`, `windowsMainService` workspace rewrite, `ptyHostService.warmUp`, `terminalEditorInput` capability OR | Keep (1-3 lines each, gated) | document in the manifest |
| `browserView/*` (`chromeless`, overlay classes, `hidden` attribute filter) | Keep, document as additive generic | has upstream-style tests; upstreaming candidate |
| `build/lib/extensions.ts` copilot-sdk packaging | Keep, document as build fix | upstreaming candidate |

### A2. Seams for `editorPart.ts` / `editorGroupView.ts`

**Two seam files (two because of layering):**

`src/vs/workbench/services/editor/common/editorGroupRouting.ts` (common; used by `editorGroupFinder.ts`, `editorGroupView.ts`, `editorPart.ts`):
```ts
export interface IEditorGroupRoutingHook {
	/** Redirect an open aimed at `group`; return another group or throw to veto. */
	resolveGroup(group: IEditorGroup, editor: EditorInput | IUntypedEditorInput | undefined, groupsService: IEditorGroupsService): IEditorGroup;
	/** False when `editor` may not be placed into `group` by direct open, move or copy. */
	canPlace(group: IEditorGroup, editor: EditorInput): boolean;
	/** False when `copyGroup` must create an empty group instead of duplicating editors. */
	canCopyGroup(group: IEditorGroup): boolean;
}
export const EditorGroupRouting: { set(hook: IEditorGroupRoutingHook): IDisposable; get(): IEditorGroupRoutingHook | undefined };  // single owner; throws if set twice
```

`src/vs/workbench/browser/parts/editor/editorPartHooks.ts` (browser):
```ts
export interface IGroupRect { width: number; height: number; top: number; left: number }
export interface IEditorGroupLayoutHook {
	adjustLayout?(rect: IGroupRect): IGroupRect & { titleWidth?: number };   // tile gutters, reserved title width
	minimumSize?(size: { width: number; height: number }): { width: number; height: number };
	titleHeight?(height: IEditorGroupTitleHeight): IEditorGroupTitleHeight;
	readonly expandMinimizedGroupOnActivate?: boolean;                        // default true (upstream)
}
export interface IEditorPartExtensionContext {
	readonly part: IEditorPart;
	readonly groupViews: ReadonlyMap<GroupIdentifier, IEditorGroupView>;
	readonly memento: Record<string, unknown>;
	mostRecentActiveGroups: GroupIdentifier[];
	createState(): IEditorPartUIState;
	restoreGrid(grid: ISerializedGrid, activeGroup: GroupIdentifier, reuse?: IEditorGroupView[]): void;
	createSingleGroupGrid(): IEditorGroupView;
	setGroupActive(group: IEditorGroupView): void;
	swapViews(a: IEditorGroupView, b: IEditorGroupView): void;
	relayout(): void;
	fireDidAddGroup(g: IEditorGroupView): void; fireDidRemoveGroup(g: IEditorGroupView): void; fireDidMoveGroup(g: IEditorGroupView): void;
}
export interface IEditorPartExtension extends IDisposable {
	isGroupVisible?(group: IEditorGroupView): boolean;
	onDidCreateGroupView?(group: IEditorGroupView): void;
	onDidRestore?(willRestoreState: boolean): Promise<void> | void;
	saveState?(): void;
}
export const EditorPartHooks: { layout: IEditorGroupLayoutHook | undefined; setLayoutHook(h): IDisposable; registerExtension(f: (ctx: IEditorPartExtensionContext) => IEditorPartExtension): IDisposable; createExtensions(ctx): IEditorPartExtension[] };
```
Use `import type { IEditorPartUIState } from './editorPart.js'` to avoid a runtime cycle.

**Fork implementations** (new files in `src/vs/workbench/contrib/terminalFirst/`):
- `browser/editorPartSessions.ts`: `class EditorPartSessions implements IEditorPartExtension` holding verbatim the current `activateSession`, `resolveSessionGroupIds`, `closeSession`, session `saveState`, `whenRestored` session replay, retained-group disposal, and `swapGroups`. Static `EditorPartSessions.for(part: IEditorPart)`. Memento key stays `'editorpart.sessions'` (persisted state unchanged). Registered via `EditorPartHooks.registerExtension` at module load when `terminalFirstEnabled`.
- `browser/tileChrome.ts`: per group (`part.groups` at init, then `onDidAddGroup`; the sessions extension fires `fireDidAddGroup` for restored session groups): add class `terminal-first-tile`, the Close Tile / New Tile buttons, the hover-focus scheduler (DI: `IContextMenuService`, `IContextKeyService`, `IConfigurationService`, `ICommandService`, `IHoverService`), and the `--terminal-first-close-center` variable. Dispose per group on `onDidRemoveGroup`. _Workstream C step 4 lands its button change here._
- `common/tileLayout.ts`: move `services/editor/common/editorTileLayout.ts` here; delete the original.
- `browser/tileLayoutHook.ts`: `IEditorGroupLayoutHook` with inset 5, min 230×190, `titleWidth = width - 32`, `titleHeight.total = max(32, h)`, `expandMinimizedGroupOnActivate: false`.
- `browser/tileRouting.ts`: move `isGroupDedicatedForEditor` here; implement `IEditorGroupRoutingHook` (`resolveGroup` = current `handleGroupResult` block using `tileSplitDirection`/`noRoomForTileMessage`; `canPlace` = `!isGroupDedicatedForEditor`; `canCopyGroup` = no `RequiresDedicatedGroup` editors).
- Update callers: `terminalFirstService.ts` (`mainPart.sessions?.x` → `EditorPartSessions.for(mainPart)?.x`), `tiles.ts:336` (`part.swapGroups` → `EditorPartSessions.for(part)!.swapGroups`).
- Tests: move the "terminal sessions …" tests from `services/editor/test/browser/editorGroupsService.test.ts` to new `contrib/terminalFirst/test/browser/editorPartSessions.test.ts`, and the "dedicated tool groups …" tests from `editorService.test.ts` to new `tileRouting.test.ts`. Both import the fork modules so hooks register, and use `createEditorParts`/`workbenchInstantiationService`. Revert both upstream test files and the `TestEditorGroupsService.swapGroups` line in `workbenchTestServices.ts`.

**Target residual hunks in upstream files:**

`editorPart.ts` (from +170/-10 to about +45/-6, no session semantics):
1. imports `EditorPartHooks`, `EditorGroupRouting` (last); drop `terminalFirstEnabled`, `EditorInputCapabilities`.
2. `get groups()` → `.filter(g => this.isGroupVisible(g))`; `get count()` → `this.groups.length`; MRU getter filtered the same way.
3. `get allGroups()` (1 line, keep).
4. `doCreateGroupView`: after `groupViews.set`, `for (const e of this.extensions) { e.onDidCreateGroupView?.(groupView); }`.
5. `doSetGroupActive`: honor `EditorPartHooks.layout?.expandMinimizedGroupOnActivate !== false`.
6. `copyGroup`: `EditorGroupRouting.get()?.canCopyGroup(groupView) === false ? undefined : groupView`.
7. `gridSeparatorBorder`: delete the hunk; set `editorGroup.border` transparent in `extensions/theme-vs-nosh` and in the fork's default `workbench.colorCustomizations`.
8. `whenRestored`: `.then(() => Promise.all(this.extensions.map(e => e.onDidRestore?.(this._willRestoreState))))` before `.finally`.
9. `saveState()`: `for (const e of this.extensions) { e.saveState?.(); }`; drop the `&& !this.activeSession` change (confirm with moved sessions tests).
10. `disposeGroups()`: `this.groupViews.delete(group.id)` in loop; remove `clear()`.
11. `dispose()`: `dispose(this.extensions)` before `disposeGroups()`.
12. New `//#region Editor Part Extensions` at the end of the class: `extensions`, `isGroupVisible`, `createExtensionContext()` (~25 lines of closures over private methods). Remove `IEditorPartMemento['editorpart.sessions']`.
13. Delete `swapGroups` and the `IEditorPart.swapGroups`/`sessions?` interface members (`editorGroupsService.ts` keeps only `allGroups?`).

`editorGroupView.ts` (from +104/-17 to about +20/-6):
1. imports `EditorPartHooks`, `EditorGroupRouting` only; drop `terminalFirst*`, `editorTileLayout`, `isGroupDedicatedForEditor`, `Codicon`, `ThemeIcon`, `IHoverService`, `onUnexpectedError`, `RunOnceScheduler`, `IConfigurationService`.
2. Constructor: remove the two injections, `'terminal-first-tile'` class, `HOVER_FOCUS_DELAY`.
3. `registerContainerListeners`: remove the 55-line block.
4. Keep `setVisible` rename, `confirmCloseAllEditors()`, `canDispose`/shared-editor check using `allGroups ?? groups`.
5. `titleHeight`: `EditorPartHooks.layout?.titleHeight?.(height) ?? height`.
6. `doOpenEditor` / `doMoveOrCopyEditorAcrossGroups`: one `canPlace(...) === false` check each.
7. `minimumWidth/Height`: via `EditorPartHooks.layout?.minimumSize?.(...)`.
8. `layout()`: restore upstream body verbatim, then insert after `this.lastLayout = …`: `const adjusted = EditorPartHooks.layout?.adjustLayout?.({ width, height, top, left }); if (adjusted) { ({ width, height, top, left } = adjusted); }` and feed `adjusted?.titleWidth ?? width` into the existing `titleControl.layout` call; `editorHeight` returns to `titleControlSize.height`.

`editorGroupFinder.ts`: replace the 10-line dedicated block with `group = EditorGroupRouting.get()?.resolveGroup(group, editorInput, editorGroupService) ?? group;`.

`common/editor.ts`: `RequiresDedicatedGroup = 1 << 30` with comment `// Fork: high bit avoids collisions with upstream capability additions`. Capabilities are never persisted; no migration.

`parts/editor/editor.ts`: keep `allGroups?`, `setVisible`, `confirmCloseAllEditors` grouped in one short `// Fork:` block. `editorParts.ts`: keep `allGroups` (1 line).

**Cannot be externalized (and why):** `groups`/`count`/MRU filtering (upstream has no hidden-group concept; 3 one-line hunks); grid restore/swap/active internals are private (exposed once via the context object); `setVisible` made public (1 line); per-group layout/minimum/title height (the `Grid` positions by numbers passed to `layout()`, CSS cannot shrink the pane).

### A3. Terminal creation policy seam

New `src/vs/workbench/contrib/terminal/browser/terminalPolicy.ts` (browser layer; `ITerminalInstance`/`ICreateTerminalOptions` are browser types):
```ts
export interface ITerminalPolicy {
	beforeCreate(options: ICreateTerminalOptions | undefined): void;                            // throw to block
	prepareReconnect(options: ICreateTerminalOptions, kind: 'background' | 'group'): void;      // mark internal re-creation as allowed
	prepareLaunchConfig(config: IShellLaunchConfig, options: ICreateTerminalOptions | undefined): void;
	skipContributedProfile(options: ICreateTerminalOptions | undefined): boolean;
	authorizeInstance(config: IShellLaunchConfig | ITerminalProfile): void;                      // throw to block
	readonly restoreGroupLayout: boolean;
	readonly autoCreateInView: boolean;
	isDetached(instance: ITerminalInstance): boolean;                                           // replaces shellLaunchConfig.terminalFirstFloating
	opensEditorFor(options: ICreateTerminalOptions | undefined): boolean;                      // replaces !options.terminalFirstTile
	assertCanOpenEditor(instance: ITerminalInstance): void;
	assertCanAddToGroup(group: ITerminalGroup): void;
	assertCanMoveInGroup(group: ITerminalGroup): void;
	actionPrecondition(id: string, precondition: ContextKeyExpression | undefined): ContextKeyExpression | undefined;
	canRunAction(id: string): boolean;
}
export const TerminalPolicy: { set(p: ITerminalPolicy): IDisposable; get(): ITerminalPolicy | undefined };
```

Fork implementation `src/vs/workbench/contrib/terminalFirst/browser/terminalPolicy.ts`, registered when `terminalFirstEnabled`. It owns a `WeakSet<ICreateTerminalOptions>` per intent (fork callers do `TerminalFirstLaunch.session(options)` / `.floating(options)` / `.tile(options)` before `createTerminal(options)`), a `WeakSet<IShellLaunchConfig>` for detached configs, `authorizeTerminalFirstLaunch/consumeTerminalFirstLaunch`, the `isTerminalFirstInteraction` preconditions, and all localized block messages. Delete the three `terminalFirst*` fields from `contrib/terminal/browser/terminal.ts` and `terminalFirstFloating` from `platform/terminal/common/terminal.ts` (zero diff in both). Update `terminalFirstService.ts:210` to `isDetached(instance)`.

Residual upstream hunks, each a one-line call-out: `terminalService.ts` (`setActiveInstance`, `_reconnectToPersistentProcesses`, `_recreateTerminalGroups`, `revealTerminal`, instance `onDidFocus`, `createTerminal` × 3, `_createTerminal` editor branch, `showBackgroundTerminal`); `terminalInstanceService.ts` (`authorizeInstance`); `terminalGroup.ts` (`assertCanAddToGroup` / `assertCanMoveInGroup`); `terminalEditorService.ts` (`assertCanOpenEditor`, `reviveInput` marks via `prepareLaunchConfig`); `terminalView.ts` (`autoCreateInView`); `terminalActions.ts` (`actionPrecondition`, `canRunAction`); `terminalEditorInput.ts` unchanged.

Tests: revert `contrib/terminal/test/browser/terminalService.test.ts`; move the "floating terminals remain backgrounded" test into new `contrib/terminalFirst/test/browser/terminalPolicy.test.ts`.

### A4. Contribution files (scm/outline/timeline/debug/chat)

Zero upstream diff via deregistration from fork code. New `src/vs/workbench/contrib/terminalFirst/browser/viewPruning.ts`, imported by `terminalFirst.contribution.ts` (which `workbench.desktop.main.ts` imports after `workbench.common.main.ts`, so those registrations have already run):
```ts
if (terminalFirstEnabled) {
	const views = Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry);
	const containers = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry);
	for (const [viewId, containerId] of [[HISTORY_VIEW_PANE_ID, SCM_VIEWLET_ID], [OUTLINE_VIEW_ID, EXPLORER_VIEW_CONTAINER_ID], [TIMELINE_VIEW_ID, EXPLORER_VIEW_CONTAINER_ID]]) {
		const container = containers.get(containerId);
		const view = container && views.getViews(container).find(v => v.id === viewId);
		if (view) { views.deregisterViews([view], container); }
	}
}
```
Then revert `scm.contribution.ts`, `outline.contribution.ts`, `timeline.contribution.ts`, `debug.contribution.ts`, `scmViewPane.ts` to upstream. Fallback if ordering ever bites: `when: ContextKeyExpr.not('terminalFirstEnabled')` on the descriptor (1 line, no import, no re-indent). `chatSetupContributions.ts`: keep, non-indenting two-line `if`; import last. `relauncher.contribution.ts`: keep; import last.

### A5. Title bar

- New `src/vs/workbench/contrib/terminalFirst/browser/sessionStripContribution.ts` (workbench contribution, `WorkbenchPhase.BlockRestore`): `layoutService.getContainer(mainWindow, Parts.TITLEBAR_PART)`, find `.titlebar-container > .titlebar-left`, append `$('.titlebar-sessions.terminal-first-sessions')` and instantiate `SessionTabsWidget` into it; add `terminal-first-titlebar` / `terminal-first-title` classes. Move `parts/terminalFirst/sessionStripPart.ts`, `sessionStrip.css`, `terminalFirstIcons.ts` into `contrib/terminalFirst/browser/`. Assert the selector in `sessionTabs.test.ts` so an upstream rename fails loudly.
- `browser/parts/titlebar/titlebarPart.ts`: revert fully.
- `electron-browser/parts/titlebar/titlebarPart.ts`: keep only `minimumHeight`, rewritten as `if (terminalFirstEnabled && this.id === Parts.TITLEBAR_PART) { return TERMINAL_FIRST_TITLEBAR_HEIGHT / zoom; }` (no `isAuxiliary` widening). Import last.

### A6. Patch manifest and sync tooling

**Manifest** `build/fork/upstream-patches.json` (single source of truth):
```json
{ "base": "2c33b50b16c",
  "forkPaths": ["src/vs/workbench/contrib/terminalFirst/", "src/vs/editor/contrib/nativeVim/", "src/vs/workbench/services/terminalFirst/", "src/vs/platform/terminalFirst/", "extensions/terminal-first/", "extensions/theme-vs-nosh/", "docs/", "build/fork/", "scripts/upstream-*.sh", "scripts/terminal-first*.sh", "TERMINAL_FIRST.md", "IMP_PLAN.md"],
  "patches": [
    { "path": "src/vs/workbench/browser/parts/editor/editorPart.ts", "seam": "EditorPartHooks", "kind": "hook-callout", "gated": true, "why": "Retained session groups need hidden-group filtering and grid internals", "validate": ["contrib/terminalFirst/test/browser/editorPartSessions.test"] }
  ],
  "forkOwnedInUpstreamDirs": ["src/vs/workbench/browser/parts/editor/editorPartHooks.ts", "src/vs/workbench/services/editor/common/editorGroupRouting.ts", "src/vs/workbench/contrib/terminal/browser/terminalPolicy.ts", "src/vs/workbench/services/views/browser/viewContainerHost.ts", "src/vs/workbench/api/browser/terminalFirstVimStatus.ts", "src/vs/workbench/api/browser/media/terminalFirst.css", "resources/darwin/vs-nosh.icns", "resources/darwin/vs-nosh.png"] }
```
`kind` ∈ `hook-callout | gate | additive-api | branding | build | generic-fix`. `docs/upstream/PATCHES.md` is **generated** by the check script; `docs/specs/07` "Upstream surface" and `docs/specs/README.md` "Global gating" link to it instead of duplicating lists.

**`build/fork/upstream-check.ts`** (run as `node build/fork/upstream-check.ts`, with `scripts/upstream-check.sh` as a thin wrapper; read-only, CI-safe):
1. `touched = git diff --name-only $BASE..HEAD` excluding `forkPaths`.
2. Fail on any touched file not in `patches[].path` or `forkOwnedInUpstreamDirs` ("undocumented upstream edit"); warn on manifest entries that no longer differ ("stale entry").
3. Fail if `grep -rn "'terminal-first'" src/vs --include='*.ts'` hits outside `platform/terminalFirst/common/terminalFirstProduct.ts`.
4. For each patch path that imports `terminalFirst`, assert the import is the last `^import` line.
5. `--markdown` prints the table; default mode diffs it against `docs/upstream/PATCHES.md` and fails if stale.
6. `--diffstat` prints `git diff --stat $BASE..HEAD -- <patch paths>`.

**`scripts/upstream-sync.sh [ref=upstream/main] [--merge]`:**
1. Add the `upstream` remote if missing; `git fetch upstream --tags`.
2. Dry run: `git merge-tree --write-tree --name-only HEAD <ref>` (git ≥ 2.38); intersect conflicts with manifest paths; print "conflicts in documented patches (expected; see seam notes)" and "conflicts elsewhere (investigate)".
3. `--merge`: `git config rerere.enabled true`; `git merge --no-ff --no-commit <ref>`; after the merge commit, write `git merge-base HEAD <ref>` to `build/fork/upstream-base`; print the validation list.
4. Never rewrites history.

**`docs/upstream/SYNC.md`:** recommend **merge, not rebase** (long-lived published branch, conflicts resolved once and recorded by `rerere`, bisectable history, `upstream-base` always equals the last merge-base). Procedure: dry run → read conflict list → `--merge` → resolve using the manifest's seam notes (expected resolution for a `hook-callout` is "re-add the one-line call-out") → `npm run compile` → `npm run valid-layers-check` → `npm run eslint` → `scripts/upstream-check.sh` → validation tests (spec README list plus `editorPartSessions.test`, `tileRouting.test`, `terminalPolicy.test`, `terminalSessionEnv.test`, `sessionTabs.test`) → `./scripts/terminal-first.sh` smoke (shell boots, sessions switch, tiles open, floating terminal, `e`) → commit.

**Optional** `.github/workflows/upstream-drift.yml`: on `pull_request` run `scripts/upstream-check.sh`; weekly cron runs the dry run and updates a pinned issue with conflicting manifest files.

### A7. Ordering and validation

| Step | Work | Validate |
| --- | --- | --- |
| A0 | Checkpoint commit + tag, `upstream-base`, add remote | `git status` clean |
| A1 | Platform policy module; replace raw strings; apply every row of the decision table | `npm run valid-layers-check`; `terminalFirstPolicy.test`, `nativeVim*.test`, pristine `localTerminalBackend.test`, new `terminalSessionEnv.test`; smoke: VSCodeVim status visible with `extension` engine |
| A4 | `viewPruning.ts`; revert scm/outline/timeline/debug/scmViewPane; import-order sweep | compile; smoke: no Outline/Timeline/Graph views; `tiles.test` |
| A3 | `terminalPolicy.ts` seam + fork policy; remove `terminalFirst*` fields; move terminal test | pristine `terminalService.test`, new `terminalPolicy.test`, `terminalFirstService.test`, `floatingTerminal.test`, `terminalCopyMode.test`; smoke: session shell, floating terminal, terminal tile, reload reconnect |
| A2 part 1 | `editorGroupRouting.ts` + `editorPartHooks.ts` (layout only); `tileRouting.ts`, `tileLayoutHook.ts`, `tileChrome.ts`; revert `editorGroupView.ts` layout/chrome; `RequiresDedicatedGroup = 1 << 30`; move dedicated-group tests | pristine `editorService.test`, new `tileRouting.test`, `tiles.test`; smoke: close/new tile buttons, focus-follows-mouse, inset |
| A2 part 2 | `EditorPartSessions` extension; `swapGroups` moved; interface cleanup; move sessions tests | pristine `editorGroupsService.test`, new `editorPartSessions.test`, `terminalFirstService.test`; smoke: switch sessions with dirty editors, reload restores both sessions |
| A5 | Titlebar injection; revert browser `titlebarPart.ts`; move session strip files | `sessionTabs.test`; smoke: tabs left of title, traffic lights unaffected |
| A6 | Manifest, scripts, workflow, docs (`PATCHES.md`, `SYNC.md`, fix `docs/specs/README.md`, spec 7, `TERMINAL_FIRST.md`) | `scripts/upstream-check.sh` passes; dry-run sync prints a sane conflict list |

Each step compiles independently and can be its own PR. Run `npm run valid-layers-check` in A1, A3, A2 (new files in `platform/`, `services/editor/common`, `browser/parts/editor`, `contrib/terminal/browser`).

**Risks:**
- Persisted state: `editorpart.sessions` and `terminalFirst.sessions` keys unchanged. `RequiresDedicatedGroup` is runtime-only. Dropping `IShellLaunchConfig.terminalFirstFloating` means a previously serialized flag in pty-host revive state is ignored; the policy marks all `hideFromUser` revived processes detached, which matches today's behavior.
- Hook registration must precede `EditorPart`/`TerminalService` construction: register at module top level inside `if (terminalFirstEnabled)` in `terminalFirst.contribution.ts`. Tests must import the fork modules explicitly.
- `viewPruning` depends on `workbench.common.main.ts` importing before the fork contribution; keep the `when`-clause fallback documented.
- `.titlebar-left` selector coupling is guarded by `sessionTabs.test`.

---

## Workstream B: keyboard model for view tiles

### Goal

Moving focus into any view tile (Ctrl+H/J/K/L, Ctrl+Option+G, leader `w g`, mouse hover) lands on the view's list with a visible cursor. With native Vim on, every list or tree inside a view tile accepts `j`/`k`/`h`/`l`, `gg`/`G`, `Ctrl+D`/`Ctrl+U`, `/`, `o`, `.` (row actions), `m` (context menu), `F6` (toolbars), `?` (help), and Space (leader). Nothing fires when Vim is off. **No upstream files need editing** for this workstream.

### Verified root causes

- `ViewTileEditor.focus()` (`tileEditor.ts:303`) is `super.focus(); this.composite?.focus();`. If `updateVisibility()` has not acquired the composite yet, nothing is focused. The chain then reaches the view's own `focus()`: `ExplorerView.focus` (`contrib/files/browser/views/explorerView.ts:411`) does `tree.domFocus()` but never sets a focused row; `SCMViewPane.focus` (`contrib/scm/browser/scmViewPane.ts:2155`) is async through `treeOperationSequencer`, tries the commit input (removed by the fork), falls back to `tree.domFocus()`, and never resolves when the pane is collapsed.
- A list with DOM focus and no focused row shows nothing; Down arrow would go to row 0 (`listWidget.ts:1816`), but `j` is not bound for anything except the Explorer (`terminalFirstNavigation.ts:38-48`, gated on `FilesExplorerFocusedContext`). In SCM, `j` reaches type-to-navigate.
- Type-ahead swallows keys for ~800 ms after a typed character (`listWidget.ts:505` `typing ||` short-circuit) even when a keybinding matches. Setting the scoped context key `listTypeNavigationMode = 'trigger'` makes type-ahead start only via `list.triggerTypeNavigation`.
- Every list created inside a view gets its scoped `IContextKeyService` from the view → tile DOM chain (`listService.ts:137-141`), so a context key set on the tile composite's scoped service is inherited by all its lists with no focus tracking.

### Design decisions

| Decision | Choice |
| --- | --- |
| "Focused list is inside a view tile" | Scoped context key `terminalFirstViewTile = true` set in `ViewTileComposites.acquire` (`tileEditor.ts` ~L100) on the composite's scoped context key service |
| "Native Vim is on" | New global context key `terminalFirstVimEnabled`, set by `NativeVimService` in `nativeVim.ts` where `ready` flips (~L92), reset on dispose |
| Key mechanism | `KeybindingsRegistry` rules (as `terminalFirstNavigation.ts` and `floatingFileBrowser.ts` do), not a keydown interceptor. Remappable, testable with `KeybindingResolver` |
| Command IDs | `terminalFirst.tileList.*` delegating to upstream `list.*` commands; a `?` help picker resolves labels with `IKeybindingService.lookupKeybindings` (same pattern as `floatingFileBrowser.ts:274`) |
| Type-ahead | Scoped `listTypeNavigationMode = 'trigger'` while Vim is on; `/` triggers find or type navigation |
| Row/title actions | `.` opens an actions quick pick built from `IMenuService`; `m` opens the native context menu; `F6`/`Shift+F6` cycle list → pane header toolbar → tile toolbar |
| Destructive single keys (`s`/`u`/`d`, `r`, `a`, `D`) | Behind `terminalFirst.vim.listActionKeys` (default `false`); discard/delete keep their confirmations. The `.` picker exposes all of them regardless |
| Space in a tile list | Opens the leader (`ITerminalFirstLeaderService.start()`); upstream's Space toggle-expand is covered by `za`/`o` |

### Steps

1. **Context keys.** In `src/vs/workbench/services/terminalFirst/common/terminalFirstPolicy.ts` export `TerminalFirstViewTileContext = new RawContextKey<boolean>('terminalFirstViewTile', false)` and `TerminalFirstVimEnabledContext = new RawContextKey<boolean>('terminalFirstVimEnabled', false)`. In `nativeVim.ts` bind the Vim key to the injected context key service and set it where `ready` is assigned.
2. **Tile scope keys** in `ViewTileComposites.acquire` (`tileEditor.ts` ~L100), after `createScoped(element)`:
   ```ts
   TerminalFirstViewTileContext.bindTo(scopedContextKeys).set(true);
   const typeNavigation = new RawContextKey<string>('listTypeNavigationMode', '').bindTo(scopedContextKeys);
   const syncVim = () => this.vim.enabled ? typeNavigation.set('trigger') : typeNavigation.reset();
   store.add(this.vim.onDidChange(syncVim)); syncVim();
   ```
   Inject `@INativeVimService` into `ViewTileComposites`. Trees re-read the mode live (`listService.ts:1256-1258, 1344-1348`).
3. **Deterministic entry focus.** Replace `ViewTileEditor.focus()`:
   - If `this.composite` is undefined, set `focusWhenReady = true` and return; at the end of `updateVisibility()` (after `layout`) call `focus()` when the flag is set and the group is still active. Clear the flag in `detach()`.
   - Expand the first visible pane when all panes are collapsed (`composite.getViewPaneContainer()?.panes`, `pane.isExpanded()`, `pane.setExpanded(true)`) to avoid SCM's never-resolving sequencer.
   - Call `composite.focus()`, then `focusFirstRowIfNone(listService.lastFocusedList, this.element)`. If no list inside the tile is focused yet (SCM's async path), add a `focusin` listener on the tile element that retries the helper, disposed after success or a 1 s timeout (`MutableDisposable` + `disposableTimeout`).
   - Helper, exported from a new `src/vs/workbench/contrib/terminalFirst/browser/tileListNavigation.ts`:
     ```ts
     /** Gives a visible cursor to a list that has DOM focus but no focused row. Returns false when no list inside `within` is focused. */
     export function focusFirstRowIfNone(list: WorkbenchListWidget | undefined, within: HTMLElement): boolean {
     	if (!list || !isAncestor(list.getHTMLElement(), within) || !isAncestorOfActiveElement(list.getHTMLElement())) { return false; }
     	if (list.getFocus().length === 0 && list.getHTMLElement().querySelector('.monaco-list-row')) {
     		list.focusFirst(getSelectionKeyboardEvent('keydown', true)); // preserveFocus: no open side effect
     		const focus = list.getFocus(); if (focus.length) { list.reveal(focus[0]); }
     	}
     	return true;
     }
     ```
     Views without a list (webviews, welcome content) return `false` and keep today's behavior.
   - CSS in `tiles.css`, tokens only: keep the focused row visible when the list loses `:focus` (upstream defaults `list.inactiveFocusOutline` to null):
     ```css
     .monaco-workbench .terminal-first-tool-tile .monaco-list:not(:focus) .monaco-list-row.focused {
     	outline: var(--vscode-strokeThickness) dotted var(--vscode-list-inactiveFocusOutline, var(--vscode-focusBorder));
     	outline-offset: -1px;
     }
     ```
4. **Key table** in `tileListNavigation.ts`. Delete the Explorer-only rule from `terminalFirstNavigation.ts:38-48`. When clause and weight:
   ```ts
   export const tileListFocus = ContextKeyExpr.and(dockedNavigation, TerminalFirstViewTileContext, TerminalFirstVimEnabledContext, WorkbenchListFocusContextKey, ContextKeyExpr.not('treeFindOpen'));
   // weight: KeybindingWeight.ExternalExtension + 1000
   ```
   Use an `add(id, label, keys, handler)` helper (mirror `floatingFileBrowser.ts:398-407`) that pushes into `tileListActions[]` for `?` and registers `terminalFirst.tileList.<id>` via `registerCommandAndKeybindingRule`. Handlers resolve the widget with `accessor.get(IListService).lastFocusedList` as `listCommands.ts` does.

   | Key | Id | Does |
   | --- | --- | --- |
   | `j` / `k` | `down` / `up` | `list.focusDown` / `list.focusUp` |
   | `h` | `collapse` | `list.collapse` (focuses parent on a leaf) |
   | `l` | `expand` | collapsed tree node → `list.expand`; otherwise `list.selectAndPreserveFocus` (open, keep cursor) |
   | `o` | `open` | `list.selectAndPreserveFocus` |
   | `Enter` | (upstream) | unchanged: `list.select` / `explorer.openAndPassFocus` |
   | `g g` | `first` | `KeyChord(KeyG, KeyG)` → `list.focusFirst` (chords work: type-ahead filter returns false on `MoreChordsNeeded`, `listService.ts:839-845`) |
   | `Shift+G` | `last` | `list.focusLast` |
   | `Ctrl+D` / `Ctrl+U` (`WinCtrl` on mac) | `pageDown` / `pageUp` | `list.focusPageDown` / `list.focusPageUp` |
   | `z a` / `z o` / `z c` | `toggleFold` / `unfold` / `fold` | `list.toggleExpand` / `list.expand` / `list.collapse` |
   | `/` | `find` | tree with `listSupportsFind` → `list.find`; plain list → `list.triggerTypeNavigation` |
   | `Space` | `leader` | `ITerminalFirstLeaderService.start()` |
   | `.` | `actions` | actions picker (step 5) |
   | `m` | `contextMenu` | native context menu on the focused row (step 5) |
   | `F6` / `Shift+F6` | `focusNext` / `focusPrevious` | list → pane header toolbar → tile toolbar → list |
   | `?` | `help` | quick pick of `tileListActions` with resolved keybinding labels; selecting runs it |
   | `Esc` | `escape` | multi-selection → collapse to the focused row; otherwise no-op (prevents upstream `list.clear` from removing the cursor) |

   Inputs inside views (search box, rename box) keep normal typing because `WorkbenchListFocusContextKey` excludes `inputFocus`.
5. **Reaching buttons** in a new `src/vs/workbench/contrib/terminalFirst/browser/tileListActions.ts`:
   - Where the buttons are: Stage All / Refresh / Collapse All / New File are **view-pane header** toolbars (`viewPane.ts:456-481`, `MenuId.ViewTitle`, `SCMTitle`) inside `.tile-tool-body`; `.tile-tool-actions` (`tileEditor.ts:273-285`) holds only container-level actions; SCM per-row stage/discard are `WorkbenchToolBar`s in the row (`scmViewPane.ts:520-529`).
   - `F6` cycle: find the pane containing the active element (`panes.find(p => isAncestorOfActiveElement(p.element))`), focus its header toolbar's first `.action-item .action-label` (ActionBar's focus tracker then handles arrows/Enter, `actionbar.ts:156-221`); next stop is the tile toolbar via a new `ViewTileEditor.focusTitleActions()` (`this.toolbar.focus()`). Escape inside either toolbar returns to the list: add a keydown listener on the tile element in `ViewTileEditor.createEditor`. Verify `.pane-header:focus-within > .actions` is visible; if not, add a tile-scoped rule in `tiles.css`. `Tab` stays upstream (moves into the focused row's inline toolbar, `listWidget.ts:627-649`).
   - `.` actions picker: groups = focused row actions, focused pane title actions (`pane.menuActions.getPrimaryActions()/getSecondaryActions()`, context `pane.getActionsContext()`), tile container actions (`composite.getActions()/getSecondaryActions()`). Row providers, all fork-side:
     - SCM (`isSCMResource/isSCMResourceGroup/isSCMRepository/isSCMResourceNode` from `contrib/scm/browser/util.ts`): `scmViewService.menus.getRepositoryMenus(provider)` → `getResourceMenu` / `getResourceGroupMenu` / `getResourceFolderMenu` / `getRepositoryContextMenu`; use `getFlatContextMenuActions(menu.getActions({ arg: element, shouldForwardArgs: true }))` **including** the `inline` group so Stage/Discard are listed; context = element (`provider` for repositories).
     - Explorer (`element instanceof ExplorerItem`): `menuService.createMenu(MenuId.ExplorerContext, list.contextKeyService).getActions({ arg: stat.resource, shouldForwardArgs: true })`.
     - Fallback (extension tree views, Search, Problems): one item "Show Context Menu…" that runs the `m` path.
     - After running, `list.domFocus()`. Placeholder "Actions for {0}" uses `list.options.accessibilityProvider?.getAriaLabel(element)`.
   - `m`: dispatch synthetic `keydown`+`keyup` for Shift+F10 on `list.getHTMLElement()` (`listWidget.ts:1460-1476` turns it into `onContextMenu` anchored at the focused row, so each view builds its own menu). Wrap in one commented helper.
6. **SCM and Explorer specifics.** `l`/`o` → `list.selectAndPreserveFocus` → `SCMViewPane.open` honours `preserveFocus`, so the diff opens in the editor tile and the cursor stays. Opt-in keys (`terminalFirst.vim.listActionKeys`), registered with `when: tileListFocus && config.terminalFirst.vim.listActionKeys && view == '<id>'`: SCM `s` stage, `u` unstage, `d` discard (looked up by action id in the row provider so other SCM providers degrade silently); Explorer `r` rename, `a` new file, `A` new folder, `d` trash, `D` delete, `y`/`x`/`p` copy/cut/paste. Register the setting in `nativeVim.ts` next to `terminalFirst.vim.leaderBindings`.
7. **Import** `tileListNavigation.ts` from `terminalFirst.contribution.ts`.

### Tests

- Extend `src/vs/workbench/contrib/terminalFirst/test/browser/terminalFirstNavigation.test.ts` (KeybindingResolver over `KeybindingsRegistry.getDefaultKeybindings()`; widen the id filter to `terminalFirst\.tileList\.`): each key resolves with `{ terminalFirstViewTile: true, terminalFirstVimEnabled: true, listFocus: true }`; `gg` resolves across two `resolve` calls; each of `terminalFirstVimEnabled:false`, `terminalFirstViewTile:false`, `inputFocus:true`, `treeFindOpen:true`, `listFocus:false` resolves to nothing; the old Explorer-only context no longer resolves; opt-in keys resolve only with the setting on. One `deepStrictEqual` over a table of `[context, key] → commandId`.
- New `tileListNavigation.test.ts`: `focusFirstRowIfNone` with a real `WorkbenchList` inside a `.terminal-first-tool-tile` element (no focus → `[0]`; existing focus kept; list outside the tile → false; empty list → true, no throw). `ViewTileComposites.acquire` sets `terminalFirstViewTile` and `listTypeNavigationMode` on a real scoped `ContextKeyService` and resets on a stubbed `INativeVimService.onDidChange`. Actions picker builds groups from a stub `IMenuService` for an SCM resource and an `ExplorerItem`, includes `inline` actions, runs the chosen action with the row context.
- Extend `tiles.test.ts` `withTiles`: fake composite whose `focus()` focuses a list synchronously (Explorer path) and one that does so on a timeout (SCM path); after `group.focus()` both have `getFocus()` equal to `[0]`; a composite with no list leaves focus on the pane; a collapsed pane gets `setExpanded(true)`.

### Docs

- `TERMINAL_FIRST.md` "View tiles": entry focus, the key table, `.`/`m`/`F6`/`?`/`/`, Space leader, `terminalFirst.vim.listActionKeys`. "Validation": add the new selectors.
- `docs/specs/06-native-vim.md`: replace "Docked pane and Explorer navigation" with "Docked pane and tile list navigation"; add S6.21 (entry focus lands on a row), S6.22 (key table and when clause), S6.23 (actions picker, context menu, F6), S6.24 (opt-in action keys keep confirmations), S6.25 (trigger-mode type navigation in tiles).
- `docs/specs/09-tiling-workspace.md`: add S9.26 (keyboard focus of a view tile gives its list a visible cursor; collapsed panes expand); list `terminalFirstViewTile` under Implementation; add the setting to the Surface table.

### Verification

```sh
./scripts/test.sh --run vs/workbench/contrib/terminalFirst/test/browser/terminalFirstNavigation.test --run vs/workbench/contrib/terminalFirst/test/browser/tileListNavigation.test --run vs/workbench/contrib/terminalFirst/test/browser/tiles.test --run vs/workbench/contrib/terminalFirst/test/browser/nativeVim.test
```
Manual, native Vim on:
1. Ctrl+Option+G: Changes tile opens with the first row outlined; `j`/`k` move at once; `G`, `gg`, Ctrl+D/U work.
2. Ctrl+L from an editor into Explorer: cursor on the first (or last-focused) row; `h`/`l` collapse/expand; `l` on a file opens it and the cursor stays; Enter opens and moves focus.
3. `/` then `rea`: find filters; Esc closes; `j` moves immediately (no 800 ms dead zone).
4. `.` on a changed file lists Stage / Discard / Open File / Stage All / Refresh / Collapse All; Esc then `j`/`k` navigate the picker; discard still confirms.
5. `m` opens the native context menu; Shift+F10 still works; Tab reaches the row's inline Stage/Discard icons.
6. `F6` reaches the pane header toolbar, arrows move, Enter runs, Esc returns to the list with the cursor visible; second `F6` reaches the tile toolbar.
7. `?` lists every key; Space opens leader hints from the list; Ctrl+H/J/K/L still move between tiles.
8. Vim engine `off`: no single-letter keys fire; arrows and type-ahead behave as upstream.
9. Collapse the Source Control pane, Ctrl+L into the tile: the pane re-expands and the tree gets focus.
10. A webview or welcome-content tile: focus lands as before, no console errors.

---

## Workstream C: New Tile picker redesign

### Goal

One picker, four groups, every row with an icon, a name, and a description of what opens. Typing filters across label and description. The empty-workspace **New Tile** button and the `wa` / `Ctrl+Option+Return` chord open the same picker. `terminalFirst.tile.openView` with no argument shows only the view groups.

### Current state (verified)

- `src/vs/workbench/contrib/terminalFirst/browser/tiles.ts`
  - `pick()` (~L202) hardcodes "Tiles" separator + Editor + Terminal + `webAppTiles`, then appends `viewPicks()`.
  - `viewPicks()` (~L172) walks `tiledLocations` (Sidebar, Panel, AuxiliaryBar) in registration order, skips `TERMINAL_VIEW_ID` and containers with no `activeViewDescriptors`, labels rows with `model.title`, gives icons only when `model.icon` is a `ThemeIcon` (extension containers usually have a `URI` icon and lose it), and adds a "Single Views" group labelled `Container › View` with no icon.
  - `ITilePick` (~L81) carries `tile | app | view`.
  - `webAppTiles` (~L53) is the only registry-like structure.
- Empty label cause: `ViewContainerModel.updateContainerInfo` (`services/views/common/viewContainerModel.ts` ~L346) returns `''` for a generated container (one created by `moveViewToLocation`) when its first visible view has no `containerTitle`/`name`; the icon falls back to `defaultViewIcon`. `pick()` never checks for an empty label. `ViewTileInput.getName()` (`tileEditor.ts` ~L180) uses `?? "View"`, which does not catch `''`, so the tab is blank too.
- The empty-workspace button is a bare `<button class="terminal-first-empty-new-tile">` created in `editorGroupView.ts` (~L457) with text only; CSS in `tiles.css` ~L65-91.
- No tests cover `pick()` or `viewPicks()` (`tiles.test.ts` stubs only `IQuickInputService.input`).
- Upstream reference to reuse: `contrib/quickaccess/browser/viewQuickAccess.ts` orders containers by `IPaneCompositePartService.getVisiblePaneCompositeIds(location)`, respects `viewContainer.hideIfEmpty`, and matches on a `containerLabel`.

### Steps

1. **Introduce a tile catalog** in a new file `src/vs/workbench/contrib/terminalFirst/browser/tileCatalog.ts`:
   ```ts
   export const enum TileGroup { Workspace = 'workspace', Tools = 'tools', Web = 'web', Extensions = 'extensions' }
   export interface ITileCatalogEntry {
   	readonly id: string;                  // 'editor' | 'terminal' | 'web:jira' | 'container:<id>' | 'view:<id>'
   	readonly group: TileGroup;
   	readonly label: string;               // never empty
   	readonly description: string;         // what opens: "Empty editor tile", "Shell in the session directory", "Files in the workspace", "Source control", "Extension view"
   	readonly icon: ThemeIcon | { dark: URI; light?: URI };
   	readonly detail?: string;             // optional second line, e.g. configured Jira URL
   	readonly keybinding?: string;         // command id whose keybinding to show (e.g. 'terminalFirst.tile.explorer')
   	readonly open: (service: TileService, direction?: GroupDirection) => Promise<IEditorGroup | undefined>;
   }
   export function buildTileCatalog(accessor: { descriptors: IViewDescriptorService; composites: IPaneCompositePartService; contextKeys: IContextKeyService; configuration: IConfigurationService }): ITileCatalogEntry[]
   ```
   - **Workspace**: Editor (`Codicon.file`), Terminal (`Codicon.terminal`).
   - **Tools**: built-in containers in this fixed order: Explorer, Source Control ("Changes"), Search, Problems, Output, Debug Console, Run and Debug, Extensions (view), then any other built-in container. Determine "built-in" by `viewContainer.extensionId === undefined` (check `ViewContainer` has `extensionId`; if not, check the descriptor's `ctorDescriptor` origin or whitelist by ID prefix `workbench.`). Icons: `model.icon` when a `ThemeIcon`; otherwise the container's `viewContainer.icon`; otherwise `Codicon.layout`.
   - **Web**: each `webAppTiles` entry (`Codicon.globe`), `detail` = configured URL when set, otherwise "Asks for the URL the first time".
   - **Extensions**: every remaining container with active views, ordered by `getVisiblePaneCompositeIds(location)` then registration, labelled `model.title` with fallback chain `model.title || container.title (string or .value) || first active view name || container.id`. URI icons are passed through as `iconPath` (quick pick supports `iconPath: { dark, light }`). Add single-view rows (`canMoveView`, container has >1 active view) as `Container › View` under the same group, icon = the view's `containerIcon` when a `ThemeIcon`, else the container's icon.
   - Exclude `TERMINAL_VIEW_ID`, containers with `hideIfEmpty && !activeViewDescriptors.length`, and containers whose every view is user-hidden (`visibleViewDescriptors.length === 0`) unless the user shows hidden views (keep a `showHidden` flag off by default).
   - Label fallback must never yield `''`; add a unit test for this.
2. **Rewrite `TileService.pick()`** to render the catalog: one `IQuickPickSeparator` per group with the group label ("Workspace", "Tools", "Web", "Extensions"), each `ITilePick` populated with `label`, `description`, `detail`, `iconClasses`/`iconPath`, and `keybinding` resolved through `IKeybindingService.lookupKeybinding(commandId)` so chords show on the right as in the Command Palette. Use `matchOnDescription: true` and `matchOnDetail: true`. `viewsOnly` keeps only Tools and Extensions. Keep the `direction` parameter.
3. **Fix the blank tab name**: `ViewTileInput.getName()` and `getIcon()` in `tileEditor.ts` use the same fallback chain as the catalog (extract `viewContainerDisplayName(model, container)` and `viewContainerIcon(...)` helpers into `tileCatalog.ts` and reuse them).
4. **Empty-workspace button**: give it an icon (`Codicon.add`) plus label "New Tile" and a hover showing the chord via `IHoverService` (already injected in `editorGroupView.ts`). _Depends on A_: this button's creation moves into the fork's editor-group decorator; do the visual change there, not in `editorGroupView.ts`.
5. **Tests** in `tiles.test.ts` (new suite "tile picker"): register two built-in containers, one extension container with a URI icon, one generated container with an empty title, one hidden-if-empty container with no views; capture the items passed to a stubbed `IQuickInputService.pick` and `assert.deepStrictEqual` the `{ type, label, description, group }` projection against a snapshot literal. Add a second test that an empty-title container is labelled with its first view name.
6. **Docs**: `TERMINAL_FIRST.md` "View tiles" paragraph on the picker; `docs/specs/09-tiling-workspace.md` add `S9.24` (grouped picker, label fallback, icons on every row) and `S9.25` (tab name fallback).

### Verification

- `./scripts/test.sh --run vs/workbench/contrib/terminalFirst/test/browser/tiles.test`
- Manual: `Ctrl+Option+Return` shows four groups, every row has an icon and a description; type `git` and see Changes and any Git extension views; pick an extension view, its tab has a name and icon; `terminalFirst.tile.openView` from the Command Palette shows only Tools and Extensions.

---

## Workstream D: keybinding collisions and hardening backlog

### D1. Keybinding collisions (decision: move all four to leader + alternates)

Current registrations (`terminalFirst.contribution.ts` ~L98-129):

| Command | Today | New primary | New alternate | Leader (already exists in `terminalFirstLeader.ts`) |
| --- | --- | --- | --- | --- |
| `terminalFirst.addToJumpList` | `Cmd+A` (when file editor focused) | none | `Cmd+Shift+A` | `j a` |
| `terminalFirst.toggleFloatingJumpList` | `Cmd+J` | none | `Cmd+Shift+J` | `j j` |
| `terminalFirst.toggleFloatingFileBrowser` | `Cmd+E` | none | `Cmd+Shift+E` | `f b` (new entry; `f f` stays Quick Open, see note) |
| `terminalFirst.toggleFloatingTerminal` | `Cmd+T` | none | `Cmd+Shift+T` | `t t` |

Note: the owner's answer said "File Browser → `f f`", but `f f` is already Quick Open (Find File) in the editor leader map and is referenced in docs. Keep `f f` = Quick Open and add `f b` = Browse Files (floating browser). If the owner prefers `f f` for the browser, swap `ff`→browser and add `fp` → Quick Open.

Steps:
1. Remove the `KeyMod.CtrlCmd | KeyCode.KeyA/J/E/T` keybindings from the action table in `terminalFirst.contribution.ts`; add `KeyMod.CtrlCmd | KeyMod.Shift | key` with the same `when`/weight. `Cmd+Shift+E` collides with upstream "Focus Explorer" (`workbench.view.explorer`) which in VS NOSH opens the Explorer tile; keep weight `ExternalExtension + 1000` so the fork binding wins, and document it. `Cmd+Shift+T` collides with "Reopen Closed Editor"; same treatment, documented.
2. Add `{ keys: 'fb', label: "Browse Files", command: 'terminalFirst.toggleFloatingFileBrowser' }` to `editorActions` in `terminalFirstLeader.ts`.
3. Verify Select All, Toggle Panel (no-op in VS NOSH), Use Selection for Find, and Go to Symbol in Workspace are back to upstream behavior.
4. Update `TERMINAL_FIRST.md` Workflow table, `docs/specs/05-jump-list.md` (open question 1 resolved), `03-floating-terminal.md` (open question 2 resolved), `04-floating-file-browser.md`, `07-workbench-branding-distribution.md` keybinding table.
5. Test: extend `terminalFirstNavigation.test.ts` style keybinding-resolution test (or add `terminalFirstKeybindings.test.ts`) asserting `Cmd+A` resolves to `editor.action.selectAll` in a file editor and `Cmd+Shift+A` resolves to `terminalFirst.addToJumpList`.

### D2. Hardening backlog (from `docs/specs/*` Known gaps, ordered by user impact)

Each item is one commit. Mark the spec's gap as resolved in the same commit.

**Sessions and shell (spec 1, 2)**
1. Blocked commands give no feedback (`commandService.ts` gate returns `undefined`). After A moves the gate into a fork hook, log blocked command IDs once per session at `info` level and show a single status-style notification the first time a *user-invoked* (keybinding or palette) command is blocked in shell mode: "Available in the editor. Press Ctrl+Space e." Test in `terminalFirstPolicy.test.ts`.
2. Session titles: allow rename (`terminalFirst.renameSession`, leader `t r`), persist in the session metadata already stored with the shell-integration nonce; fall back to terminal title. Test in `terminalFirstService.test.ts` and `sessionTabs.test.ts`.
3. `code`/`e` CLI (`extensions/terminal-first/cli.cjs`): help text uses the invoked name; support `e .`/`e <dir>` (set session directory and open the editor there, spec 2 open question 2 → yes); support `file:line:col` goto. Tests in `extensions/terminal-first/test/cli.test.cjs`.
4. Status bar source of truth: spec 1 notes `present()` shows the status bar while defaults hide it. Pick: visible in editor mode, hidden in shell mode, driven by one place in `terminalFirstService.ts`; remove the conflicting default.

**Floating tools (spec 3, 4, 5)**
5. Floating terminal: show owning session name and cwd in the overlay header; add Escape-free mouse dismissal via a small close control (restores the removed Hide affordance, keyboard users unaffected).
6. File browser key vocabulary (spec 4 gap 1): make the native-Vim vocabulary canonical (`h`/`l` parent/open, `.` hidden, `gg`/`G`), keep `g`/`e`/`w`/`t`/`f` as documented, and regenerate the help picker labels from one table so help and bindings cannot drift. Persist per-session browser state (last folder, root, hidden flag) in `IStorageService` workspace scope keyed by session ID.
7. Jump list: Harpoon-style slots: `terminalFirst.jumpToSlot1..9` commands bound to leader `j 1..9`; move-up/move-down inside the list (`Ctrl+K`/`Ctrl+J` in the list, or `K`/`J` in normal mode); keep undo history across toggles by not reloading the model when the project key is unchanged.

**Native Vim (spec 6)**
8. Undo-transaction watchdog: wrap every `beginUndoRedoTransaction` user in `try/finally`, add a test in `nativeVim.test.ts` that an exception mid-insert still ends the transaction, and assert `pushStackElement` resumes.
9. Performance: replace full-document `getValue()` reads with a model-backed `VimHost` for motions that only need the current line or a window of lines (`getLineContent`, `getValueInRange`). Add a benchmark-style test on a 50k-line model asserting a motion completes under a budget.
10. Persist registers and marks per window in `IStorageService` (profile scope), opt-in setting `terminalFirst.vim.persistRegisters` default true.

**Tiles (spec 9, 10)**
11. Background reveals creating tiles: default `debug.openDebug` and `debug.internalConsoleOptions` to `neverOpen` in the fork's configuration defaults; only *focused* opens may create a tile, background reveals only focus an existing one (spec 9 open question 3 → no new tiles).
12. Web app tiles: leader routes `w b` (Jira) and `w c` (Bitbucket) in `terminalFirstLeader.ts`.

**Distribution and hygiene (spec 7)**
13. `product.json`: point `reportIssueUrl` at `noshpotosh/editor`; add a `CHANGELOG.md` for the fork; keep extension gallery decision as-is but document it.
14. Spec drift: `docs/specs/07` says `workbench.editor.showTabs: single` but the code sets `multiple`; `docs/specs/README.md` says "about 40 upstream files" and "only two unconditional changes"; `TERMINAL_FIRST.md` claims an `upstream` remote. Fix all three in Workstream A's docs step.

### Verification for D

- `node --test extensions/terminal-first/test/cli.test.cjs`
- `./scripts/test.sh --run vs/workbench/contrib/terminalFirst/test/browser/terminalFirstService.test --run vs/workbench/contrib/terminalFirst/test/browser/nativeVim.test --run vs/workbench/contrib/terminalFirst/test/browser/floatingJumpList.test --run vs/workbench/contrib/terminalFirst/test/browser/jumpListModel.test --run vs/workbench/contrib/terminalFirst/test/browser/floatingFileBrowser.test --run vs/workbench/contrib/terminalFirst/test/browser/terminalFirstPolicy.test`
- Manual: `Cmd+A` selects all in a file; `Cmd+Shift+A` adds to the jump list; leader `j a`, `j j`, `f b`, `t t` work; a blocked command in shell mode shows the one-time hint.

---

## Workstream E: spaces

Approved 2026-10-30 after A to D. A session can hold several named tile layouts ("spaces") over the same directory and shell, switched from a status bar switcher (`spaceStatus.ts`, one `IStatusbarService` entry, hidden for a single space), `Ctrl+Option` chords, and the leader, and started from presets (`common/spacePresets.ts`, setting `terminalFirst.spaces.presets`, `TileService.applyPreset`). The design reuses `EditorPartSessions` unchanged by retaining each space's grid under the key `sessionId` (first space) or `sessionId#spaceId` (`contrib/terminalFirst/common/spaces.ts`) and scopes `ViewTileInput` to that key. No upstream file changes. Requirements: `docs/specs/11-spaces.md`. Tests: `spaces.test`, `spaceStatus.test`, `terminalFirstService.test`, `tiles.test`.

---

## Workstream F: startup and quit performance

Approved 2026-10-30. The owner uses VS NOSH as the everyday terminal too: launch, run a quick command, quit. Target (spec 07): shell input within 500 ms on a warm packaged launch, measured from process start through an input round trip. Full design: the approved plan is summarized here; `docs/specs/07-workbench-branding-distribution.md` "Startup performance" holds requirements and the results table.

### Why the shell was slow

`TerminalFirstContribution` was `AfterRestored` (idle-scheduled behind about 200 contributions), then awaited the uncapped `layoutService.whenRestored` (which the fork's `EditorPartSessions.onDidRestore` extends to every saved session and space), then `terminalService.whenConnected` (every revived terminal's replay), then a first spawn gated three times on the macOS login-shell probe (`$SHELL -i -l -c`, 10 s cap) through `profilesReady`, `LocalTerminalBackend.createProcess`, and `TerminalProcessManager`. No pty could connect before `Restored` (`localTerminalBackend.ts` `_connectToDirectProxy`). The whole grid, title bar included, stayed hidden until `presented`. No mark covered the first prompt. `product.json` had no `quality`, so packaged builds shipped no Node compile cache. Quit persisted every buffer (2 s race) and waited up to 5 s + 6 s for the extension host.

### Steps

| Step | What | Files | Upstream touch |
| --- | --- | --- | --- |
| F0 | Marks `code/terminalFirst/prompt` (first pty output) and `input` (newline echo, only when `--prof-duration-markers` names the pair); marks published to `ITimerService` under source `terminalFirst`; JSON dump beside `--prof-duration-markers-file`; command **Developer: Terminal First Startup Marks**; `scripts/terminal-first-perf.sh` + `.mjs` (runs, warm/cold, stock/owner profile, `--quit`, medians/p90, history); launcher stamp = commit (+`-dirty`), `--build-only`, `--no-build-check`; `quality: "stable"` | `contrib/terminalFirst/browser/startupTimings.ts`, `terminalFirstService.ts`, `scripts/terminal-first-perf.*`, `scripts/terminal-first-app.sh`, `product.json` | `product.json` only |
| F3.1 | Pty connects at `Ready`: skip the `Restored` wait in `_connectToDirectProxy` under the gate (pty host is already warmed in main) | `contrib/terminal/electron-browser/localTerminalBackend.ts` | 1 line, gated |
| F1 | Shell at `BlockRestore`; await `editorGroupsService.whenReady` instead of `whenRestored`; wait for `connectionState === Connected` (nonces final) rather than every replay, bounded at 1.5 s, with an `onDidCreateInstance` net for late reconnects; `showPanel` before `ensureTerminal`; activate non-active spaces after `presented`; title bar visible from first paint (`sessionStrip.css` hides `.part:not(.titlebar)`); `onDidRestore` no longer awaits every group | fork only | none |
| F2 | Login shell off the terminal path: `getProfiles` uses `process.env`, `createProcess` passes `executableEnv = {}`, the variable resolver skips the shell-env merge; default `terminal.integrated.inheritEnv: false` | `ptyHostService.ts:316`, `localTerminalBackend.ts:218`, `terminalProcessManager.ts:276` | 3 one-liners, gated |
| F3.2 | Pre-import xterm at `BlockRestore`; measure double profile resolution and ZDOTDIR copies before touching them | fork only | none |
| F7 | Pre-spawn the session shell from the main process on `onWillLoadWindow` into the warmed pty host (persistent, detached, layout set), adopted by the renderer through upstream's reconnect path. **Only if** median `prompt − presented` is 150 ms or more after F0–F3 | `platform/terminalFirst/electron-main/terminalFirstShellPrespawn.ts`, `platform/terminalFirst/common/terminalFirstEnvironment.ts` | `app.ts` +1 line in the gated block; optional `terminalService.ts:1003` |
| F4 | `deferStartupContribution(id, phase)` seam consulted by `registerWorkbenchContribution2`, list filled from the marks command's slowest constructors; extension host starts at `min(presented, Restored + 2 s)` via `services/terminalFirst/common/terminalFirstStartup.ts` (setting `terminalFirst.startup.deferExtensionHost`); `NativeVimStartup` calls `getInstalled()` only for the extension engine; session strip coalesces renders | `platform/terminalFirst/common/startupPhaseOverrides.ts`, fork files | `contributions.ts:171`, `nativeExtensionService.ts:138`, 1 line each |
| F5 | Defaults: `persistentSessionReviveProcess: never`, `environmentChangesRelaunch: false`, `shellIntegration.environmentReporting: false`; Copilot out of the packaged build (`VSCODE_SKIP_COPILOT=1`, `defaultChatAgent` removed) | fork defaults, `build/gulpfile.vscode.ts`, `product.json` | build only |
| F6 | Quit: ext-host deactivate 1 s and main exit wait 1.5 s under the gate; `e` uses `curl --unix-socket` when available, pointer wait 10 s, pointer cleanup | `extHostExtensionService.ts:267`, `extensionHostStarter.ts:39`, `extensions/terminal-first/bin/e` | 2 one-liners, gated |

Order: F0 → F3.1 → F1 → F2 → measure → F3.2 → F7 (decision rule) → F4 → F5 → F6. Nothing lands without a before/after row from the harness.

### Verification

```sh
./scripts/test.sh --run vs/workbench/contrib/terminalFirst/test/browser/terminalFirstService.test --run vs/workbench/contrib/terminalFirst/test/browser/startupTimings.test --run vs/workbench/contrib/terminalFirst/test/browser/editorPartSessions.test --run vs/workbench/contrib/terminalFirst/test/browser/sessionTabs.test
node --test scripts/terminal-first-perf.test.mjs extensions/terminal-first/test/cli.test.cjs
scripts/terminal-first-app.sh --build-only && scripts/terminal-first-perf.sh --runs 5 --profile stock && scripts/terminal-first-perf.sh --runs 5 --profile owner && scripts/terminal-first-perf.sh --runs 5 --quit
```

Manual: fresh folder launch shows the title bar at once and a prompt soon after; typing works before extensions finish (`input` precedes `extensions` in the marks command); quit with two sessions and relaunch restores the tabs with fresh shells; Reload Window reattaches; `echo $PATH` and `which git` in the first shell match Terminal.app; `e README.md` from the first prompt opens the editor; Cmd+Q with `sleep 100` running quits without a dialog.

## Status table (update as steps land)

| Step | Status | Commit | Notes |
| --- | --- | --- | --- |
| A0 baseline | done | 16731bb1f9c | tag `fork/pre-seams`, `upstream` remote added and fetched |
| A1 gating | done | (see git log) | `TERMINAL_FIRST_SESSION` env gating deferred to A3 (needs the policy seam so the test can register it); `whenEditorClosed(acceptClose)` kept as a 2-line additive hook instead of duplicating 60 lines; `viewsService.ts` helper shrink skipped (call sites differ) |
| A4 view pruning | done | 7a874eaabb6 | `chatSetupContributions`, `relauncher`, `remoteAgentHost`, `agentHostService` keep their small gated edits |
| A3 terminal policy seam | done | (see git log) | `ICreateTerminalOptions`/`IShellLaunchConfig` fork fields removed; `TERMINAL_FIRST_SESSION` now set via `decorateEnvironment`; upstream terminal tests pristine |
| A2.1 routing + layout hooks | done | (see git log) | `editorGroupRouting.ts`, `editorPartHooks.ts` seams; `tileRouting.ts`, `tileLayoutHook.ts`, `tileChrome.ts` in the fork; `getActionRowCenter` additions to the tab controls dropped (chrome reads the DOM) |
| A2.2 sessions extension | done | (see git log) | `EditorPartSessions` extension with `for()`/`attach()`; `IEditorPart.sessions`/`swapGroups` removed; upstream editor tests pristine |
| A5 titlebar | done | (see git log) | `SessionStripContribution` injects the strip; browser `titlebarPart.ts` pristine; electron-browser part keeps a 4-line `minimumHeight` hunk |
| A6 manifest + sync | done | (see git log) | `build/fork/upstream-patches.json`, `build/fork/upstream-check.ts`, `scripts/upstream-check.sh`, `scripts/upstream-sync.sh`, `docs/upstream/{SYNC,PATCHES}.md`, `.github/workflows/upstream-drift.yml`; dry run against `upstream/main` shows zero conflicts in documented patches |
| B keyboard model | done | (see git log) | `tileListNavigation.ts`, `tileListActions.ts`, deterministic `ViewTileEditor.focus()`, tile-scoped `terminalFirstViewTile` and `listTypeNavigationMode`; `.` row actions are generic via `TileContextMenuService` capture (no per-view providers); manual checklist in the B verification section still to run in the app |
| C picker | done | (see git log) | `tileCatalog.ts`; `ViewTileInput` name/icon fallbacks; empty-workspace button with icon and chord hover |
| D1 key collisions | done | (see git log) | `Cmd+Shift+A/J/E/T` plus leader `j a`, `j j`, `f b`, `t t`; no automated keybinding test because the bindings register inside the gated contribution module |
| D2.11 debug reveal defaults | done | (see git log) | |
| D2.12 web app leader routes | done | (see git log) | `w b`, `w c` |
| D2.13 issue URL + CHANGELOG | done | (see git log) | extension gallery decision unchanged |
| D2.14 spec drift | done | (see git log) | |
| D2.1 blocked-command feedback | done | (see git log) | log once per id; one-time shell hint via notification center |
| D2.3 CLI | done | (see git log) | directory arg, `-g file:line:col`, invoked name in help/errors |
| D2.7 jump list slots | done | (see git log) | `j 1`…`j 9`, `J`/`K` reorder, undo kept across reopen |
| D2.2 session rename | done | (see git log) | |
| D2.4 status bar | done | (see git log) | documented: present() is the source of truth |
| D2.5 floating terminal header | done | (see git log) | session, title, cwd, close control |
| D2.6 file browser | done | (see git log) | Vim vocabulary everywhere; per-session state persisted |
| D2.8 undo watchdog | done | (see git log) | `safeKey` + test |
| D2.10 registers persistence | done | (see git log) | `terminalFirst.vim.persistRegisters` |
| D2.9 native Vim performance | partial | (see git log) | removed a whole-document copy from visual selection; 50k-line regression test added; model-backed `VimHost` still open |
| E spaces | done | (see git log) | status bar switcher, `terminalFirst.space.*` commands, leader digits and `Tab` group, presets for New Space and New Session from Preset; moving a tile between spaces deferred |
| F0 perf harness | done | 1874092efb7 + 58afc904a81, c163428a476, f702d86cacc | marks `prompt`/`input`, marks command, `scripts/terminal-first-perf.sh`, launcher stamp, `quality: stable` (compile-cache validator accepts the uid suffix); baseline in spec 07: stock warm launch→input 1494 ms, quit 221 ms |
| F0.5 shell in untrusted folders | done | b4c3828969a | `terminal.integrated.allowInUntrustedWorkspace: true`; a fresh profile never got a prompt because the first shell waited behind the trust dialog |
| F3.1 pty connect at Ready | done | 65e3cc46110 | gated `Restored` wait removal in `_connectToDirectProxy` |
| F1 shell-first scheduling | done | (see git log) | BlockRestore, `editorGroupsService.whenReady`, `Connected` not replay (1.5 s budget, late reconnects adopted by nonce), title bar first, hidden layouts restore after `terminalFirstStartup.whenPresented()` |
| F2 login shell off the critical path | todo | | three gates + `inheritEnv: false` |
| F3.2 xterm pre-import | todo | | keep only if measured |
| F7 main-process pre-spawn | todo | | only if median `prompt − presented` ≥ 150 ms |
| F4 defer non-terminal work | todo | | phase seam, ext-host deferral, nativeVim, strip |
| F5 defaults and Copilot | todo | | revive never, relaunch off, Copilot out of the build |
| F6 fast quit and `e` | todo | | timeouts, curl fast path, pointer cleanup |

## Definition of done (whole plan)

- [x] The Status table in this file is kept current as steps land.
- [x] `scripts/upstream-check.sh` passes: every modified upstream file is listed in `docs/upstream/PATCHES.md`.
- [x] Every modified upstream file's diff is gated or listed in the manifest with a reason.
- [ ] `Ctrl+Option+G`, then `j`/`k` immediately moves a visible cursor in Changes; `.` opens row actions; `?` shows help. Same in Explorer, Search, Problems, and an extension tree view. (Unit-tested; the in-app manual checklist in Workstream B is still to run.)
- [x] New Tile picker has four groups, icon + name + description on every row, and a snapshot test.
- [x] `Cmd+A/J/E/T` behave as upstream; the fork's actions are on leader + `Cmd+Shift`.
- [x] Full validation list from `docs/upstream/SYNC.md` passes (343 tests), plus `npm run valid-layers-check`, `npm run typecheck-client`, `npm run eslint` on all changed files, the 11 CLI tests, and `scripts/upstream-check.sh`. Remaining manual work: the in-app smoke checklist (`npm run build-fast && ./scripts/terminal-first.sh <project>`) and D2.9's model-backed Vim host.
