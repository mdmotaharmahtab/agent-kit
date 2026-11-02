# Changelog

All notable changes to this project are documented here, newest first, in plain
language for the owner. Every accepted task adds a dated entry naming its id;
`node scripts/work.mjs check` fails when an accepted task is missing from this
file.

## [Unreleased]

### {{DATE}} — the autonomous kit is in place

**Added**

- A work queue with explicit approval, blockers, and evidence; a lane guard that
  keeps instruction and documentation changes out of the product lane; freshness
  stamps on the living documents; command receipts bound to an exact source
  snapshot; and recovery hooks that reload the recorded state after a restart or
  compaction.
