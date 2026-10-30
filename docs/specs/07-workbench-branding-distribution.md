# Spec 7: Workbench Simplification, Branding, and Distribution

## Status

Mixed. The defaults and branding are committed. The view pruning (SCM, Outline, Timeline, Debug), sign-in removal, and startup flash fixes are uncommitted.

## Problem and goals

The editor surface should feel like a focused editor, not an IDE: one tab row, no status noise, a minimal sidebar, and no AI or sign-in prompts. VS NOSH must also be identifiable as its own app and must not collide with an installed VS Code.

## Behavior: default settings

- **S7.1** These configuration defaults apply when `terminalFirstEnabled` is true. Users can override them.

  | Area | Settings |
  | --- | --- |
  | Startup | `workbench.startupEditor: none`, `workbench.welcomePage.experimentalOnboarding: false` |
  | Editor tabs | `workbench.editor.showTabs: single`, `enablePreview: false`, `focusRecentEditorAfterClose: true`, `editorActionsLocation: hidden` |
  | Chrome | `workbench.statusBar.visible: false`, `workbench.activityBar.location: top`, `workbench.sideBar.location: right`, `workbench.secondarySideBar.defaultVisibility: hidden`, `window.commandCenter: false`, `workbench.layoutControl.enabled: false`, `chat.titleBar.openInAgentsWindow.enabled: false` |
  | Editor | `editor.minimap.enabled: false`, `breadcrumbs.enabled: false` |
  | Terminal | `terminal.integrated.initialHint: false`, `tabs.enabled: false`, `tabs.showActiveTerminal: never`, `shellIntegration.decorationsEnabled: never`, `allowChords: false` |
  | SCM | `git.showCommitInput: false`, `scm.showActionButton: false`, `scm.showInputActionButton: false` |
  | VSCodeVim | `vim.showmodename: true`, `vim.statusBarColorControl: false`, `vim.useCtrlKeys: true`, `vim.showMarksInGutter: true` |

## Behavior: removed or hidden UI

These are hard-coded when the gate is on, not settings:

- **S7.2** The Source Control view never shows the commit input or action button, even if the user enables them. The Source Control Graph view is not registered.
- **S7.3** The Outline and Timeline views are not registered.
- **S7.4** The Run and Debug container is unpinned from the activity bar by default, using a new `IViewContainerDescriptor.defaultPinned` property. It is still reachable.
- **S7.5** The title-bar Copilot sign-in action and its toggle are not registered.
- **S7.6** The title-bar layout controls, the Open in Agents button, and the window title are hidden. The former Toggle Workbench Tools command is removed.
- **S7.7** The editor has no embedded terminal panel (spec 1, spec 3).

## Behavior: keybindings added or overridden

| Key | VS NOSH | Upstream meaning displaced |
| --- | --- | --- |
| `Cmd+A` (file editor focused) | Add File to Jump List | Select All |
| `Cmd+J` | Toggle Floating Jump List | Toggle Panel |
| `Cmd+E` | Toggle Floating File Browser | Use Selection for Find |
| `Cmd+T` | Toggle Floating Terminal | Go to Symbol in Workspace |
| `Cmd+Option+N` / `P` / `←` / `→` | Session new / pick / previous / next | (none significant) |

## Behavior: branding and identity

- **S7.8** Display name **VS NOSH**, with an icon at `resources/darwin/vs-nosh.png` and `vs-nosh.icns`, used by Electron packaging (`build/lib/electron.ts`) and DMG creation (`build/darwin/create-dmg.ts`).
- **S7.9** Internal identity keeps the `terminal-first` names for compatibility: `applicationName: terminal-first`, `urlProtocol: terminal-first` (which is also the feature gate), `darwinBundleIdentifier: dev.terminalfirst.editor`, data folders `.terminal-first` and `.terminal-first-shared`, and server and tunnel names `terminal-first-server` and `terminal-first-tunnel`.
- **S7.10** Windows and Linux product fields still carry the Code OSS values. The fork is macOS-only.

## Behavior: build and run

