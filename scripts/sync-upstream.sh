#!/bin/sh
# Tries the engine's upstream (storytold/pdfcraft main) on top of our fork's `carry` branch, and says whether it still
# merges, builds and passes the tests of the crates we change. Run by .github/workflows/upstream-sync.yml every week.
#   scripts/sync-upstream.sh            merge in a scratch branch of the clone, build, test (nothing leaves this machine)
#   scripts/sync-upstream.sh --push     the same, then push the result as `carry-next` to the fork
# Exit codes: 0 fine, 2 the merge conflicts (the files are listed), 3 the merge builds or tests badly.
# Needs git and a Rust toolchain with the wasm32-unknown-unknown target. PDFCRAFT_SRC picks the clone (default vendor/pdfcraft).
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
src="${PDFCRAFT_SRC:-$here/vendor/pdfcraft}"
fork=https://github.com/hikashop-nicolas/pdfcraft.git
upstream=https://github.com/storytold/pdfcraft.git

[ -d "$src/.git" ] || git init --quiet "$src"
git -C "$src" remote get-url origin >/dev/null 2>&1 || git -C "$src" remote add origin "$fork"
git -C "$src" remote get-url upstream >/dev/null 2>&1 || git -C "$src" remote add upstream "$upstream"
git -C "$src" fetch --quiet origin carry
git -C "$src" fetch --quiet upstream main
behind=$(git -C "$src" rev-list --count origin/carry..upstream/main)
echo "carry is $(git -C "$src" rev-list --count upstream/main..origin/carry) commits ahead of upstream's main and upstream has $behind it lacks"

git -C "$src" checkout --quiet --detach origin/carry
git -C "$src" branch -f carry-next HEAD
git -C "$src" checkout --quiet carry-next
if ! git -C "$src" -c user.name=sync -c user.email=sync@localhost merge --no-edit upstream/main >/dev/null 2>&1; then
  echo "upstream main does not merge into carry; conflicts:"
  git -C "$src" diff --name-only --diff-filter=U
  git -C "$src" merge --abort
  exit 2
fi
echo "merged cleanly: $(git -C "$src" rev-parse --short HEAD)"

crates="-p pdfcraft-xfa -p pdfcraft-js -p pdfcraft-engine -p pdfcraft-edit -p pdfcraft-fonts -p pdfcraft-forms -p pdfcraft-wasm"
if ! (cd "$src" && cargo test --quiet $crates && cargo build --quiet -p pdfcraft-wasm --target wasm32-unknown-unknown --release); then
  echo "the merge builds or tests badly"
  exit 3
fi
echo "builds and passes"
if [ "${1:-}" = "--push" ]; then
  git -C "$src" push --quiet --force origin carry-next
  echo "pushed carry-next: $(git -C "$src" rev-parse HEAD) (to take it: fast-forward carry to it, put the hash in pdfcraft.rev, run the wasm tests)"
fi
