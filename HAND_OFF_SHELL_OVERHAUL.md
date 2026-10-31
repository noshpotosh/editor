# Shell startup and quit performance: completion record (Workstream F)

> Updated 2026-10-31 on branch `terminal-first`, through `c4dd2dea51d`. F0–F7 and the packaged lifecycle checks are implemented and validated. The final package measured 1239 ms stock launch→input, 1245 ms owner launch→input and 194 ms quit; the under-500 ms input target remains unmet. The final package includes the startup view-restoration guard and has built successfully. Final performance reruns, fresh trusted/untrusted launches and workspace-file override checks passed. Cold-cache timing and direct Terminal.app comparison remain unavailable for the host-permission reasons recorded below. Read Workstream F in `IMP_PLAN.md` and Startup performance in `docs/specs/07-workbench-branding-distribution.md` for the design and requirements.

## Owner decisions retained

The owner uses VS NOSH as the everyday terminal: launch, run a command, quit. The target is median launch→input under 500 ms on a warm packaged stock-profile launch, measured from process start through an executed command response. Decisions already made: fresh shells after Cmd+Q (`persistentSessionReviveProcess: never`), Copilot excluded from the package, the login-shell environment probe never gates the shell, and the extension host starts after presentation with a two-second fallback after `Restored`. These decisions do not need confirmation again.

`product.json` retains upstream's required `defaultChatAgent` metadata and an empty `builtInExtensionsEnabledWithAutoUpdates` array. Removing the metadata caused a module-scope onboarding assertion to abort the workbench; omitting the array broke extension scanning. Keeping those required values does not bundle Copilot or configure automatic installation. The launcher builds with `VSCODE_SKIP_COPILOT=1`.

## Completed implementation

| Commit | Step | Result |
| --- | --- | --- |
| `1874092efb7`, `58afc904a81`, `c163428a476`, `f702d86cacc` | F0 | Prompt/input marks, marks command and JSON dumps, packaged perf harness, launcher build stamp, `quality: stable`, and compile-cache validator support for Node's UID suffix |
| `b4c3828969a` | F0.5 | Shell permitted in an untrusted folder; entering the editor still follows workspace trust |
| `65e3cc46110` | F3.1 | Direct pty connection no longer waits for `Restored` |
| `ef7f9dcb5e0` | F1 | Controller at `BlockRestore`, editor-part readiness instead of complete layout restoration, bounded reconnect wait, visible title bar, hidden layouts deferred until presentation |
| `b53e117c3a5` | F2 | Login-shell probe removed from profile detection, process creation and variable-resolution dependencies; `inheritEnv: false` |
| `a6dda647780` | F4–F6 | Contribution/extension-host deferral, immediate native Vim, coalesced strip renders, fresh-shell defaults, Copilot packaging exclusion, shorter quit waits and the `e` curl path |
| `87b7cd66ea7` | F4–F6 validation fixes | Restored required product metadata, corrected input/quit measurement, added upstream startup diagnostics, and documented the pre-existing upstream edits |
| `306af882f47` | Input probe | Short unique encoded `printf` response with bracketed paste; command echo and unrelated output cannot satisfy readiness |
| `d38d8362725` | F3.2 and measured F4 list | Preload core xterm at `BlockRestore`, show the panel before creating the first fresh session, defer Codex status and chat pet context contributions |
| `b7f7657299e` | F7 | Speculative main-process shell startup, coordinated adoption and fallback, shared environment construction, live-reload preservation and race regressions |
| `2d735dff9e3` | F7 packaged correction | Deep-clone frozen profile defaults before upstream profile detection mutates them; regression covered and prespawn adoption verified in stock and owner runs |
| `c4dd2dea51d` | Startup restoration correction | Prevent automatic nonterminal view restoration from replacing the shell while the policy is `starting`; actual pane-entry/session-queue regression and explicit-file startup covered |

### F3.2 and contribution deferral

`TerminalFirstContribution` starts `TerminalInstance.getXtermConstructor` during `BlockRestore`. The controller prepares the panel before creating even an empty profile's first session; previously the fresh-session branch created the terminal before `showPanel`. WebGL preload and broader profile-resolution changes were not justified by measurement.

The deferred contribution IDs are `workbench.contrib.agentHostChatDebug`, `workbench.contrib.codexStatusBarEntry`, and `workbench.contrib.chatPetContext`. The two additions each measured 1 ms in the first three corrected baseline dumps; they are small safe deferrals, not a claim of a large performance gain. Tests pin every ID to its exported class. Content providers, notebook working-copy handlers, editor resolvers, extension-point handlers and chat URL setup keep their original phases.