- **S7.11** Node `24.22.1` (`.nvmrc`). Build with `npm run install-fast` and `npm run build-fast`.
- **S7.12** `scripts/terminal-first.sh [args]` runs `scripts/code.sh` with user data, extensions, and shared data under `.build/terminal-first/`. It installs no global command and does not touch dotfiles. `scripts/terminal-first-cli.sh` is the same isolated CLI, for example for `--install-extension`.
- **S7.13** `scripts/setup-terminal-first-vim.sh` downloads VSCodeVim `1.32.4` from GitHub releases, verifies its SHA-256, and installs it into the isolated profile.

## Upstream surface

The fork modifies these upstream files. Every upstream merge must re-check them, with special care for the core editor and terminal changes.

- Core editor: `editor/common/model.ts`, `editor/common/model/textModel.ts` (undo transactions; unconditional)
- Platform: `platform/terminal/common/terminal.ts`
- Startup: `code/electron-browser/workbench/workbench.ts`, `workbench/browser/workbench.ts`, `workbench/browser/layout.ts`, `services/layout/browser/layoutService.ts`, `workbench.desktop.main.ts`
- Editor parts: `browser/editor.ts`, `parts/editor/{editor,editorGroupView,editorPart,editorParts}.ts`, `services/editor/{browser/editorService,common/editorGroupsService,common/editorService}.ts`
- Panels and bars: `parts/paneCompositeBar.ts` (`defaultPinned`; unconditional), `parts/paneCompositePart.ts`, `parts/panel/panelPart.ts`, `parts/titlebar/titlebarPart.ts`, `common/views.ts`
- Terminal: `contrib/terminal/browser/{terminal,terminalActions,terminalEditorService,terminalGroup,terminalInstanceService,terminalProcessManager,terminalService}.ts`, `contrib/terminal/common/terminal.ts`, `electron-browser/localTerminalBackend.ts`
- Commands and workspace: `services/commands/common/commandService.ts`, `services/workspaces/electron-browser/workspaceEditingService.ts`, `services/workingCopy/common/{workingCopyBackupTracker,workingCopyEditorService}.ts`
- Extension host: `api/node/extHostCLIServer.ts`, `api/node/extHostExtensionService.ts`, `api/browser/statusBarExtensionPoint.ts`
- Contributions: `contrib/{scm,outline,timeline,debug}/…`, `contrib/chat/browser/chatSetup/chatSetupContributions.ts`, `contrib/chat/electron-browser/agentSessions/agentSessionsActions.ts`, `contrib/relauncher/browser/relauncher.contribution.ts`
- Build: `build/lib/electron.ts`, `build/darwin/create-dmg.ts`, `build/lib/i18n.resources.json`, `product.json`

## Known gaps and risks

- **No release pipeline.** There is no signed or notarized `.app`, no DMG publishing, no auto-update feed (`product.json` has no update URL), no crash reporting, and no CI. Only the source build is exercised.
- **Keybinding displacement** (table above). `Cmd+A` is the most serious.
- **Hard removals are not reversible by users** (S7.2–S7.5). A user who wants the SCM commit box or Outline view cannot turn it back on. Consider settings or `when` clauses instead of conditional registration.
- `import { terminalFirstEnabled }` is placed as the first import in several upstream files (scm, outline, timeline, debug, chat setup), which increases merge conflicts. Grouping these imports consistently would reduce churn.
- The status bar default (hidden) conflicts with `present()` showing it in editor mode (spec 1).
- `reportIssueUrl` still points at `microsoft/vscode`, so Report Issue would file VS NOSH bugs upstream. `product.json` configures no extension gallery, so extensions can only be installed from VSIX files. Review both before any public release.
- License and trademark: the Microsoft copyright headers are kept as the repository requires. Confirm the "VS NOSH" name and icon are cleared for distribution.

## Open questions

1. Distribution target: personal source build, signed DMG, or Homebrew cask?
2. Should the pruned views become opt-in settings?
3. Rename the internal `terminal-first` identifiers before the first public build, given that changing them later breaks user data paths?
4. Upstream cadence: how often to rebase onto `microsoft/vscode`, and who owns the re-validation?

## Release acceptance

- [ ] A clean clone on a fresh Mac builds and launches using only the README steps.
- [ ] An installed VS Code running side by side shares no data, URL scheme, or bundle id.
- [ ] Every default in S7.1 is applied on a fresh profile and can be overridden.
- [ ] The SCM view works for staging, diff, and discard without the commit input. Committing works from the shell.
- [ ] The app icon and name appear correctly in the Dock, the Cmd+Tab switcher, About, and the DMG.
