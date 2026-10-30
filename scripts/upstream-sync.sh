#!/usr/bin/env bash
# Merges microsoft/vscode into the fork. See docs/upstream/SYNC.md.
#   scripts/upstream-sync.sh [ref]           dry run: fetch and list the files that would conflict
#   scripts/upstream-sync.sh [ref] --merge   merge with --no-ff --no-commit, then print the validation steps
# ref defaults to upstream/main; a release tag such as 1.145.0 also works.
set -euo pipefail
cd "$(dirname "$0")/.."

REF="upstream/main"
MERGE=0
for arg in "$@"; do
	case "$arg" in
		--merge) MERGE=1 ;;
		*) REF="$arg" ;;
	esac
done

if ! git remote get-url upstream >/dev/null 2>&1; then
	git remote add upstream https://github.com/microsoft/vscode.git
fi
git fetch upstream --tags --quiet

BASE="$(cat build/fork/upstream-base)"
MANIFEST="build/fork/upstream-patches.json"
echo "fork base:   $BASE"
echo "merge ref:   $REF ($(git rev-parse --short "$REF"))"
echo "upstream:    $(git rev-list --count "$BASE..$REF") commits since the base"

# Dry run with merge-tree (git >= 2.38): list conflicting paths without touching the working tree.
set +e
CONFLICTS="$(git merge-tree --write-tree --name-only HEAD "$REF" 2>/dev/null | tail -n +2)"
STATUS=$?
set -e
if [ $STATUS -ne 0 ] && [ $STATUS -ne 1 ]; then
	echo "git merge-tree failed; use git >= 2.38 or run the merge directly." >&2
	exit 1
fi

if [ -z "$CONFLICTS" ]; then
	echo "conflicts:   none"
else
	DOCUMENTED="$(node -e 'const m=require(process.argv[1]);console.log([...m.patches.map(p=>p.path),...m.forkOwnedInUpstreamDirs].join("\n"))' "$PWD/$MANIFEST")"
	echo
	echo "Conflicts in documented patches (expected; resolve from the seam notes in docs/upstream/PATCHES.md):"
	while IFS= read -r path; do
		if grep -qxF "$path" <<<"$DOCUMENTED"; then echo "  $path"; fi
	done <<<"$CONFLICTS"
	echo
	echo "Conflicts elsewhere (investigate; these are not fork patches):"
	while IFS= read -r path; do
		if ! grep -qxF "$path" <<<"$DOCUMENTED"; then echo "  $path"; fi
	done <<<"$CONFLICTS"
fi

if [ $MERGE -eq 0 ]; then
	echo
	echo "Dry run only. Re-run with --merge to start the merge."
	exit 0
fi

if [ -n "$(git status --porcelain)" ]; then
	echo "The working tree must be clean before merging." >&2
	exit 1
fi

git config rerere.enabled true
set +e
git merge --no-ff --no-commit "$REF"
set -e

cat <<MSG

Merge started. Resolve conflicts, then:
  1. git merge-base HEAD $REF > build/fork/upstream-base   (after committing the merge)
  2. npm run compile && npm run valid-layers-check && npm run eslint
  3. scripts/upstream-check.sh
  4. Run the validation list in docs/upstream/SYNC.md
  5. git commit
MSG