### F7 ownership and fallback

`platform/terminalFirst/electron-main/terminalFirstShellPrespawn.ts` listens for initial local windows and prepares a shell while the workbench loads. It reuses the ordinary backend environment and terminal environment builder, plus a shared CLI PATH/pointer helper. Main generates the nonce used by both shell integration and `TERMINAL_FIRST_SESSION`, then calls `createProcess` → `start` → `detachFromProcess(id, true)` → `setTerminalLayoutInfo`.

The renderer's first layout read always passes through the main coordinator, even if the direct pty channel is already connected. If publication has not begun, the renderer cancels speculation and uses normal creation without waiting for profile detection or shell startup. Late unpublished processes are terminated. If publication is underway, the read waits only for that layout write.

The renderer prefers the saved active session, preserving session IDs, order, spaces and layouts. A differing saved cwd wins over speculation. Rejected processes are explicitly shut down even when xterm has not attached. Creation-event adoption runs in a microtask so terminal groups have installed their disposal listeners; the post-connection sweep stays synchronous. Adoption closes before awaiting fallback creation, preventing duplicate sessions. The temporary owner marker is removed so ordinary shell persistence does not depend on task reconnection settings.

`Connected` now guarantees that restored terminal instances exist in the fork, without waiting for output replay. Attachments can create their instance before profile discovery finishes. With revival set to `never`, `LocalTerminalBackend` discards its old disk buffer/layout records while retaining the pty host's live layout for Reload Window.

The ordinary path remains responsible for reloads, workspace switches, empty/remote/multiple-root windows, workspace terminal overrides, custom cwd, dynamic settings, profile env/name overrides and other unsupported settings. The product gate already restricts these fork behaviors to native macOS.

## Measurement record

Every row below is a five-run median in milliseconds. Full p90s, per-run marks and contribution timings are in the listed summaries and spec 07. The `prompt` mark means first terminal output or already-rendered replay, not semantic recognition of a shell prompt. The `input` mark requires the shell to execute the probe command.

### Current short-response probe

| Build | Profile | launch→presented | launch→prompt | launch→input | prompt−presented | quit |
| --- | --- | --- | --- | --- | --- | --- |
| F4–F6 corrected `306af882f47` | stock | 1123 | 1322 | 1671 | 191 | 188 |
| F4–F6 corrected `306af882f47` | owner | 1013 | 1209 | 1546 | 196 | |
| F3.2 + measured F4 IDs `d38d8362725` | stock | 1128 | 1337 | 1660 | 209 | 191 |
| F3.2 + measured F4 IDs `d38d8362725` | owner | 1139 | 1346 | 1695 | 203 | |
| F7 corrected `2d735dff9e3` | stock | 1135 | 1224 | 1365 | 88 | 192 |
| F7 corrected `2d735dff9e3` | owner | 1135 | 1222 | 1372 | 83 | |
| Final restoration guard `c4dd2dea51d` | stock | 1021 | 1102 | 1239 | 81 | 194 |
| Final restoration guard `c4dd2dea51d` | owner | 1027 | 1109 | 1245 | 82 | |

F3.2's stock change is within the observed noise; the owner row was 149 ms slower at input. These rows do not establish an isolated gain for xterm preload or the two tiny contribution deferrals. F7's decision rule remained satisfied: first output lagged presentation by more than 150 ms.

Corrected F7 reduced stock input readiness by 295 ms (17.8%) against F3.2 and owner input by 323 ms. Every measured corrected stock run reports `reconnected: true` and `code/terminalFirst/prespawnAdopted`. The first `b7f7657299e` batch fell back because profile detection tried to mutate frozen configuration; it is not evidence of prespawn performance. `2d735dff9e3` fixed that defect before the successful measurements above.

Completed comparison artifacts:

