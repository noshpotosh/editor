#!/usr/bin/env bash
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
set -euo pipefail

TERMINAL_FIRST_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec "$TERMINAL_FIRST_ROOT/scripts/code-cli.sh" \
	--user-data-dir "$TERMINAL_FIRST_ROOT/.build/terminal-first/user-data" \
	--extensions-dir "$TERMINAL_FIRST_ROOT/.build/terminal-first/extensions" \
	--shared-data-dir "$TERMINAL_FIRST_ROOT/.build/terminal-first/shared-data" \
	"$@"
