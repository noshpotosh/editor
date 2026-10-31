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

Shell toasts are suppressed except URGENT notifications; retained notifications are accessible through the title-bar count. Startup trust prompting defaults to never, and editor entry requests trust when needed. The shell itself starts in untrusted folders (`terminal.integrated.allowInUntrustedWorkspace` defaults to true), because a terminal that will not open a prompt until a dialog is answered is not a terminal; shells that execute code from the current directory on startup (direnv-style hooks) remain the user's choice. Recommendations, release notes, updates, tips, experiments, and parent-folder Git discovery are disabled by default; Git discovery is limited to subfolders. User settings still override defaults.

`scripts/terminal-first-app.sh [--build|--build-only] [--no-build-check] [args]` builds `vscode-darwin-arm64-min` when needed and starts the packaged Electron binary without VSCODE_DEV. The build stamp (`.build/terminal-first/packaged-build-complete`) records the commit the app was built from, with `-dirty` when the tree had changes; a launch whose sources differ rebuilds unless `--no-build-check` is passed. All launchers share `.build/terminal-first` isolation. Dev prelaunch is skipped only when `.build/electron` and `out` exist; this does not rebuild stale output.

### Measurement record

The first instrumented development-window load measured 4,470 ms from renderer navigation to session initialization, then 590 ms entering the managed workspace, 14 ms creating/restoring the shell, and 77 ms presenting it. CLI readiness followed presentation by 280 ms. These are single-run diagnostic observations, not an unchanged-code baseline or a packaged benchmark. They motivated translating folder launches before window loading. Marks: `start`, `restored`, `workspace`, `connected`, `created`, `presented`, `extensions`, and `cli`, all under `code/terminalFirst/`.

The target remains shell input within 500 ms on warm packaged launches. Do not treat CDP readiness or the session-controller interval as whole-app startup. Packaged acceptance and before/after measurements must include process startup and an actual input round trip. Extension trimming remains measurement-driven; no arbitrary disable list is shipped.


### Startup performance (2026-10-30)

Workstream F in `IMP_PLAN.md`. Requirements:

