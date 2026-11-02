// These sentences keep the autonomous kit autonomous, deciding routine matters instead of asking the owner again and again, so each stays word for word in both rulebooks with no owner gate added on top.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RULEBOOKS = ["template/AGENTS.md", "AGENTS.md"];

const KEEP = [
  "The owner is the last resort, not a decision gate.",
  "**Decide, do not ask.** Routine choices, already-evidenced facts, and reuse of existing project resources are yours. Record the decision and keep moving.",
  "**Plain language to the owner.** The owner reads outcomes, not internals. Every owner-facing sentence must land for someone who has never opened the code.",
  "## Owner engagement",
  "Engage the owner only for: actual spending; new account access, interactive authentication, 2FA, consent, or a device/organization/security-policy change; consequential product or architecture decisions that change approved scope; public release, repository visibility or access, and any Git action outside the standing authorization; deletion or destructive out-of-project actions; a whole-goal blocker with no safe parallel work left.",
  "Everything else is yours to decide: restart or reuse project resources, bounded route choices, evidence classification, re-planning after a worker result.",
  "When a rule's literal wording blocks a routine action whose purpose is preserved, interpret by purpose, act, and record it.",
  "When the owner sends a message mid-work, answer it first, in plain language, before any further tool call.",
  "### Plain-language owner communication",
  "Do not paste conversation history into a brief.",
  "Two review rounds maximum, ever.",
  "An approved goal stays active across results, questions, reviews, commits, and compactions. Finishing a subtask is not permission to stop.",
  "Before yielding, run `node scripts/work.mjs no-yield`. Exit 1 means continue. Exit 0 permits yielding only for a completed objective, an explicit owner pause, or when every approved task is blocked for a recorded owner-only reason.",
  "When one path is blocked, record it and continue independent approved work.",
  "decide routine matters, queue consequential questions, never treat silence as approval.",
];

// Lines that would let the owner's global "plan first, then wait" rules outrank the autonomous kit's autonomy.
const FORBID = [/global instructions apply on top/i, /wait for (the owner's|my) go-ahead/i];

const flat = (text) => text.replace(/\s+/g, " ");

describe("autonomy lines", () => {
  for (const file of RULEBOOKS) {
    const text = flat(readFileSync(join(ROOT, file), "utf8"));
    it.each(KEEP)(`${file} keeps: %s`, (sentence) => {
      expect(text).toContain(flat(sentence));
    });
    it(`${file} adds no owner gate on top`, () => {
      for (const rx of FORBID) expect(text).not.toMatch(rx);
    });
  }
});
