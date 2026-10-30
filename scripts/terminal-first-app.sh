#!/usr/bin/env bash
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
set -euo pipefail
TERMINAL_FIRST_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TERMINAL_FIRST_APP="$TERMINAL_FIRST_ROOT/../VSCode-darwin-arm64/VS NOSH.app"
if [[ "$(uname -s)" != Darwin || "$(uname -m)" != arm64 ]]; then
	printf '%s\n' 'This launcher requires an Apple Silicon Mac.' >&2
	exit 1
fi
TERMINAL_FIRST_STAMP="$TERMINAL_FIRST_ROOT/.build/terminal-first/packaged-build-complete"
build_app() {
	rm -f "$TERMINAL_FIRST_STAMP"
	(cd "$TERMINAL_FIRST_ROOT" && npm run gulp vscode-darwin-arm64-min)
	mkdir -p "$(dirname "$TERMINAL_FIRST_STAMP")"
	touch "$TERMINAL_FIRST_STAMP"
}
if [[ "${1:-}" == --build ]]; then
	shift
	build_app
elif [[ ! -f "$TERMINAL_FIRST_STAMP" || ! -x "$TERMINAL_FIRST_APP/Contents/MacOS/VS NOSH" ]]; then
	build_app
fi
unset VSCODE_DEV ELECTRON_RUN_AS_NODE
exec "$TERMINAL_FIRST_APP/Contents/MacOS/VS NOSH" \
	--user-data-dir "$TERMINAL_FIRST_ROOT/.build/terminal-first/user-data" \
	--extensions-dir "$TERMINAL_FIRST_ROOT/.build/terminal-first/extensions" \
	--shared-data-dir "$TERMINAL_FIRST_ROOT/.build/terminal-first/shared-data" \
	"$@"
