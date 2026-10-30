#!/usr/bin/env bash
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
#
# Builds (when needed) and launches the packaged VS NOSH app with the isolated profile.
#   --build            rebuild before launching
#   --build-only       rebuild and exit
#   --no-build-check   launch even when the packaged app was built from other sources
# The build stamp records the commit (plus -dirty) the app was built from; a stale stamp triggers a rebuild.
set -euo pipefail
TERMINAL_FIRST_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TERMINAL_FIRST_APP="$TERMINAL_FIRST_ROOT/../VSCode-darwin-arm64/VS NOSH.app"
if [[ "$(uname -s)" != Darwin || "$(uname -m)" != arm64 ]]; then
	printf '%s\n' 'This launcher requires an Apple Silicon Mac.' >&2
	exit 1
fi
TERMINAL_FIRST_STAMP="$TERMINAL_FIRST_ROOT/.build/terminal-first/packaged-build-complete"
source_stamp() {
	local head dirty=
	head="$(git -C "$TERMINAL_FIRST_ROOT" rev-parse HEAD 2>/dev/null || printf unknown)"
	if [[ -n "$(git -C "$TERMINAL_FIRST_ROOT" status --porcelain 2>/dev/null)" ]]; then dirty=-dirty; fi
	printf '%s%s\n' "$head" "$dirty"
}
build_app() {
	rm -f "$TERMINAL_FIRST_STAMP"
	(cd "$TERMINAL_FIRST_ROOT" && VSCODE_SKIP_COPILOT="${VSCODE_SKIP_COPILOT:-1}" npm run gulp vscode-darwin-arm64-min)
	mkdir -p "$(dirname "$TERMINAL_FIRST_STAMP")"
	source_stamp > "$TERMINAL_FIRST_STAMP"
}
BUILD=0 BUILD_ONLY=0 CHECK=1
while [[ $# -gt 0 ]]; do
	case "$1" in
		--build) BUILD=1; shift ;;
		--build-only) BUILD=1; BUILD_ONLY=1; shift ;;
		--no-build-check) CHECK=0; shift ;;
		*) break ;;
	esac
done
if [[ $BUILD -eq 1 ]]; then
	build_app
elif [[ ! -x "$TERMINAL_FIRST_APP/Contents/MacOS/VS NOSH" || ! -s "$TERMINAL_FIRST_STAMP" ]]; then
	build_app
elif [[ $CHECK -eq 1 && "$(cat "$TERMINAL_FIRST_STAMP")" != "$(source_stamp)" ]]; then
	printf 'Packaged app was built from %s; sources are at %s. Rebuilding (pass --no-build-check to skip).\n' "$(cat "$TERMINAL_FIRST_STAMP")" "$(source_stamp)" >&2
	build_app
fi
if [[ $BUILD_ONLY -eq 1 ]]; then exit 0; fi
unset VSCODE_DEV ELECTRON_RUN_AS_NODE
exec "$TERMINAL_FIRST_APP/Contents/MacOS/VS NOSH" \
	--user-data-dir "$TERMINAL_FIRST_ROOT/.build/terminal-first/user-data" \
	--extensions-dir "$TERMINAL_FIRST_ROOT/.build/terminal-first/extensions" \
	--shared-data-dir "$TERMINAL_FIRST_ROOT/.build/terminal-first/shared-data" \
	"$@"
