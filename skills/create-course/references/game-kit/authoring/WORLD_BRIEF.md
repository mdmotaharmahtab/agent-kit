# Brief for building a world

Copy this file into the course's `authoring/` and fill in every `<angle>` field before giving it to a builder.
The process it belongs to is in the skill's `references/game-course.md`.

You are building one **world** of a game course: **<world id and title>**. Read, in this order:

1. This brief, fully, and the course's world plan (`<plan file>`), finding your world's row.
2. The shared decisions below, and the writing rules in the `explain` skill's core (SKILL.md section 1).
3. The model pages: `../worlds/example/level-0.html` (look, tone, pacing, length) and
   `../worlds/example/level-1.html` (a ladder level with tests and a scorecard).
4. `../assets/game.js` (the engine; its API is documented at the top: levels, side quests, bonus missions,
   `api.choice / sort / order / parts / meet / terminal / quiz`, `GAME.fromBank`, the scorecard, the cloud switch,
   the `side-here` and `cloud-here` placeholders) and `../assets/game.css`.
5. Your source:
   - **From scratch:** your world's syllabus row: `<topic, story, what the player must be able to do after>`.
   - **Converting a course module:** the module `<path>`, its quiz bank `<path>`, and its story row `<path>`, fully.

## The goal

A player who plays only your world (main quest, side quests, bonus missions) understands everything in your source
that is worth knowing, better than by reading it. Keep everything necessary; omit only extras that would disrupt the
flow, and list each omission and its reason in your coverage file.

## The shape of a world

- **Main quest: 4 to 6 levels**, plus a short Level 0 only if the world needs its own basics, plus an optional final
  level. Each level 10 to 15 minutes, main-path text at most about 220 words per stop. Tell one story, from setup to
  response. Where the topic allows, make the levels a **ladder**: each one real way to solve the world's problem,
  each fixing the problem the previous level left. If the levels are alternatives judged on the same questions, give
  the world a **scorecard** (`WORLD.score`), revealed by each level's tests.
- Every concept: first the **why** (what breaks without it, with real values), then the **how** (real requests,
  commands, config, collapsed where long), then, where it helps, **in real life** (a collapsed box: build or buy,
  2 to 4 real products, what they do versus what you still write, a minimal snippet, the usual mistake, the date
  checked).
- **Side quests: 3 to 10**, each 5 to 10 minutes, branching from one level (`from`) and returning to it, linked from
  its stop with `<div class="side-here" data-side="id"></div>`, with at least one challenge.
- **Bonus missions:** one practice mission per lab (`kind: "mission"`: click paths with `api.order`, a mock terminal
  with real commands and outputs with `api.terminal`, real artifacts with `api.parts`, a verify step) and one exam
  (`kind: "exam"`) from `worlds/<id>/bank.js` with `api.quiz("#q", GAME.fromBank(QUIZ_BANKS["<key>"]), { pass: 0.72 })`.
  A bank copied from a course must first lose every reference to that course ("module 03", "see above").

## Files you write (and nothing else)

- `worlds/<id>/world.js` (`window.WORLD`: id, title, blurb, levels, sides, bonus, score or null),
  `worlds/<id>/index.html` (copy `worlds/example/index.html` as is), the level, side-quest and bonus pages,
  `worlds/<id>/bank.js`, `worlds/<id>/img/`.
- `authoring/coverage/<id>.md`: one row per concept (and, when converting, per source section): `source | concept |
  where in the game | note`, then an "Omitted" list with the reason for each.
- `authoring/reports/<id>/build.md`: the page list, the concepts unlocked, every product or specification fact you
  verified with its URL, anything unverified, anything the engine should add.

Do not edit `assets/*`, the root `index.html`, `assets/worlds.js`, other worlds or this brief. If you need an engine
feature, build it inside your own page and say so in your report.

## Page skeleton

Copy the head and layout of `worlds/example/level-0.html`: `../../assets/game.css`, then at the end
`../../assets/worlds.js`, `world.js`, `../../assets/game.js`, then your stops and one call: `GAME.level({ level: N,
stops })`, `GAME.level({ side: "id", stops, phases })` or `GAME.level({ bonus: "id", stops, phases })`. Use the
engine's challenge APIs (the test runners can solve them); every challenge must be solvable and every wrong answer
must teach a concrete failure. Wrap inline scripts in an IIFE. The map: viewBox `0 0 640 300`, at most 6 nodes, no
wire crossing text.

## Facts

Verify anything version- or date-sensitive (product names and menus, defaults, limits, specification revisions) on
the vendor's current documentation, and record the URLs. Never write an unverified claim as fact: leave it out or
say plainly that it is unverified. Verified facts every world shares: `<list>`.

## Cast, names and shared decisions

`<The course's cast: each person with a plain role and one clause of introduction; the companies and products (made
up); addresses and ids; one name per service; the timeline; recurring counts. Introduce each name in one clause at
first use in your world. Real product names are fine in "In real life" boxes; real employer or client names never.>`

## Checks before you finish

1. Syntax-check every page's inline script (extract it to a temporary file and run `node --check`), and `world.js`
   and `bank.js`.
2. Read every page top to bottom as a newcomer: every term defined before use (including in wrong-answer feedback
   and collapsed boxes), no forward references except one pointer right after raising a topic, no em dashes.
3. Coverage: every concept (and, when converting, every source section) appears in your coverage file.
4. Reply with: the world's title, a one-sentence description for the world map, the number of main levels, the page
   list, and anything you could not do.
