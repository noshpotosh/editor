# Hand-off: shell startup and quit performance (Workstream F)

> **For a cold agent.** This document is the state of Workstream F ("startup and quit performance") in the VS NOSH fork on 2026-10-30, written when the previous agent's usage was about to run out. Read `IMP_PLAN.md` ("How to work in this repo", then "Workstream F") and `docs/specs/07-workbench-branding-distribution.md` ("Startup performance") first. Everything below is verified against the tree unless marked *unverified*.

## Goal and owner decisions

The owner uses VS NOSH as the everyday terminal too: launch, run a command (often `claude`), quit. Target (spec 07, S7.25): median launch→input under 500 ms on a warm packaged launch of the stock profile, measured from process start through an input echo round trip. Decisions already made (do not re-ask): fresh shells after Cmd+Q (`persistentSessionReviveProcess: never`), Copilot dropped from the packaged build, the login-shell probe never gates the shell, the extension host starts after the shell is presented (bounded at 2 s after `Restored`).

## How to measure (do this before and after every change)

```sh
./scripts/terminal-first-app.sh --build-only        # ~4 min; stamps the commit; rebuilds when sources moved
./scripts/terminal-first-perf.sh --runs 5 --profile stock --reset-profile --baseline <previous summary.json> --label "<step> stock warm"
./scripts/terminal-first-perf.sh --runs 5 --profile owner --reset-profile --baseline <previous summary.json> --label "<step> owner warm"
./scripts/terminal-first-perf.sh --runs 5 --profile stock --quit --label "<step> stock quit"
```

Results land in `.build/terminal-first/perf/<timestamp>-<profile>-<mode>/` (`summary.md`, `summary.json`, per-run `run-N.tsv.terminalFirst.json` with every mark as epoch ms plus the 20 slowest contribution constructors) and a row is appended to `.build/terminal-first/perf/history.tsv`. Paste medians into the results table in spec 07. Run measurements on a quiet machine: do not compile, type-check, or run unit tests while they run (they use only the packaged app, so editing files is fine). The build reads the tree, so do not edit sources while a build runs. Inside the app, **Developer: Terminal First Startup Marks** shows the same data.

Latest summaries to use as baselines: `.build/terminal-first/perf/20261030T173231-stock-warm/summary.json` (F2 stock) and `.build/terminal-first/perf/20261030T173505-owner-warm/summary.json` (F2 owner).

## Numbers so far (medians, ms; stock profile, warm)

| Build | launch→presented | launch→prompt | launch→input | prompt−presented | quit |
| --- | --- | --- | --- | --- | --- |
| F0 baseline `f702d86cacc` | 1317 | 1488 | 1494 | 171 | 221 |
| F3.1 + F1 `ef7f9dcb5e0` | 1112 | 1317 | 1323 | 207 | 234 |
| F2 `b53e117c3a5` | 1159 | 1394 | 1412 | 244 | (not run) |

F2 is within noise of F1 on this machine; it removes a 10 s worst case rather than median time. Owner-profile rows are in spec 07.

