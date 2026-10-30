# Keeping up with upstream

VS NOSH is a long-lived fork of [microsoft/vscode](https://github.com/microsoft/vscode). This page is the procedure for pulling upstream changes in. The companion page [PATCHES.md](PATCHES.md) is generated and lists every upstream file the fork modifies.

## Principles

- **Fork code lives in fork paths.** `src/vs/workbench/contrib/terminalFirst/`, `src/vs/editor/contrib/nativeVim/`, `src/vs/workbench/services/terminalFirst/`, `src/vs/platform/terminalFirst/`, the two built-in extensions, `docs/`, and `build/fork/`. New behavior goes there first.
- **Upstream files get call-outs, not logic.** When upstream code must change, it calls into a seam the fork owns: `EditorPartHooks`, `EditorGroupRouting`, `TerminalPolicy`, `viewContainerHosts`, or a one-line branch on `terminalFirstEnabled` from `src/vs/platform/terminalFirst/common/terminalFirst.ts`. The gate is never spelled as the raw string `'terminal-first'` outside that module.
- **The gate import goes last.** In an upstream file, `import { terminalFirstEnabled } …` is the last line of the import block, so upstream import changes merge cleanly.
- **Every upstream edit is documented.** `build/fork/upstream-patches.json` lists each modified upstream file with its seam, why it exists, and how to re-validate it. `scripts/upstream-check.sh` fails when a modified upstream file is missing from it.
- **Merge, do not rebase.** The fork branch is published and shared. Merges keep history bisectable, let `git rerere` remember conflict resolutions, and keep `build/fork/upstream-base` equal to the last merge base.

## Procedure

1. **Dry run.** `scripts/upstream-sync.sh 1.145.0` fetches `upstream` and prints which files would conflict. Prefer release tags: the fork base is a release branch commit that carries cherry-picks from `main`, so a dry run against `upstream/main` reports conflicts in files the fork never touched (currently under `src/vs/sessions/`). The script prints the conflicts, split into documented patches and everything else. Conflicts in documented patches are expected; look up each file in [PATCHES.md](PATCHES.md) to see what the fork needs from it. Conflicts elsewhere mean upstream touched a file next to a fork change and need a closer look.
2. **Merge.** `scripts/upstream-sync.sh --merge` runs `git merge --no-ff --no-commit`. Resolve conflicts with the seam notes: for a `hook-callout` the resolution is almost always "keep upstream, re-add the one-line call-out"; for a `gate`, keep upstream and re-add the `terminalFirstEnabled` branch; for `additive-api`, keep both.
3. **Record the base.** After committing the merge, write the new merge base: `git merge-base HEAD upstream/main > build/fork/upstream-base`.
4. **Check the manifest.** `scripts/upstream-check.sh`. Add entries for any new upstream edits, remove stale ones, and regenerate the table: `scripts/upstream-check.sh --markdown > docs/upstream/PATCHES.md`.
5. **Build and validate.**
   ```sh
   npm run compile
   npm run valid-layers-check
   npm run eslint
   node --test extensions/terminal-first/test/cli.test.cjs
   ./scripts/test.sh \
   	--run vs/workbench/contrib/terminalFirst/test/browser/terminalFirstService.test \
   	--run vs/workbench/contrib/terminalFirst/test/browser/terminalFirstPolicy.test \
   	--run vs/workbench/contrib/terminalFirst/test/browser/terminalPolicy.test \
   	--run vs/workbench/contrib/terminalFirst/test/browser/editorPartSessions.test \
   	--run vs/workbench/contrib/terminalFirst/test/browser/tileRouting.test \
   	--run vs/workbench/contrib/terminalFirst/test/browser/tiles.test \
   	--run vs/workbench/contrib/terminalFirst/test/browser/floatingTerminal.test \
   	--run vs/workbench/contrib/terminalFirst/test/browser/floatingFileBrowser.test \
   	--run vs/workbench/contrib/terminalFirst/test/browser/fileBrowserModel.test \
   	--run vs/workbench/contrib/terminalFirst/test/browser/fileBrowserOperations.test \
   	--run vs/workbench/contrib/terminalFirst/test/browser/jumpListModel.test \
   	--run vs/workbench/contrib/terminalFirst/test/browser/floatingJumpList.test \
   	--run vs/workbench/contrib/terminalFirst/test/browser/sessionTabs.test \
   	--run vs/workbench/contrib/terminalFirst/test/browser/terminalCopyMode.test \
   	--run vs/workbench/contrib/terminalFirst/test/browser/terminalFirstNavigation.test \
   	--run vs/workbench/contrib/terminalFirst/test/browser/nativeVim.test \
   	--run vs/editor/contrib/nativeVim/test/common/nativeVim.test \
   	--run vs/editor/contrib/nativeVim/test/browser/nativeVimContribution.test \
   	--run vs/workbench/services/editor/test/browser/editorGroupsService.test \
   	--run vs/workbench/services/editor/test/browser/editorService.test \
   	--run vs/workbench/contrib/terminal/test/browser/terminalService.test \
   	--run vs/workbench/contrib/terminal/test/electron-browser/localTerminalBackend.test \
   	--run vs/workbench/test/browser/notificationsToasts.test \
   	--run vs/workbench/contrib/browserView/test/electron-browser/browserEditorInput.test \
   	--run vs/workbench/contrib/browserView/test/electron-browser/overlayManager.test
   ```
6. **Smoke test.** `npm run build-fast && ./scripts/terminal-first.sh /path/to/project`: the shell appears first; sessions switch with Cmd+Option+Left/Right; Ctrl+Space e opens the editor; tiles open from the New Tile picker; the floating terminal toggles; `e file` opens the file in the owning session; reload keeps sessions and terminals.
7. **Commit the merge** with a message that names the upstream ref, for example `Merge upstream/main (1.145.0) into terminal-first`.

## Adding a new upstream edit

Before editing an upstream file, look for a seam. If none fits, add the smallest possible call-out, keep the gate import last, then add the file to `build/fork/upstream-patches.json` with its `kind`, `seam`, `why`, and `validate` entries, and regenerate `PATCHES.md`. `scripts/upstream-check.sh` runs in CI through `.github/workflows/upstream-drift.yml`.
