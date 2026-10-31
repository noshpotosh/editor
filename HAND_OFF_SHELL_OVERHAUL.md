# Shell startup and quit performance: completion record (Workstream F)

> Updated 2026-10-31 on branch `terminal-first`. The implementation through F7 is committed and the packaged build of `b7f7657299e` passed. Final F7 measurements and the packaged smoke checklist are **pending below**. Its first packaged run fell back because upstream profile detection mutated frozen configuration objects; a deep-clone fix and regression are being prepared, so that run is not evidence of prespawn performance. The most recent completed stock measurement is 1660 ms launch→input, so the under-500 ms target has not been achieved. Read Workstream F in `IMP_PLAN.md` and Startup performance in `docs/specs/07-workbench-branding-distribution.md` for the design and requirements.

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
| `b7f7657299e` | F7 | Speculative main-process shell startup, coordinated adoption and fallback, shared environment construction, live-reload preservation and race regressions; PENDING corrective profile-clone commit and successful adoption measurement |

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
| F7 `b7f7657299e` | stock | PENDING | PENDING | PENDING | PENDING | PENDING |
| F7 `b7f7657299e` | owner | PENDING | PENDING | PENDING | PENDING | |

F3.2's stock change is within the observed noise; the owner row was 149 ms slower at input. These rows do not establish an isolated gain for xterm preload or the two tiny contribution deferrals. F7's decision rule remained satisfied: first output lagged presentation by more than 150 ms.

Completed comparison artifacts:

- Corrected F4–F6 stock: `.build/terminal-first/perf/20261031T123557-stock-warm/summary.json`.
- Corrected F4–F6 owner: `.build/terminal-first/perf/20261031T123807-owner-warm/summary.json`.
- Corrected F4–F6 quit: `.build/terminal-first/perf/20261031T123225-stock-warm-quit/summary.json`.
- F3.2 stock: `.build/terminal-first/perf/20261031T124451-stock-warm/summary.json`.
- F3.2 owner: `.build/terminal-first/perf/20261031T124702-owner-warm/summary.json`.
- F3.2 quit: `.build/terminal-first/perf/20261031T124909-stock-warm-quit/summary.json`.
- F7 artifacts and before/after assessment: **PENDING — fill after the final packaged runs.**

### Historical measurements

| Build | Profile | launch→presented | launch→prompt | launch→input | prompt−presented | quit |
| --- | --- | --- | --- | --- | --- | --- |
| F0 `f702d86cacc` | stock | 1317 | 1488 | 1494 | 171 | 221 |
| F3.1 + F1 `ef7f9dcb5e0` | stock | 1112 | 1317 | 1323 | 207 | 234 |
| F2 `b53e117c3a5` | stock | 1159 | 1394 | 1412 | 244 | |

These older input rows accepted arbitrary output after a newline and can understate actual readiness. They are not directly comparable with the current executed-response probe. The first corrected long, unbracketed probe also exercised zsh editing hooks and was superseded by `306af882f47`; its stock/owner input medians of 1840/1864 ms are diagnostic only. Quit timing now targets the measured PID and starts immediately before requesting termination, excluding automation startup.

## Verification and packaged smoke

- The packaged build of `b7f7657299e` passed. Build log: `/tmp/vs-nosh-f7-build.log`.
- Full client typechecking and targeted lint on 15 TypeScript files passed during F7 integration; these runs were captured in tool output, not disk logs. Layer validation passed (`/tmp/vs-nosh-f7-layers.log`). **PENDING — consolidate final validation after the profile-clone correction.**
- The combined selected Electron run passed the other suites but exposed an incomplete reconnect test fixture. Registering its real `ITerminalService` fixed the deferred style-service error; the focused reconnect rerun passed 3 tests (two regressions plus the harness check) with no disposable leaks. That successful rerun was captured in tool output, not a disk log; `/tmp/vs-nosh-f7-all-tests.log` is the earlier combined run and must not be described as fully passing.
- `scripts/upstream-check.sh` passes: 71 documented patches, 79 changed upstream files, zero warnings. The earlier `gridview.ts` and `editorCommands.ts` manifest gaps are resolved.

Packaged smoke results: **PENDING — fill each row from observed behavior.**

| Check | Result |
| --- | --- |
| Fresh stock and owner launches: exactly one session shell; actual input probe succeeds | PENDING |
| Main prespawn publication and renderer adoption appear in marks; fallback remains usable | PENDING |
| Reload Window preserves the live shell PID and nonce | PENDING |
| Quit with two sessions, relaunch: tabs/layouts restored with fresh shell PIDs | PENDING |
| Initial `PATH` and `which git` agree with the intended login-shell environment | PENDING |
| `e README.md` from the first prompt reaches the owning editor | PENDING |
| Cmd+Q with `sleep 100` running exits without a dialog or surviving child | PENDING |
| Untrusted folder gets a shell; entering the editor applies trust | PENDING |

## Remaining performance work and limits

The under-500 ms target is still unproven and was not met by the completed pre-F7 rows. **PENDING — replace this sentence with the final measured gap after F7.** Do not mark that target complete merely because all planned code changes landed.

The earlier F2 timeline spent about 630 ms before the workbench started: main initialization, window/preload and loading the renderer bundle. New marks separate main service initialization and window stages. Both examined profiles had renderer cache files, but upstream `didUseCachedData` only estimates cache use from the commit/configuration; it does not prove a V8 cache hit. No speculative cache or service-initialization rewrite was made. Backup/workspace initialization remains a prerequisite for restore. The apparent second default-profile resolution does not repeat full profile discovery and did not justify another upstream change.

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
