# Changelog

All notable changes to this project are documented here, newest first, in plain
language for the owner. Every accepted task adds a dated entry naming its id;
`node scripts/work.mjs check` fails when an accepted task is missing from this
file.

## [Unreleased]

### 2026-11-02 — updates that keep the project's files, and fewer false failures

**Changed**

- Running the installer again on a project that has the kit updates it: the
  answers come from the project's `autonomous.config.json` (a flag still wins),
  the config is merged without adding keys that have defaults, and `--force`
  replaces only a file that still has the bytes an install pinned. A file the
  project changed or owns is kept and listed, and an update neither rewrites
  nor restamps the work state or the living documents.
- A first install adds a documentation-map row for each document the project
  already has, and the map counts only what git would commit.
- The privacy check flags only this machine's username in a home-directory path.
- A support record without `fileHashes` covers its paths only until it is
  pushed.
- `scripts/verify.mjs` runs a `.cmd` command such as `npm` on Windows, and
  autosave commits only the allowlisted paths.
- Every command refuses an unknown option.
- New installs write the kit's new names (`autonomousVersion`,
  `autonomous-doc-state`, `autonomous_support_result`); the old ones still read.
- The tests run on Vitest 5.

### 2026-10-30 — renamed to the autonomous kit, and ready for other people's projects

**Changed**

- The package, its commands, and the files it installs are named "autonomous"
  instead of "harness" (`autonomous.config.json`, `autonomous-*` agents,
  `autonomous-install`). A project installed under the old names keeps working,
  and the installer, run with `--force`, renames its files.
- The privacy check matches a username only as a home-directory path segment,
  and knows macOS and Linux home paths.
- Autosave's secret check matches whole name parts (`api-key.txt`, not
  `keyboard.ts`), never saves `.claude/settings.local.json`, and can skip the
  GitHub visibility check (`autosave.visibilityCheck: "none"`) for other hosts.
- The installer leaves a project's own `AGENTS.md` and `CLAUDE.md` alone and
  writes the kit's versions beside them, does not protect files it left alone,
  backs up every file `--force` replaces, pins the bytes of what it wrote, and
  sets line endings only for its own files.

**Added**

- `autonomous-uninstall`, which removes what the install record says the
  installer wrote and leaves changed files alone.

### 2026-09-20 — the agent harness is in place

**Added**

- A work queue with explicit approval, blockers, and evidence; a lane guard that
  keeps instruction and documentation changes out of the product lane; freshness
  stamps on the living documents; command receipts bound to an exact source
  snapshot; and recovery hooks that reload the recorded state after a restart or
  compaction.