- **S7.20** The fork marks `code/terminalFirst/prompt` when the startup session's terminal emits its first data or already has rendered output. Attachment alone does not establish that a prompt was replayed. Only when `--prof-duration-markers` names a pair ending in `code/terminalFirst/input`, the harness sends a `printf` command with an encoded unique token and marks `input` when the decoded response arrives. Command echo and unrelated startup or replay output cannot satisfy the probe. Marks are published to the timer service under the source `terminalFirst` after `presented`, `prompt`, and `input`, so upstream `--prof-duration-markers` resolves them even though the renderer snapshot is taken earlier.
- **S7.21** When `--prof-duration-markers-file` is set, the fork writes `<file>.terminalFirst.json` with `{ reconnected, inputRequested, didUseCachedData, marks, contributions }` where `marks` are epoch milliseconds for the fork's marks and the upstream terminal, window, and contribution marks. Serialized reports update the file and log `[terminalFirst-perf]` as readiness milestones arrive; `didUseCachedData` is upstream's estimate rather than a measured V8 hit rate.
- **S7.22** **Developer: Terminal First Startup Marks** opens a Markdown table of those marks relative to `code/didStartMain` and the 20 slowest workbench contribution constructors.
- **S7.23** `scripts/terminal-first-perf.sh` runs the packaged app N times (warm by default, `--cold` purges the file cache) against a `stock` profile (fork defaults only) or an `owner` profile (a copy of the isolated profile's settings and extensions), records the launch epoch per run, and `scripts/terminal-first-perf.mjs` aggregates medians and p90s for main→presented/prompt/input, launch→presented/prompt/input, prompt−presented, upstream `ellapsed`, and quit (`--quit`), printing a Markdown table and appending `.build/terminal-first/perf/history.tsv`. It fails when an expected mark never fired in two or more runs.
- **S7.24** `product.json` sets `quality: "stable"` so packaged builds generate the Node compile cache; shells see `VSCODE_STABLE=1` and `terminal.integrated.shellIntegration.environmentReporting` defaults off.
- **S7.25** Target: median launch→input under 500 ms on a warm packaged launch of the stock profile.
- **S7.26** The session controller starts at `BlockRestore` and waits only for the editor part to be ready (`IEditorGroupsService.whenReady`), not for the full layout restore. The `code/terminalFirst/restored` mark therefore means "layout ready".
- **S7.27** Stored sessions appear on the title bar before any shell exists, with their stored titles and modes. The title bar is never hidden by the starting state; only the other parts are.
- **S7.28** The controller waits for the terminal service to reach `Connected` (every persisted terminal has an instance again, replay may still be running), bounded by 1.5 s; after that it starts the active session's shell. A persisted terminal that reconnects later is bound to its session by nonce, and an unclaimed reconnected panel shell becomes a session of its own.
- **S7.29** The pty host connection does not wait for the `Restored` lifecycle phase in VS NOSH, because the main process warms the pty host with the first window.
- **S7.30** Hidden session and space layouts materialize only after the first surface is presented (`terminalFirstStartup.whenPresented()`), so their editor restore never competes with the first prompt. Retained spaces are still listed, saved, and included in shutdown.
- **S7.31** The macOS login-shell environment probe (`$SHELL -i -l -c`, up to 10 s) never gates a VS NOSH shell: profile detection in the main process uses the process environment, process creation passes an empty executable environment, the variable resolver does not merge the probed environment, and `terminal.integrated.inheritEnv` defaults to false. The probe still runs for the extension host, tasks, and debugging. Consequences: the shell inherits the launcher's environment and rebuilds its own as the login shell it is; `${env:NAME}` in `terminal.integrated.env.osx` and in profile arguments resolves against the app's environment; a user profile whose `path` is a bare command name must become an absolute path.
- **S7.32** `deferStartupContribution` (`src/vs/platform/terminalFirst/common/startupPhaseOverrides.ts`) moves a fixed list of upstream BlockRestore contributions to AfterRestored in VS NOSH. The list holds only self-contained contributions selected from measured constructor timings; a test pins every id to its class. Outside VS NOSH the seam is the identity.
- **S7.33** The extension host starts when the first surface is presented, or at the latest two seconds after the workbench restored (`terminalFirst.startup.deferExtensionHost`, default true). `e` therefore waits up to ten seconds for the window's CLI pointer and prints a hint after two seconds.
- **S7.34** Native Vim is enabled as soon as the service is constructed; the VSCodeVim hand-over check (disable the extension when the native engine is chosen, or the reverse) runs after presentation. The session strip rebuilds at most once per tick.
- **S7.35** Defaults: `terminal.integrated.persistentSessionReviveProcess: never` (quit never persists buffers; relaunch gives every restored session a fresh shell; Reload Window still reattaches live shells), `terminal.integrated.environmentChangesRelaunch: false` (the first shell is never respawned because an extension published an environment collection after it started), `terminal.integrated.shellIntegration.environmentReporting: false`.
- **S7.36** The VS NOSH launcher builds with `VSCODE_SKIP_COPILOT=1`: the packaged app has no Copilot extension and no auto-updated built-in. `product.json` retains upstream's required `defaultChatAgent` metadata: onboarding and account services assume it exists even when chat is disabled. Removing the metadata prevents the workbench from loading; retaining it does not bundle the extension.
- **S7.37** Quit waits at most one second for extension deactivation and 1.5 seconds for extension host exit in VS NOSH.
- **S7.38** `e` with plain file or directory arguments (optionally after `--wait`) sends the request to the window's CLI socket with `curl` and starts no Node process; options, `--goto`, and names outside `A-Za-z0-9/._~@+-` go through `cli.cjs` as before. The extension removes its pointer on deactivation and sweeps pointers whose socket is gone.
- **S7.39** The fork starts loading xterm when its BlockRestore contribution is created and prepares the panel before creating a fresh profile's first session. The measured Codex status and chat pet context contributions join the deferred list; content providers, notebook working-copy handlers, and chat URL setup remain in their original phases.
- **S7.40** On an initial local window with one folder, main speculatively starts the session shell in the warmed pty host while the workbench loads. It uses the same environment builder and backend environment as ordinary `inheritEnv: false` shells, a shared CLI pointer/PATH helper, and one nonce for shell integration and `TERMINAL_FIRST_SESSION`. The shell starts persistent and detached, with a layout the existing reconnect path can claim.
- **S7.41** Speculation never adds a wait for profile detection or process startup to the renderer's initial layout request. If the fully started shell has not begun publishing its layout, the renderer cancels it and starts normally; late work is shut down. Initial layout reads always pass through main coordination even after the direct pty channel connects. Reloads, workspace switches, empty/remote/multi-root windows, workspace terminal overrides, dynamic configuration, custom cwd, and unsupported profile/settings combinations use the ordinary path.
- **S7.42** The renderer adopts a speculative shell into the saved active session, preserving tab order, IDs, spaces, and layouts. A differing saved working directory wins: the unused process is explicitly terminated and a normal shell starts there. Adoption closes before awaiting fallback creation, so late arrivals cannot create extra sessions. The temporary reconnection-owner marker is removed on adoption to retain ordinary shell persistence independently of task settings.
- **S7.43** In VS NOSH, `Connected` waits for recreated terminal instances but not their output replay. Existing attachments can create an instance before profile discovery finishes. With revival set to `never`, the backend discards old persisted buffer/layout records from earlier builds while retaining the pty host's live layout for Reload Window.
- **S7.44** Automatic nonterminal pane restoration is suppressed while the fork is starting or showing a shell, so restoring Explorer cannot queue editor entry behind shell initialization. Explicit file launches and deliberate editor entry continue to open editor content.

Results (medians, p90 in parentheses; one row per landed step). Upstream `ellapsed` (main start to `code/didStartWorkbench`) grows from F1 on because the hidden session layouts, whose restore completes the workbench's own restore, now wait for the shell to be presented; it is reported for comparison with upstream, not as a target.

F2 changed nothing measurable on this machine (the login shell here finishes well before the first spawn); it removes the 10 s worst case rather than median time. The F2 timeline shows the pty host connection still 130 ms after the terminal instance exists, which is xterm's lazy import, the container barrier, and process setup, and the prompt 195 ms after the connection, which is the shell's own startup. Those two gaps are F3.2 and F7.

| Build | Profile | Mode | launch→presented | launch→prompt | launch→input | prompt−presented | `ellapsed` | quit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F0 baseline `f702d86cacc` | stock | warm | 1317 (1342) | 1488 (1512) | 1494 (1517) | 171 (177) | 748 (755) | 221 (237) |
| F0 baseline `f702d86cacc` | owner | warm | 1421 (1442) | 1607 (1623) | 1615 (1627) | 184 (186) | 752 (755) | |
| F3.1 + F1 `ef7f9dcb5e0` | stock | warm | 1112 (1129) | 1317 (1386) | 1323 (1403) | 207 (284) | 966 (985) | 234 (244) |
| F3.1 + F1 `ef7f9dcb5e0` | owner | warm | 1152 (1212) | 1365 (1404) | 1374 (1409) | 192 (219) | 996 (1038) | |
| F2 `b53e117c3a5` | stock | warm | 1159 (1325) | 1394 (1609) | 1412 (1614) | 244 (339) | 1009 (1128) | |
| F2 `b53e117c3a5` | owner | warm | 1181 (1288) | 1394 (1509) | 1408 (1516) | 212 (303) | 1018 (1121) | |
| F4–F6 corrected `306af882f47` | stock | warm | 1123 (1158) | 1322 (1341) | 1671 (1705) | 191 (220) | 965 (986) | 188 (222) |
| F4–F6 corrected `306af882f47` | owner | warm | 1013 (1080) | 1209 (1242) | 1546 (1558) | 196 (223) | 880 (909) |  |
| F3.2 + contribution list `d38d8362725` | stock | warm | 1128 (1230) | 1337 (1395) | 1660 (1711) | 209 (214) | 974 (1027) | 191 (242) |
| F3.2 + contribution list `d38d8362725` | owner | warm | 1139 (1201) | 1346 (1383) | 1695 (1716) | 203 (210) | 981 (1013) | |
| F7 corrected `2d735dff9e3` | stock | warm | 1135 (1180) | 1224 (1263) | 1365 (1392) | 88 (90) | 971 (1000) | 192 (197) |
| F7 corrected `2d735dff9e3` | owner | warm | 1135 (1250) | 1222 (1305) | 1372 (1450) | 83 (91) | 975 (1062) | |
| F7 final + restoration guard `c4dd2dea51d` | stock | warm | 1021 (1036) | 1102 (1118) | 1239 (1320) | 81 (82) | 866 (884) | 194 (215) |
| F7 final + restoration guard `c4dd2dea51d` | owner | warm | 1027 (1072) | 1109 (1156) | 1245 (1288) | 82 (84) | 885 (931) | |

The 2026-10-31 rows use a short encoded command response with bracketed paste. Older input rows accepted arbitrary output after a newline and can understate actual readiness; their input values are not directly comparable. An initial long encoded probe measured stock/owner input at 1840/1864 ms and was discarded as a comparison baseline because unbracketed input exercises zsh editing hooks. First-output medians in that run were 1327/1318 ms. Quit now targets the measured PID and starts its clock immediately before requesting termination, excluding automation startup.

### Verification result

The packaged Apple Silicon build now succeeds with Copilot excluded, including Node compile-cache generation. Removing the required `defaultChatAgent` product metadata had crashed upstream onboarding; the real metadata remains, while `builtInExtensionsEnabledWithAutoUpdates` is empty and the Copilot extension is not packaged. Client typechecking, targeted lint, layer validation, the focused Electron suites, and all 18 CLI/performance harness tests pass. The reconnect fixture was corrected and its two regressions rerun successfully after the combined suite exposed its missing terminal-service registration. The upstream patch manifest covers all modified upstream files, including the two pre-existing tiles/space hooks.

F3.2 is neutral on the stock profile within the approximately 40 ms noise budget. The owner row is slower, but approximately 100 ms of its difference occurs before the workbench bundle starts loading, before the changed controller runs. Renderer `CachedData` is populated and upstream reports `didUseCachedData`; that flag is an estimate based on the startup commit, not a measured V8 cache-hit rate. The main-process initialization wait is only approximately 10–17 ms and loads backup/workspace state required for window restoration, so it was retained. No WebGL pre-import or double-profile-resolution rewrite was justified by these measurements.

Packaged lifecycle checks on `2d735dff9e3` preserved both session-shell PIDs/nonces and the floating-shell PID/nonce on Reload Window, with scrollback visible. Normal quit during `sleep 100` completed in 208 ms without a dialog; the process tree exited. Relaunch preserved session order and README/Source Control tiles with fresh PIDs/nonces for all three shells. `e README.md` and `e --wait` passed, including completion only after closing the requested editor. Empty-window shell startup, pty-host crash recovery, and custom-cwd fallback passed. A normal zsh login shell matched PATH exactly after excluding the added VS NOSH CLI directory, and both resolved git to `/usr/bin/git`; direct Terminal.app comparison was blocked by macOS Automation permission (`-1743`).

The live smoke exposed an additional startup race: automatic Explorer restoration could queue editor entry while the policy was `starting`. The pane-composite guard now suppresses nonterminal restoration during startup as well as shell mode; a regression exercises the actual pane entry point and session transition queue, and explicit-file startup remains in editor mode. Final trusted startup remains in shell mode with no dialog and enters the editor only after the explicit CLI command. All ten final stock/owner runs adopted prespawn, executed the input probe, and began extension loading after shell presentation. The final untrusted launch also stays in shell without a modal and requests trust only on deliberate editor entry. A `.code-workspace` terminal environment override correctly skips prespawn and retains its value on the ordinary shell path. A separate folder-level override exposed an existing managed-workspace conversion that drops the folder setting; that pre-F7 migration limitation remains outside this startup work.

Cold measurements were attempted on 2026-10-31 but could not run because passwordless `sudo` for `purge` is unavailable. No cache was purged and no cold results are claimed. F7 reduces stock median input readiness by 295 ms (17.8%) against F3.2; all five runs report `reconnected: true` and `code/terminalFirst/prespawnAdopted`. The final stock median is 1239 ms, leaving a 739 ms gap to the 500 ms target. The final batch is 126 ms faster than the earlier F7 batch, but approximately 90 ms of that difference occurs before workbench startup; it is not attributed to the small restoration guard. Fullscreen drag/zoom, VSCodeVim integration, and the full light/high-contrast acceptance matrix remain broader release checks outside Workstream F.

Theme follow-up: the default remains upstream Dark Modern, with VS NOSH Dark/Light opt-in. The local isolated profile was reset from One Dark Pro Flat and its color overrides (a backup was retained). Dark Modern and VS NOSH Light were visually checked; the title-bar and saved splash fallback now use the terminal’s panel background when a theme does not specify terminal.background.

## Theming and customization

Every Terminal First surface is styled from design tokens (spacing, corner radius, type, and stroke ramps) and from registered `terminalFirst.*` theme colors. Each color defaults to an existing workbench color, so any VS Code theme renders these surfaces coherently without knowing about them. Themes and `workbench.colorCustomizations` can override them individually, and they appear in settings IntelliSense. Floating surfaces follow the command palette (`quickInput.*`) so they match how a theme already styles pickers. High contrast themes resolve borders to `contrastBorder` / `contrastActiveBorder`.

| Color | Default | Surface |
|---|---|---|
| `terminalFirst.sessionStrip.background` | `terminal.background`, then `panel.background` | Title bar while the shell is shown |
| `terminalFirst.sessionTab.activeBackground` | `commandCenter.activeBackground` | Active session tab |
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
| `terminalFirst.tile.hoverBorder` | opaque midpoint of `terminalFirst.tile.activeBorder` and `terminalFirst.tile.border` (HC: `contrastActiveBorder`) | Tile under a resting pointer unless it carries the active border |
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
