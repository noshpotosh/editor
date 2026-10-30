# Spec 7: Workbench Simplification, Branding, and Distribution

## Status

Mixed. The defaults and branding are committed. The view pruning (SCM, Outline, Timeline, Debug), sign-in removal, and startup flash fixes are uncommitted.

## Problem and goals

The editor surface should feel like a focused editor, not an IDE: one tab row, no status noise, no sidebar (views open as tiles, spec 9), and no AI or sign-in prompts. VS NOSH must also be identifiable as its own app and must not collide with an installed VS Code.

## Behavior: default settings

- **S7.1** These configuration defaults apply when `terminalFirstEnabled` is true. Users can override them.

  | Area | Settings |
  | --- | --- |
  | Startup | `workbench.startupEditor: none`, `workbench.welcomePage.experimentalOnboarding: false` |
  | Editor tabs | `workbench.editor.showTabs: multiple`, `enablePreview: false`, `focusRecentEditorAfterClose: true`, `editorActionsLocation: hidden` |
  | Chrome | `workbench.statusBar.visible: false`, `workbench.activityBar.location: hidden`, `workbench.secondarySideBar.defaultVisibility: hidden`, `window.commandCenter: false`, `workbench.layoutControl.enabled: false`, `chat.titleBar.openInAgentsWindow.enabled: false` |
  | Editor | `editor.minimap.enabled: false`, `breadcrumbs.enabled: false` |
  | Terminal | `terminal.integrated.initialHint: false`, `tabs.enabled: false`, `tabs.showActiveTerminal: never`, `shellIntegration.decorationsEnabled: never`, `allowChords: false` |
  | SCM | `git.showCommitInput: false`, `scm.showActionButton: false`, `scm.showInputActionButton: false` |
  | VSCodeVim | `vim.showmodename: true`, `vim.statusBarColorControl: false`, `vim.useCtrlKeys: true`, `vim.showMarksInGutter: true` |

## Behavior: removed or hidden UI

These are hard-coded when the gate is on, not settings:

- **S7.2** The Source Control commit input and action button are off by default (`git.showCommitInput`, `scm.showActionButton`, `scm.showInputActionButton`) and can be turned back on. The Source Control Graph view is removed by `viewPruning.ts`.
- **S7.3** The Outline and Timeline views are removed by `viewPruning.ts` after their contributions register them.
- **S7.4** The activity bar is hidden by default (`workbench.activityBar.location: hidden`), so no container pin state is visible. Run and Debug remains reachable as a tile.
- **S7.5** The title-bar Copilot sign-in action and its toggle are not registered.
- **S7.6** The title-bar layout controls, the Open in Agents button, and the window title are hidden. The former Toggle Workbench Tools command is removed.
- **S7.7** The editor has no embedded terminal panel (spec 1, spec 3).

## Behavior: keybindings added or overridden

| Key | VS NOSH | Upstream meaning displaced |
| --- | --- | --- |
| `Cmd+Shift+A` (file editor focused), leader `j a` | Add File to Jump List | (none) |
| `Cmd+Shift+J`, leader `j j` | Toggle Floating Jump List | (none) |
| `Cmd+Shift+E`, leader `f b` | Toggle Floating File Browser | Focus Explorer (which in VS NOSH opens the Explorer tile; use Ctrl+Option+E or `f e`) |
| `Cmd+Shift+T`, leader `t t` | Toggle Floating Terminal | Reopen Closed Editor |
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

The fork modifies about 60 upstream files. Every one of them is listed, with its seam and its validation command, in the generated [`docs/upstream/PATCHES.md`](../upstream/PATCHES.md), and `scripts/upstream-check.sh` fails when that list drifts from the tree. The merge procedure is in [`docs/upstream/SYNC.md`](../upstream/SYNC.md). The riskiest edits are the hook call-outs in `editorPart.ts`, `editorGroupView.ts`, and `terminalService.ts`, and the unconditional text-model undo transaction API.

## Known gaps and risks

- **No release pipeline.** There is no signed or notarized `.app`, no DMG publishing, no auto-update feed (`product.json` has no update URL), no crash reporting, and no CI. Only the source build is exercised.
- **Keybinding displacement** (table above) is limited to two `Cmd+Shift` chords; `Cmd+A`, `Cmd+J`, `Cmd+E`, and `Cmd+T` keep their upstream meaning.
- **Hard removals are not reversible by users** (S7.2–S7.5). A user who wants the SCM commit box or Outline view cannot turn it back on. Consider settings or `when` clauses instead of conditional registration.
- The status bar default (hidden) conflicts with `present()` showing it in editor mode (spec 1).
- `product.json` configures no extension gallery, so extensions can only be installed from VSIX files. Review both before any public release.
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


## Terminal-first presentation and startup (2026-10-29)

The custom title bar contains session tabs and uses the terminal background in shell mode. VS Code’s default themes remain the baseline. VS NOSH Dark/Light are bundled as opt-in themes for continued refinement. Defaults add a blinking block cursor, 10,000-line scrollback, GPU acceleration, terminal font size 13 and line height 1.2. `terminalFirst.terminal.padding` defaults to 12 px and applies live.

Shell toasts are suppressed except URGENT notifications; retained notifications are accessible through the title-bar count. Startup trust prompting defaults to never, and editor entry requests trust when needed. Recommendations, release notes, updates, tips, experiments, and parent-folder Git discovery are disabled by default; Git discovery is limited to subfolders. User settings still override defaults.

`scripts/terminal-first-app.sh [--build] [args]` builds `vscode-darwin-arm64-min` when needed and starts the packaged Electron binary without VSCODE_DEV. All launchers share `.build/terminal-first` isolation. Dev prelaunch is skipped only when `.build/electron` and `out` exist; this does not rebuild stale output.

