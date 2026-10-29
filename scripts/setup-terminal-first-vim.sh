#!/usr/bin/env bash
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
set -euo pipefail

TERMINAL_FIRST_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TERMINAL_FIRST_VIM_VERSION=1.32.4
TERMINAL_FIRST_VIM_SHA256=773a1836e5ff0338ca352fa77273403f7861f1a0b220ac66d46e356d4f991f98
TERMINAL_FIRST_VSIX="$TERMINAL_FIRST_ROOT/.build/terminal-first/vim-$TERMINAL_FIRST_VIM_VERSION.vsix"
mkdir -p "$(dirname "$TERMINAL_FIRST_VSIX")"

if [[ ! -f "$TERMINAL_FIRST_VSIX" ]]; then
	curl --fail --location --retry 3 \
		"https://github.com/VSCodeVim/Vim/releases/download/v$TERMINAL_FIRST_VIM_VERSION/vim-$TERMINAL_FIRST_VIM_VERSION.vsix" \
		--output "$TERMINAL_FIRST_VSIX.download"
	mv "$TERMINAL_FIRST_VSIX.download" "$TERMINAL_FIRST_VSIX"
fi

printf '%s  %s\n' "$TERMINAL_FIRST_VIM_SHA256" "$TERMINAL_FIRST_VSIX" | shasum -a 256 --check

exec "$TERMINAL_FIRST_ROOT/scripts/terminal-first-cli.sh" --install-extension "$TERMINAL_FIRST_VSIX" --force
