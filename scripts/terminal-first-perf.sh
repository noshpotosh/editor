#!/usr/bin/env bash
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
#
# Measures packaged VS NOSH launches: process start to shell presented, first prompt output, and an
# input echo round trip, plus quit time. Each run launches the app with upstream's
# --prof-duration-markers (the app exits itself about 15 s after the workbench is ready) and the
# fork writes its marks beside the markers file. Results land in .build/terminal-first/perf/<timestamp>.
#
#   --runs N            launches per mode (default 5)
#   --cold              purge the file cache before each run (needs sudo); default is warm
#   --profile stock|owner  stock: fresh isolated profile with fork defaults only (default);
#                          owner: a copy of .build/terminal-first/user-data settings and extensions
#   --reset-profile     recreate the perf profile before running
#   --folder DIR        folder to open (default: this repository)
#   --build             rebuild the packaged app first
#   --quit              measure Cmd+Q instead of startup durations
#   --baseline FILE     a previous summary.json to print deltas against
#   --label TEXT        row label for the history file (default: commit, profile, mode)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/../VSCode-darwin-arm64/VS NOSH.app/Contents/MacOS/VS NOSH"
PERF_ROOT="$ROOT/.build/terminal-first/perf"
RUNS=5 MODE=warm PROFILE=stock RESET=0 FOLDER="$ROOT" BUILD=0 QUIT=0 BASELINE= LABEL=
while [[ $# -gt 0 ]]; do
	case "$1" in
		--runs) RUNS="$2"; shift 2 ;;
		--cold) MODE=cold; shift ;;
		--warm) MODE=warm; shift ;;
		--profile) PROFILE="$2"; shift 2 ;;
		--reset-profile) RESET=1; shift ;;
		--folder) FOLDER="$(cd "$2" && pwd)"; shift 2 ;;
		--build) BUILD=1; shift ;;
		--quit) QUIT=1; shift ;;
		--baseline) BASELINE="$2"; shift 2 ;;
		--label) LABEL="$2"; shift 2 ;;
		*) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
	esac
done
if [[ "$PROFILE" != stock && "$PROFILE" != owner ]]; then printf 'profile must be stock or owner\n' >&2; exit 2; fi
if [[ $BUILD -eq 1 ]]; then "$ROOT/scripts/terminal-first-app.sh" --build-only; fi
if [[ ! -x "$APP" ]]; then printf 'Packaged app missing; run scripts/terminal-first-app.sh --build-only first.\n' >&2; exit 1; fi
STAMP="$(cat "$ROOT/.build/terminal-first/packaged-build-complete" 2>/dev/null || printf unknown)"
HEAD_STAMP="$(git -C "$ROOT" rev-parse HEAD)$([[ -n "$(git -C "$ROOT" status --porcelain)" ]] && printf -- -dirty)"
if [[ "$STAMP" != "$HEAD_STAMP" ]]; then printf 'Warning: app built from %s, sources at %s (pass --build to rebuild).\n' "$STAMP" "$HEAD_STAMP" >&2; fi
if [[ "$MODE" == cold ]] && ! sudo -n true 2>/dev/null; then printf 'Cold runs need passwordless sudo for purge; run "sudo -v" first.\n' >&2; exit 1; fi

USER_DATA="$PERF_ROOT/user-data-$PROFILE"
EXTENSIONS="$PERF_ROOT/extensions-$PROFILE"
SHARED="$PERF_ROOT/shared-data"
if [[ $RESET -eq 1 ]]; then rm -rf "$USER_DATA" "$EXTENSIONS"; fi
mkdir -p "$USER_DATA/User" "$EXTENSIONS" "$SHARED"
if [[ "$PROFILE" == owner ]]; then
	for file in settings.json keybindings.json; do
		if [[ -f "$ROOT/.build/terminal-first/user-data/User/$file" ]]; then cp "$ROOT/.build/terminal-first/user-data/User/$file" "$USER_DATA/User/$file"; fi
	done
	if [[ ! -f "$EXTENSIONS/extensions.json" && -d "$ROOT/.build/terminal-first/extensions" ]]; then
		rsync -a --delete "$ROOT/.build/terminal-first/extensions/" "$EXTENSIONS/"
	fi