### Measurement record

The first instrumented development-window load measured 4,470 ms from renderer navigation to session initialization, then 590 ms entering the managed workspace, 14 ms creating/restoring the shell, and 77 ms presenting it. CLI readiness followed presentation by 280 ms. These are single-run diagnostic observations, not an unchanged-code baseline or a packaged benchmark. They motivated translating folder launches before window loading. Marks: `start`, `restored`, `workspace`, `connected`, `created`, `presented`, `extensions`, and `cli`, all under `code/terminalFirst/`.

The target remains shell input within 500 ms on warm packaged launches. Do not treat CDP readiness or the session-controller interval as whole-app startup. Packaged acceptance and before/after measurements must include process startup and an actual input round trip. Extension trimming remains measurement-driven; no arbitrary disable list is shipped.


### Verification result

The focused Electron run passed 52 tests covering session lifecycle, native/global leader routing, read-only copy motions/search/yank, title-bar tab rendering/arrow focus, and quiet-shell notification retention/urgent exceptions. All 9 CLI tests passed, including delayed pointer creation. Client typechecking and targeted lint passed. An isolated development window verified the title-bar layout, global leader, and copy selection/yank.

The packaged build reached app packaging but failed in the existing Copilot preparation task: `prepareBuiltInCopilotRipgrepShim` could not find `extensions/copilot/node_modules/@github/copilot/sdk` inside the packaged app. Packaged startup timing and the 500 ms target remain unverified. The launcher records a successful build marker only after gulp succeeds, so an incomplete app is not treated as ready. Fullscreen drag/zoom, VSCodeVim integration, and the full light/high-contrast acceptance matrix remain manual release checks.

A subsequent fresh folder launch eliminated the renderer workspace transition (under 1 ms) and presented the shell about 103 ms after session initialization, at 4,733 ms after renderer navigation. A later reconnect/reload run waited 3,247 ms for the pty connection, then presented in 104 ms; explicit background CLI activation completed 85 ms later. These observations expose remaining startup costs rather than establishing the packaged target. Live `e` routing to the owning editor was verified.

Theme follow-up: the default remains upstream Dark Modern, with VS NOSH Dark/Light opt-in. The local isolated profile was reset from One Dark Pro Flat and its color overrides (a backup was retained). Dark Modern and VS NOSH Light were visually checked; the title-bar and saved splash fallback now use the terminal’s panel background when a theme does not specify terminal.background.

## Theming and customization

Every Terminal First surface is styled from design tokens (spacing, corner radius, type, and stroke ramps) and from registered `terminalFirst.*` theme colors. Each color defaults to an existing workbench color, so any VS Code theme renders these surfaces coherently without knowing about them. Themes and `workbench.colorCustomizations` can override them individually, and they appear in settings IntelliSense. Floating surfaces follow the command palette (`quickInput.*`) so they match how a theme already styles pickers. High contrast themes resolve borders to `contrastBorder` / `contrastActiveBorder`.

| Color | Default | Surface |
|---|---|---|
| `terminalFirst.sessionStrip.background` | `terminal.background`, then `panel.background` | Title bar while the shell is shown |
| `terminalFirst.sessionTab.activeBackground` | `tab.activeBackground` | Active session tab |
| `terminalFirst.sessionTab.activeForeground` | `tab.activeForeground` | Active session tab |
| `terminalFirst.sessionTab.activeBorder` | `tab.activeBorderTop` (HC: `contrastActiveBorder`) | Active session tab top border |
| `terminalFirst.sessionTab.inactiveForeground` | `tab.inactiveForeground` | Inactive tabs and strip buttons |
| `terminalFirst.sessionTab.hoverBackground` | `toolbar.hoverBackground` | Hovered tabs and strip buttons |
| `terminalFirst.floating.background` | `quickInput.background` | Floating terminal, file browser, jump list, leader menu, Vim status |
| `terminalFirst.floating.foreground` | `quickInput.foreground` | Same as above |
| `terminalFirst.floating.border` | `widget.border`, then `panel.border` (HC: `contrastBorder`) | Same as above, plus the file browser preview |
| `terminalFirst.marker.foreground` | `list.highlightForeground` | File browser prompt and marked rows |
| `terminalFirst.tile.border` | `editorGroup.border` (HC: `contrastBorder`) | Tile cards |
| `terminalFirst.tile.activeBorder` | `focusBorder` (HC: `contrastActiveBorder`) | Active tile when more than one is open |
| `terminalFirst.tile.hoverBorder` | `focusBorder` at 40% (HC: `contrastActiveBorder`) | Inactive tile under a resting pointer; halo of the active tile |
| `terminalFirst.tile.gutterBackground` | `sideBar.background` | Gutter between tiles and view tiles |
| `terminalFirst.copyMode.badgeBackground` | `badge.background` | Copy mode badge |
| `terminalFirst.copyMode.badgeForeground` | `badge.foreground` | Copy mode badge |
| `terminalFirst.copyMode.cursorBorder` | `terminalCursor.foreground`, then `terminal.foreground` | Copy mode cursor |

Example user override, globally and for one theme:

```jsonc
"workbench.colorCustomizations": {
	"terminalFirst.floating.border": "#3b4252",
	"[Default Dark Modern]": {
		"terminalFirst.sessionTab.activeBorder": "#0078d4"
	}
}
```

Icons are registered (`terminal-first-session-shell`, `-editor`, `-dirty`, `-close`, `-new`, `-notifications`, `terminal-first-file-browser-prompt`, `-marked`) so product icon themes can replace them. VS NOSH Dark/Light set every `terminalFirst.*` color explicitly and serve as the reference theme. Terminal padding stays configurable through `terminalFirst.terminal.padding`.