Where the time goes (F2 run, ms after `code/didStartMain`; `didStartMain` itself is ~145 ms after process launch): 247 `willOpenNewWindow`, 395 `willLoadWorkbenchMain`, 627 `didLoadWorkbenchMain` (230 ms loading the workbench bundle), 658 `willStartWorkbench`, 783 `terminalFirst/start`, 831 `connected`, 871 `willLoadExtensions`, 908 `created`, 962 `presented`, 1013 `didLoadExtensions`, 1040 `terminal/willConnectPtyHost`, 1053 `didConnectPtyHost`, 1249 `prompt`, 1267 `input`. The two gaps worth attacking next are `created`→`willConnectPtyHost` (130 ms: xterm's lazy import, the container barrier, profile and process setup) and `didConnectPtyHost`→`prompt` (195 ms: pty spawn plus zsh startup, only hideable by pre-spawning, F7). Everything before 783 is upstream window and bundle load.

## What has landed (all on branch `terminal-first`)

| Commit | Step | What |
| --- | --- | --- |
| df173ab32a5 | checkpoint | The owner's uncommitted spaces/tiles WIP, committed so F steps are clean |
| 1874092efb7 | F0 | Marks `code/terminalFirst/prompt` and `input`, published to `ITimerService` under source `terminalFirst`; JSON dump beside `--prof-duration-markers-file`; **Developer: Terminal First Startup Marks**; `scripts/terminal-first-perf.sh` + `.mjs` (+ `.test.mjs`); launcher commit stamp, `--build-only`, `--no-build-check`; `product.json` `quality: "stable"` |
| 58afc904a81 | F0 | `build/lib/nodeCompileCache.ts` accepts the `-<uid>` suffix Node adds to portable cache tags (the build failed without it) |
| b4c3828969a | F0.5 | `terminal.integrated.allowInUntrustedWorkspace: true` default: a fresh profile never got a prompt because the first shell waited behind the modal trust dialog |
| c163428a476, f702d86cacc | F0 | Harness `set -e` fixes; dump written at `presented` too |
| 65e3cc46110 | F3.1 | `localTerminalBackend.ts`: no `Restored` wait before connecting to the (already warmed) pty host |
| ef7f9dcb5e0 | F1 | Controller at `BlockRestore`; waits for `editorGroupsService.whenReady`, the managed workspace, and `connectionState === Connected` (1.5 s budget) instead of `whenRestored` and every replay; stored sessions shown on the title bar before any shell; title bar never hidden by `terminal-first-starting`; late reconnects adopted by nonce (`adoptReconnected`); hidden layouts restore after `terminalFirstStartup.whenPresented()` (new seam `src/vs/workbench/services/terminalFirst/common/terminalFirstStartup.ts`) |
| b53e117c3a5 | F2 | Login-shell probe off the shell path: `ptyHostService.getProfiles` uses `process.env`, `localTerminalBackend.createProcess` passes `{}` as executable env, `terminalProcessManager` skips the shell-env merge; default `terminal.integrated.inheritEnv: false` |

## Committed as a6dda647780 but not yet built or measured (F4, F5, F6)

One commit for all three steps (the shared `terminalFirst.contribution.ts` made a clean per-step split impractical at the end of the session). They pass `npm run eslint`, `npm run typecheck-client`, `npm run valid-layers-check`, `node --test extensions/terminal-first/test/e.test.cjs extensions/terminal-first/test/cli.test.cjs`, and the unit suites listed under Verification below. **Your first job: build, measure, and revert whatever regresses.**

- **F4.1** `src/vs/platform/terminalFirst/common/startupPhaseOverrides.ts` (`deferStartupContribution`, identity outside VS NOSH) with a one-line call-out in `src/vs/workbench/common/contributions.ts` `registerWorkbenchContribution2`. The deferred list has one id so far (`workbench.contrib.agentHostChatDebug`, 28 ms in a renderer log). **Fill it from the `contributions` array in the perf dump** (slowest BlockRestore constructors; never defer BlockStartup content providers, editor resolvers, extension-point handlers, or the chat URL handlers). Test: `contrib/terminalFirst/test/browser/startupPhaseOverrides.test.ts` pins each id to its class's `ID`.
- **F4.2** `terminalFirstStartup.whenExtensionHostMayStart(whenRestored)` (race of `presented` and `Restored` + 2 s; immediate when the controller did not ask), one-line call-out in `src/vs/workbench/services/extensions/electron-browser/nativeExtensionService.ts`; setting `terminalFirst.startup.deferExtensionHost` (default true) read by `TerminalFirstService.initialize()` and passed to `terminalFirstStartup.begin()`.
- **F4.4** `nativeVim.ts`: native engine marked ready at construction; the VSCodeVim hand-over check runs after `whenPresented()` and is skipped once the service is disposed. The Vim test fixture now stubs `IContextKeyService.getContext` (the mock returns null, which the pickers hit as soon as Vim is enabled).
- **F4.5** `sessionStripPart.ts` coalesces renders per microtask (`scheduleRender`); test "a burst of session changes renders the strip once" in `sessionTabs.test.ts`.
- **F5** Defaults in `terminalFirst.contribution.ts`: `persistentSessionReviveProcess: never`, `environmentChangesRelaunch: false`, `shellIntegration.environmentReporting: false`. Build: `build/gulpfile.vscode.ts` skips the Copilot compile and ripgrep-shim tasks when `VSCODE_SKIP_COPILOT=1` (the launcher sets it); `product.json` lost `defaultChatAgent` and `builtInExtensionsEnabledWithAutoUpdates`; `build/lib/extensions.ts` is back to upstream (its only fork hunk re-added Copilot SDK files). *Unverified:* a packaged build with these changes has not been run yet; if `vscode-darwin-arm64-min` fails, check that nothing else in `build/` expects `extensions/copilot`.
- **F6** `extHostExtensionService.ts` deactivate race 1 s and `extensionHostStarter.ts` exit wait 1.5 s under the gate; `extensions/terminal-first/bin/e` sends plain file/directory requests with `curl --unix-socket` (no Node start), falls back to `cli.cjs` for options, `--goto`, and names outside `A-Za-z0-9/._~@+-`, waits up to 10 s for the pointer with a hint after 2 s; `extension.cjs` removes its pointer on deactivate and sweeps stale ones. Test `extensions/terminal-first/test/e.test.cjs`.
- Docs for all of the above are already written: spec 07 S7.32–S7.38, `CHANGELOG.md`, `TERMINAL_FIRST.md`. `build/fork/upstream-patches.json` has entries for every upstream file touched; run `scripts/upstream-check.sh` after committing.

Next: `./scripts/terminal-first-app.sh --build-only` (first build with `VSCODE_SKIP_COPILOT=1` actually honored; watch for anything in `build/` that still expects `extensions/copilot`), then the three measurement commands, then fill the F4 deferral list from the dump's `contributions` and measure again. **Revert any step whose stock-profile medians regress beyond noise (about ±40 ms on this machine).** Expected: F4.2 should move `willLoadExtensions` after `presented`; F5 should cut quit time and make the app ~395 MB smaller.

## What remains after that

1. **F3.2** Pre-import xterm (`TerminalInstance.getXtermConstructor(keybindingService, contextKeyService)`, public static) from `TerminalFirstContribution`'s constructor at `BlockRestore`, and optionally the webgl addon. Measure `created`→`willConnectPtyHost`. Also look at why `showPanel` before `ensureTerminal` did not remove the container barrier wait, and at the double default-profile resolution (`terminalInstance.ts` ctor and `resolveShellLaunchConfig`).
2. **F7 pre-spawn** (decision rule met: prompt−presented is 207–244 ms ≥ 150 ms). Design is in the approved plan (`/Users/nosh/.claude/plans/i-m-still-interested-in-shimmering-turing.md`, section F7) and summarized in `IMP_PLAN.md`: a fork-owned `src/vs/platform/terminalFirst/electron-main/terminalFirstShellPrespawn.ts`, instantiated from the gated block at `app.ts` ~line 1310, listens to `ILifecycleMainService.onWillLoadWindow`, spawns the session shell through the main-side `IPtyService` (`createProcess` → `start` → `detachFromProcess(id, true)` → `setTerminalLayoutInfo`) with `shouldPersist`, `workspaceId = workspace.id`, nonce generated in main and set in `options.shellIntegration.nonce` and `TERMINAL_FIRST_SESSION`; the renderer adopts it through upstream's reconnect path and `adoptReconnected`. Requires `persistentSessionReviveProcess: never` (F5). Move the pointer/PATH env formula from `terminalFirstService.shellEnvironment()` into a shared pure helper so main and renderer agree.
3. **Upstream startup** (not in the plan, found by measurement): ~630 ms pass before the workbench starts (main process 250 ms, window + preload 150 ms, workbench bundle load 230 ms). Check that the renderer V8 code cache is active (`Developer: Startup Performance` → `didUseCachedData`); consider what `app.ts` `initServices` awaits before `openFirstWindow`.
4. **Manual smoke list** (never run in the app during this session; the perf runs exercise only fresh folder launches): see "Verification" in `IMP_PLAN.md` Workstream F. In particular: Reload Window reattaches shells; quit with two sessions and relaunch restores tabs with fresh shells; `echo $PATH` and `which git` in the first shell match Terminal.app (F2 changed the base environment); `e README.md` from the first prompt; Cmd+Q with `sleep 100` running; an untrusted folder launch gets a prompt and entering the editor asks for trust.
5. Cold-start runs (`--cold` needs passwordless sudo for `purge`) were never taken.

## Open items from `scripts/upstream-check.sh`

The check reports two undocumented upstream edits that predate Workstream F and came in with the owner's checkpoint commit df173ab32a5: `src/vs/base/browser/ui/grid/gridview.ts` and `src/vs/workbench/browser/parts/editor/editorCommands.ts`. They belong to the tiles/spaces work, not to startup; add manifest entries for them (or move the changes into fork paths) when that work is finished. `docs/upstream/PATCHES.md` was regenerated at the end of this session.

## Gotchas learned the hard way

- `scripts/terminal-first-app.sh` rebuilds whenever the tree differs from the stamp (`-dirty` counts); pass `--no-build-check` to launch a stale app on purpose. The perf script only warns.
- The `--prof-duration-markers` launch exits the app ~15 s after the workbench is ready; the harness's `--quit` mode passes only `--prof-duration-markers-file` so the app stays open until `osascript` quits it.
- Upstream's timer service snapshots renderer marks once, early; the fork publishes its own marks under source `terminalFirst` after `presented`, `prompt`, and `input`, so always read fork marks from the dump or the marks command, not from `Developer: Startup Performance`.
- `terminalFirstStartup` is module state: tests that call `begin()` must `reset()` in teardown; `whenPresented()` resolves at once when nothing began.
- Browser-layer code must not reference `INativeEnvironmentService`/`NativeParsedArgs` (layer check); `startupTimings.ts` reads `args` through a structural type.
- `git stash pop` can collide with the perf script's `git status` at its start (`index.lock`); wait a few seconds after launching the harness.
- `zsh` treats a bare `=====` as a filename expansion; quote it in `echo`.

## Verification commands

```sh
./scripts/test.sh --run vs/workbench/contrib/terminalFirst/test/browser/terminalFirstService.test --run vs/workbench/contrib/terminalFirst/test/browser/startupTimings.test --run vs/workbench/contrib/terminalFirst/test/browser/editorPartSessions.test --run vs/workbench/contrib/terminalFirst/test/browser/sessionTabs.test --run vs/workbench/contrib/terminalFirst/test/browser/nativeVim.test --run vs/workbench/contrib/terminalFirst/test/browser/startupPhaseOverrides.test --run vs/workbench/services/terminalFirst/test/common/terminalFirstStartup.test --run vs/workbench/contrib/terminal/test/electron-browser/localTerminalBackend.test --run vs/workbench/contrib/terminal/test/browser/terminalProcessManager.test --run vs/workbench/test/browser/contributions.test
node --test extensions/terminal-first/test/e.test.cjs extensions/terminal-first/test/cli.test.cjs scripts/terminal-first-perf.test.mjs
npm run eslint -- <changed files> && npm run typecheck-client && npm run valid-layers-check && scripts/upstream-check.sh
```