fi

RUN_DIR="$PERF_ROOT/$(date +%Y%m%dT%H%M%S)-$PROFILE-$MODE$([[ $QUIT -eq 1 ]] && printf -- -quit)"
mkdir -p "$RUN_DIR"
LABEL="${LABEL:-${HEAD_STAMP:0:11} $PROFILE $MODE$([[ $QUIT -eq 1 ]] && printf ' quit')}"
now_ms() { perl -MTime::HiRes=time -e 'printf "%d\n", time*1000'; }
launch() {
	# $1 = markers file; extra args follow. Runs in the foreground until the app exits.
	local markers="$1"; shift
	env -u VSCODE_DEV -u ELECTRON_RUN_AS_NODE "$APP" \
		--user-data-dir "$USER_DATA" --extensions-dir "$EXTENSIONS" --shared-data-dir "$SHARED" \
		--prof-duration-markers-file "$markers" "$@" "$FOLDER"
}
STARTUP_ARGS=()
for marker in code/didStartMain-code/terminalFirst/presented code/didStartMain-code/terminalFirst/prompt code/didStartMain-code/terminalFirst/input ellapsed; do
	STARTUP_ARGS+=(--prof-duration-markers "$marker")
done

# A rebuilt app has no V8 code cache yet; one discarded run creates it.
if [[ $BUILD -eq 1 || ! -d "$USER_DATA/CachedData" ]]; then
	printf 'Warm-up run (not recorded)...\n' >&2
	launch "$RUN_DIR/warmup.tsv" "${STARTUP_ARGS[@]}" >/dev/null 2>&1 || true
fi

for ((i = 1; i <= RUNS; i++)); do
	if [[ "$MODE" == cold ]]; then sudo -n purge; sleep 1; fi
	if [[ $QUIT -eq 1 ]]; then
		# Without duration markers the app stays open; wait for the fork's prompt dump, then quit it.
		rm -f "$RUN_DIR/run-$i.tsv.terminalFirst.json"
		now_ms > "$RUN_DIR/run-$i.launch"
		launch "$RUN_DIR/run-$i.tsv" >"$RUN_DIR/run-$i.log" 2>&1 &
		pid=$!
		for ((t = 0; t < 600; t++)); do [[ -f "$RUN_DIR/run-$i.tsv.terminalFirst.json" ]] && break; sleep 0.1; done
		sleep 1
		quit_start="$(now_ms)"
		osascript -e 'quit app "VS NOSH"' >/dev/null 2>&1 || kill -TERM "$pid"
		wait "$pid" 2>/dev/null || true
		echo $(( $(now_ms) - quit_start )) > "$RUN_DIR/run-$i.quit"
		printf 'run %d: quit %s ms\n' "$i" "$(cat "$RUN_DIR/run-$i.quit")" >&2
	else
		now_ms > "$RUN_DIR/run-$i.launch"
		launch "$RUN_DIR/run-$i.tsv" "${STARTUP_ARGS[@]}" >"$RUN_DIR/run-$i.log" 2>&1 || printf 'run %d: app exited with %s\n' "$i" "$?" >&2
		printf 'run %d: %s\n' "$i" "$(tr '\t' ' ' < "$RUN_DIR/run-$i.tsv" 2>/dev/null || printf 'no markers file')" >&2
	fi
done

EXPECT=launch->presented,launch->prompt
if [[ $QUIT -eq 1 ]]; then EXPECT=quit; fi
node "$ROOT/scripts/terminal-first-perf.mjs" aggregate "$RUN_DIR" --label "$LABEL" --history "$PERF_ROOT/history.tsv" --expect "$EXPECT" ${BASELINE:+--baseline "$BASELINE"} | tee "$RUN_DIR/summary.md"
printf 'Results: %s\n' "$RUN_DIR" >&2
