# A game course

Read the skill's core first. A game course teaches the same material as a normal course in short stops
and play: worlds of levels, with depth moved into side quests. Choose it when the learner prefers that,
or when a normal course would be too long for them to read. The kit is `game-kit/`; copy it into the
course root.

## Shape

- **A world per topic,** each telling one story (a request or a situation, from setup to response).
  A world map (`index.html`) lists the worlds; each world has a hub.
- **The main quest: 4 to 6 levels,** plus a short Level 0 for basics only if the world needs them, and an
  optional final level ("choose the path" briefs). Where the topic allows, the levels form a **ladder**:
  each level is one real way to solve the world's problem and fixes the problem the previous level left.
  When the levels are alternatives judged on the same questions, give the world a **scorecard**
  (`WORLD.score`) that each level's tests reveal.
- **Side quests,** 3 to 10 per world, each branching from one level and returning to it. Depth goes here:
  how it works underneath, variations, edge cases.
- **Bonus missions:** one practice mission per lab (click paths, a mock terminal with real commands and
  outputs, real artifacts, a verify step; see `labs.md`) and an exam from the question bank.

## A stop

Why first (what breaks without it, shown as a failure with real values), then how (real requests,
commands and config, collapsed when long), then, where it helps, an "In real life" box (collapsed): build
or buy, two to four real products, what they do and what you still write, a small snippet, the usual
mistake, the date it was checked. Then one challenge whose every wrong answer teaches a concrete failure,
and an unlock on the map.

Main-path text is at most about 220 words per stop, 10 to 15 minutes per level, about 5 minutes for
Level 0. Facts are never deleted to meet the cap; they move into collapsed boxes.

A level usually runs: a mission briefing (the situation, and the problem the previous level left), the
setup (what each party creates before any request, and why), the request moving across the map, the
response, tests (short "predict, then watch" scenarios), and a debrief ("what you now know", the
scorecard, the mission that motivates the next level).

## Process

1. **Level 0 of the first world first,** and the learner's reaction to it before anything else.
2. **A world brief** (`game-kit/authoring/WORLD_BRIEF.md`, filled in for this course) and one builder per
   world, using the strongest model available. Each builder writes only its world's folder, a coverage file
   and a build report with every fact's source.
   - **From scratch:** the brief names the world's topic, story and syllabus row; the coverage file maps each
     concept of that row to where the world teaches it.
   - **Converting a normal course:** the brief names the source module; the coverage file maps every section of
     it, with an "Omitted" list and the reason for each omission.
3. **Fix shared decisions centrally** after the first builders report, and record them in the brief: one
   timeline, the cast's details, one name per service, counts that recur ("the four token checks"),
   lifetimes. Contradictions between worlds are the most common audit finding.
4. **Audit every world** (`game-kit/authoring/AUDIT_BRIEF.md`): a read-only auditor plays only that world,
   then judges, concept by concept, whether a player who played only the game would understand it. Send the
   findings back to the same builder.
5. **Test-play every page** with `authoring/tools/headless_play.js` (node with jsdom) or `playworld.js` in a
   served browser, and run `authoring/tools/check_game.py`. Record each world's status in a `CHECKPOINT.md` (one queue row per world; the `autonomous` skill describes the file).

## Lessons

- In Claude Code, helper agents that a builder starts report to the coordinator, not to the builder: relay their results,
  or have builders do the work themselves.
- A hidden browser tab throttles timers, so use the headless runner for long test runs, and give builders
  a no-browser rule.
- The engine shuffles the options of banks and built-in challenges, so authors may put the right answer in a fixed
  place; a hand-written `api.quiz` keeps its order unless it calls `GAME.shuffleOptions`.
- Keep a game self-contained: no links into an older course.
