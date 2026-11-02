#!/usr/bin/env bash
# POSIX wrapper for the lifecycle context hook.
#
# It resolves the repository from its own location, prefers a project-local
# Node 22 under .tools/ when one exists, and otherwise uses `node` from PATH.
# Every failure prints a note on stderr, writes "{}" on stdout, and exits 0, so
# a broken hook can never stop a session.
set -u -o pipefail

fail_open() {
  printf 'context hook: %s\n' "$1" >&2
  printf '{}\n'
  exit 0
}

mode="${1:-run}"
if [[ "$mode" != "run" && "$mode" != "render" ]]; then
  fail_open "usage: scripts/context-hook.sh [run|render]"
fi

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)" ||
  fail_open "could not resolve the wrapper directory"
root="$(cd -- "$script_directory/.." && pwd -P)" ||
  fail_open "could not resolve the repository from the wrapper"

node=""
for candidate in "$root"/.tools/node-*/bin/node; do
  if [[ -x "$candidate" ]]; then
    node="$candidate"
    break
  fi
done
if [[ -z "$node" ]]; then
  node="$(command -v node 2>/dev/null)" || fail_open "no Node runtime is available"
fi

node_version="$("$node" --version 2>/dev/null)" || fail_open "the Node runtime could not start"
case "$node_version" in
  v2[2-9].* | v[3-9][0-9].*) ;;
  *) fail_open "Node 22 or newer is required; found $node_version" ;;
esac

exec "$node" "$root/scripts/context-hook.mjs" "$mode"
