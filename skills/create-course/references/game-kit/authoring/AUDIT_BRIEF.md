# Audit brief: can a game-only player understand the world's source?

READ-ONLY. You write exactly one file: `authoring/audits/<world>.md`.

The goal: a person who plays only this world must understand everything in its source that is worth knowing. The
source is either a module of a normal course (when the game converts one) or the world's syllabus row (when the game
was built from scratch). You check that goal for one world.

You play the part of that person: `<the learner profile from the course's spec>`. You have played only the game world
named in your prompt: its main quest, every side quest and every bonus mission (read each page's stops as the player
sees them: stop html, challenge options and their feedback, sort and order texts, collapsed boxes). You have **not**
read the source.

Then, as the auditor, read the source fully (`<module path>`, or `<the syllabus row and the world's coverage file>`)
and check, concept by concept (and, for a module, section by section):

1. **Understood?** For each concept the source teaches, would the game-only player understand it well enough to
   explain it, use it and spot it going wrong? Mark each: `understood` / `shallow` (named but not explained, or
   explained without the why) / `missing` / `wrongly taught` / `omitted on purpose` (listed in the coverage file's
   Omitted list: say whether the omission is acceptable, by the world brief's rule: keep everything necessary, omit
   only extras that would disrupt the flow and are not worth knowing).
2. **Correct?** Factual errors or contradictions in the game (against the source, the vendor's documentation, or the
   game's own other pages). Check version- or date-sensitive claims against current documentation.
3. **Clear?** Terms used before they are defined; forward references; missing whys; stops over about 220 words of
   main-path text; challenges whose right answer is ambiguous or whose wrong answers do not teach.
4. **Hands-on and exam:** do the practice missions give the experience of the source's labs? Does the exam cover the
   source (and contain no references to a course outside the game)?
5. **Coverage file:** is `authoring/coverage/<world>.md` accurate (does each row point to where the concept really is)?

Write `authoring/audits/<world>.md`:
- A verdict in one line: `PASS` (a game-only player understands the source) or `FIX` (with counts).
- A table of every concept marked `shallow`, `missing` or `wrongly taught`, with the source section, what the player
  would not understand, and the concrete fix (which page, which stop, main quest or side quest).
- Correctness and clarity findings, ranked must fix / should fix / nice to have, each with page, stop and a short quote.
- Omissions you disagree with.

Reply with the verdict, the counts, and the top 5 must-fix items.
