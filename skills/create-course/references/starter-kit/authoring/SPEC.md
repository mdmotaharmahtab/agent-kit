# Authoring spec: <course title>

You are writing ONE module of a self-paced course. Read this whole file, then the `explain` skill's core
(its SKILL.md, section 1) and the explain type page named for your module, before writing. Everything here
is the course's additions to those rules.

Course root: `<course root>`.

## Learner profile

<Fill in from the plan: their role and what they already know well; the gap to teach from zero; how they
learn; where they will apply it; the outcome they want. Write it about the learner's skills, never about
their employer or clients.>

Teach from the ground up: never assume a term this module or an earlier one has not explained.

## Deliverables for your module

1. `modules/NN-slug.html`, copying `authoring/TEMPLATE.html` exactly (the same `<head>`, layout, `data-sidebar`,
   `data-pager` and script tags).
2. `quizzes/mNN.js`, in the format of `quizzes/_example.js` (`references/quiz-format.md` in the skill), registered
   under `window.QUIZ_BANKS["mNN"]`.

Do not create other files. Do not edit `assets/`, `index.html` or other modules.

## The page, in order (ids in parentheses are checked by `tools/check_course.py`)

1. Header: module number, title, a `.lead` promise, `.meta` (time, prerequisites, quiz count), `.objectives`
   (five to eight, verb first).
2. `.core-ideas`: three to six core ideas, each the problem that forces it and the shape of the idea, with no
   tool, vendor or protocol name inside.
3. `#why`: the opening scenario in a `.callout.scenario`, its open questions named (A, B, C).
4. The sections `#section-1` to `#section-N`. Their shape follows your module's explain type. Each opens with the
   question it answers and ends with why the next section follows. Teach each section as an instance of a core
   idea, and say which.
   - Practice (`.lab`, `id="lab-N"`, numbered in page order) sits inside the section it practises, right after the
     part that teaches it (`references/labs.md` in the skill).
   - Right after a mechanism, show how a real team does it: the product or library, what it handles and what the
     team still writes, the version checked against current documentation.
   - <For security topics: teach layered defences hole by hole, with a per-layer figure, an attack-to-defence table
     and, where the defences are independent switches, a `defense-lab` widget. Delete this line otherwise.>
5. `#scenarios`: at least three `.scenario-card` stories (situation, what went wrong or was decided, lesson), based
   on real incident patterns; made-up names for any organisation.
6. `#resolution`: the opening scenario's questions answered in the same order, with nothing new.
7. `.flavors`: one row per core idea: the flavors you will meet, and what actually differs between them.
8. `.takeaways`, one per core idea; `#self-check`: four to six "explain it back" prompts with `<details>` model
   answers; the `.quiz` div (`data-quiz="mNN" data-count="18"`); `#reading`: four to eight primary sources.
9. `<div class="pager" data-pager></div>`, then the two script tags.

## Course-specific rules

- Figures: inline SVG with the template's classes, viewBox width 760, a `.caption` and an `aria-label` each; marker
  ids unique across the page; text inside its boxes. One figure per key idea, walked through in the prose by its own
  labels.
- Code: real, minimal, correct; escape `<`, `>` and `&` inside `<pre>`; teach every block (what it does before it,
  the lines that matter after it). Run what can run, and mark the rest "not run here".
- Where a concept has equivalents across vendors or clouds, give a small cross-vendor table.
- No definition or intuition callouts: explain each term in the sentence where it first appears.
- <Course-wide facts verified once for every author, with sources: specification revisions, product names.>
- <Course-wide names: the running example, the story cast, addresses and ids (made up).>

## Quiz bank

24 to 50 questions, written by `references/quiz-format.md` in the skill: scenario-based, medium or hard, 60 to 70%
single and 30 to 40% multi, every option with a `why`, every question with an `explanation`, about five hands-on
questions built on the module's snippets and labs, at least two "this design is acceptable" questions, every section
covered by at least two questions, and the correct option the longest in no more than 20% of questions.

## Definition of done (check before you report)

- [ ] `tools/check_course.py` passes with zero errors for your page and bank.
- [ ] The explain checks: every term introduced before use, no forward references except a pointer right after a
      topic is raised, `check_explainer.py` (in the explain skill's `references/`) run on the page.
- [ ] Every lab inside its section; every code block taught; every figure walked through.
- [ ] `data-quiz="mNN"` matches `window.QUIZ_BANKS["mNN"]` and the script src `../quizzes/mNN.js`.
- [ ] Report back: word count, figure count, question count (single and multi), and anything you were unsure about.