- Corrected F4–F6 stock: `.build/terminal-first/perf/20261031T123557-stock-warm/summary.json`.
- Corrected F4–F6 owner: `.build/terminal-first/perf/20261031T123807-owner-warm/summary.json`.
- Corrected F4–F6 quit: `.build/terminal-first/perf/20261031T123225-stock-warm-quit/summary.json`.
- F3.2 stock: `.build/terminal-first/perf/20261031T124451-stock-warm/summary.json`.
- F3.2 owner: `.build/terminal-first/perf/20261031T124702-owner-warm/summary.json`.
- F3.2 quit: `.build/terminal-first/perf/20261031T124909-stock-warm-quit/summary.json`.
- F7 corrected stock: `.build/terminal-first/perf/20261031T130653-stock-warm/summary.json`.
- F7 corrected owner: `.build/terminal-first/perf/20261031T130910-owner-warm/summary.json`.
- F7 corrected quit: `.build/terminal-first/perf/20261031T131125-stock-warm-quit/summary.json`.
- Final stock: `.build/terminal-first/perf/20261031T132204-stock-warm/summary.json`.
- Final owner: `.build/terminal-first/perf/20261031T132433-owner-warm/summary.json`.
- Final quit: `.build/terminal-first/perf/20261031T132702-stock-warm-quit/summary.json`.

All ten final startup runs adopted prespawn, executed the unique input probe and started extension loading after shell presentation. Final stock input p90 was 1320 ms, owner p90 1288 ms, quit p90 215 ms. The extra 126 ms stock improvement over the earlier F7 batch includes approximately 90 ms before workbench startup; it is run-to-run variation, not attributed to the small restoration guard.

### Historical measurements

| Build | Profile | launch→presented | launch→prompt | launch→input | prompt−presented | quit |
| --- | --- | --- | --- | --- | --- | --- |
| F0 `f702d86cacc` | stock | 1317 | 1488 | 1494 | 171 | 221 |
| F3.1 + F1 `ef7f9dcb5e0` | stock | 1112 | 1317 | 1323 | 207 | 234 |
| F2 `b53e117c3a5` | stock | 1159 | 1394 | 1412 | 244 | |

These older input rows accepted arbitrary output after a newline and can understate actual readiness. They are not directly comparable with the current executed-response probe. The first corrected long, unbracketed probe also exercised zsh editing hooks and was superseded by `306af882f47`; its stock/owner input medians of 1840/1864 ms are diagnostic only. Quit timing now targets the measured PID and starts immediately before requesting termination, excluding automation startup.

## Verification and packaged smoke

- The final packaged build of `c4dd2dea51d` passed, including 547 generated Node compile-cache entries. Build log: `.build/terminal-first/validation/vs-nosh-final-build.log`.
- The frozen-profile correction passed 19 focused tests, full client typechecking and targeted lint. The subsequent startup-restoration guard passed the 90-test selected Electron run. Layer validation passed during F7 integration (`.build/terminal-first/validation/vs-nosh-f7-layers.log`), and all 18 CLI/performance harness tests passed.
- An earlier combined Electron run exposed an incomplete reconnect fixture. Registering its real `ITerminalService` fixed the deferred style-service error; the focused rerun passed both regressions plus the harness check without disposable leaks. `.build/terminal-first/validation/vs-nosh-f7-all-tests.log` is that earlier failing run, not the successful final validation.
- `scripts/upstream-check.sh` passes: 71 documented patches, 79 changed upstream files, zero warnings. The earlier `gridview.ts` and `editorCommands.ts` manifest gaps are resolved.

Core lifecycle smoke was observed on `2d735dff9e3`; final trusted startup on `c4dd2dea51d` stays in shell mode with no dialog and enters the editor only after `e README.md`. Evidence is in `.build/terminal-first/smoke/core-smoke-2d735dff9e3.json`, `final-trusted.json`, `alternate-smoke-2d735dff9e3.json` and the screenshots alongside them. Temporary test profiles and scripts are removed after validation.

| Check | Result |
| --- | --- |
| Fresh stock and owner launches: exactly one session shell; actual input probe succeeds | Passed; corrected five-run batches complete |
| Renderer reports `reconnected: true` and `prespawnAdopted`; fallback remains usable | Passed; successful adoption plus empty-window/custom-cwd ordinary creation |
| Reload Window preserves the live shell PID and nonce | Passed for both session shells and the floating shell; scrollback remained visible |
| Quit with two sessions, relaunch: tabs/layouts restored with fresh shell PIDs | Passed; session order and README/Source Control tiles restored; all three PIDs/nonces changed |
| Initial `PATH` and `which git` agree with the intended login-shell environment | Passed against `/bin/zsh -ilc`, excluding the added VS NOSH CLI directory; both resolve `/usr/bin/git`. Direct Terminal.app comparison was blocked by macOS Automation (`-1743`) |
| `e README.md` and `e --wait` reach the owning editor | Passed; both status files contain `0`; `--wait` completed only after the requested editor closed |
| Source Control tile shows repository changes | Passed |
| Cmd+Q with `sleep 100` running exits without a dialog or surviving child | Passed in 208 ms; process tree exited |
| Empty-window launch, pty-host crash recovery and custom-cwd fallback | Passed; crash replacement executed a command and retained one session |
| Untrusted folder stays in shell until editor entry | Passed on final build: no startup modal, command executes; deliberate editor entry shows the trust prompt, which was not accepted |
| Workspace-file terminal override uses ordinary creation | Passed on final build: no prespawn adoption, one shell, correct cwd and configured `NOSH_ALT_OVERRIDE=workspace-value` |

