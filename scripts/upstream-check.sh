#!/usr/bin/env bash
# Checks the fork's upstream patch manifest. See docs/upstream/SYNC.md.
#   scripts/upstream-check.sh              verify the manifest, gate spelling, import order, and PATCHES.md
#   scripts/upstream-check.sh --markdown   print the PATCHES.md table
#   scripts/upstream-check.sh --diffstat   also print the diffstat of every documented patch
set -euo pipefail
cd "$(dirname "$0")/.."
exec node build/fork/upstream-check.ts "$@"