The untrusted-folder smoke found automatic Explorer restoration queuing editor entry during `starting`; `c4dd2dea51d` fixes that race. The initial folder-level environment-override check correctly rejected prespawn, but the existing managed-workspace conversion dropped the folder setting before ordinary terminal creation. That is a pre-F7 migration limitation, not a passed environment-fidelity check. The separate final `.code-workspace` override case preserves the environment setting correctly. Both final alternate checks are recorded in `.build/terminal-first/smoke/alternate-smoke-c4dd2dea51d.json`; the corrected untrusted launch stays in shell until deliberate editor entry.

## Remaining performance work and limits

The final stock input median is 1239 ms, 739 ms above the 500 ms threshold. The planned implementation and validation work improves startup but does not achieve that target. The controlled F7 comparison reduced stock input by 295 ms; final measurements retain the gain. Further progress needs work on the earlier process/window/renderer path, beyond the completed F steps.

The earlier F2 timeline spent about 630 ms before the workbench started, across main startup, window/preload and renderer bundle loading. New marks show the main service-initialization wait itself is only about 10–17 ms and loads backup/workspace state needed for restoration, so it remains. Both examined profiles had renderer cache files, but upstream `didUseCachedData` only estimates cache use from the commit/configuration; it does not prove a V8 cache hit. No speculative cache rewrite was made. The apparent second default-profile resolution does not repeat full profile discovery and did not justify another upstream change.

A three-run cold-cache measurement was attempted but exited with status 1 immediately because passwordless sudo for `purge` is unavailable on this host. No purge occurred and no cold measurements were taken; this check did not pass. The owner profile is a copied test profile, not a modification to the everyday profile.

## Reproduce measurements and checks

Run on a quiet machine. Do not compile, typecheck, run tests or drive another app during perf runs. Do not edit source during packaging. Keep stock and owner profiles separate and compare the same probe version.

```sh
./scripts/terminal-first-app.sh --build-only
./scripts/terminal-first-perf.sh --runs 5 --profile stock --reset-profile --baseline .build/terminal-first/perf/20261031T124451-stock-warm/summary.json --label "F7 stock warm"
./scripts/terminal-first-perf.sh --runs 5 --profile owner --reset-profile --baseline .build/terminal-first/perf/20261031T124702-owner-warm/summary.json --label "F7 owner warm"
./scripts/terminal-first-perf.sh --runs 5 --profile stock --quit --label "F7 stock quit"
./scripts/test.sh --run vs/platform/terminalFirst/test/common/terminalFirstPrespawn.test --run vs/platform/terminalFirst/test/electron-main/terminalFirstShellPrespawn.test --run vs/workbench/contrib/terminalFirst/test/browser/terminalReconnectStartup.test --run vs/workbench/contrib/terminalFirst/test/browser/terminalFirstService.test --run vs/workbench/contrib/terminalFirst/test/electron-browser/localTerminalPrespawn.test
node --test extensions/terminal-first/test/e.test.cjs extensions/terminal-first/test/cli.test.cjs scripts/terminal-first-perf.test.mjs
scripts/upstream-check.sh
```

Results are under `.build/terminal-first/perf/<timestamp>-<profile>-<mode>/`: `summary.md`, `summary.json`, and per-run `.terminalFirst.json` dumps. `history.tsv` records each aggregate. The marks command exposes the same renderer diagnostics. Run targeted lint, typechecking and layer validation when changes warrant them; reuse the completed checks when their inputs have not changed.

The launcher rebuilds when its source stamp differs; `--no-build-check` deliberately permits a stale app. Perf runs use the packaged app and warn about a stale stamp. The input-profiler run auto-exits after recording; quit mode leaves it alive until the harness requests termination. `terminalFirstStartup` is module state, so tests that call `begin()` must reset it in teardown.
