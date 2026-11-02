# A normal course

Read the skill's core first. This page says what a normal (non-game) course contains and how its
modules are shaped. The kit in `starter-kit/` implements all of it; copy it and adapt the manifest,
colors and names rather than rewriting the runtime.

## Output layout

One folder named after the course, offline and with no build step: no CDN, no web fonts, no `fetch()`,
so every page works from `file://`.

- `index.html`: what the course is for, how to study it, a course map, module cards, exams.
- `modules/NN-slug.html`, `quizzes/mNN.js` (one bank per module), `quizzes/final-*.js`, `exams/*.html`.
- `assets/style.css`, `assets/app.js` (manifest, sidebar, progress, pager, quiz engine; an attempt in
  progress is saved locally so a reload resumes it), and optionally `assets/widgets.js` and `widgets.css`.
- `authoring/SPEC.md`, `authoring/TEMPLATE.html`, `authoring/STORY.md` (if there is a story),
  `authoring/reviews/`.
- `tools/check_course.py` (structural checker, standard library only).
- Optional: `principles.html` (the course-wide core ideas, each with the modules that build on it),
  `story.html`, a reference app folder.

Set the manifest's course `id` first: progress is stored under it, so two courses never share scores.
Diagrams are hand-written inline SVG in one visual language, each with a caption and an `aria-label`.

## The shape of a module

The middle of a module follows the explain type of its main question (a mechanism page for "how does
this work?", a how-to for "how do I set this up?", a system walkthrough, a domain explainer). Around it
the course adds, in this order:

1. A header with the objectives, then the **core ideas** (skill core 5).
2. An **opening scenario**: a short situation with its open questions named. The module's **resolution**
   answers the same questions in the same order at the end, adds nothing new, and keeps the numbers.
3. The **sections**, each opening with the question it answers and ending with why the next one follows.
   Practice sits inside the section it practises (`labs.md`).
4. **Scenario cards** from real-world practice: the situation, what went wrong or was decided, the lesson.
5. The resolution, then a **flavors table** (core idea, the flavors you will meet, what actually differs).
6. **Takeaways**, one per core idea; "explain it back" prompts with hidden model answers; the quiz;
   further reading from primary sources.

The kit's `TEMPLATE.html` has this shape and the checker knows its ids.

**Forward pointers.** The learner reads top to bottom, so every sentence must make sense with what they
have read so far. Name a later section only right after raising its topic, to say where it is covered
in depth. No bare "(2.7)" pointers and no teasers ("we come back to this later").

**A journey, when the topic is one event.** If the module's subject happens in time (a request, a
deployment, an incident), its sections can be the stops of that one event in the order it happens, with
a route map as the first figure. Each problem appears at the stop where it happens, with its fix.

**Show the failure each piece prevents.** Never state a property ("cannot be reused") without showing
what goes wrong without it. For layered defences (security and similar topics), teach the chain: the
naive version, the attack that breaks it, the layer that fixes it, the next attack; then give a figure
with one panel per layer, a table of attack against the defence that stops it, and, where the kit's
`defense-lab` widget fits, a lab where the learner switches a layer off and runs the attack.

**Show the learner the module's outline** (its sections, or its stops) before writing or rewriting a
module: correcting an outline is cheap, correcting a page is not.

## Optional depth

The kit's "Core path / Full module" switch hides labs, self-checks and reading, so a learner short on
time can follow the main line. Put material the main line needs on the main line; put depth (long
reference, extra variations) in collapsed boxes or in the parts the switch hides.

## The story thread (optional)

Teaching lands better when every module happens to one system. Write `authoring/STORY.md` before the
authors start: a small cast with plain roles, the product, a table with one row per module (where the
system is, what breaks or is demanded, what changes by the end), consistent numbers. Each module gets an
episode before its opening scenario and a wrap-up after its resolution, and `story.html` shows the
timeline. Where the bible and a module disagree, follow the module and keep the names. After a module is
rewritten, regenerate the story page from the modules (keep it scripted), and check the arc: a later
module must not rediscover a problem an earlier one fixed.

## Widgets (optional)

Widgets let the learner operate a mechanism without an account: a decoder, a step-through of a protocol
with its real parameters, a toy policy evaluator, "spot the bug" cards that make the learner commit
before revealing. Build them as one dependency-free library that works from `file://`, with its logic
exposed for self-tests; document each embed in `authoring/WIDGETS.md`; embed them only after module
editing is finished; have a reviewer check accuracy and accessibility (live regions, focus, contrast).

## The reference app (optional)

Offer it when the topic is a system the learner will build. One small local app that composes what the
course teaches and runs with no cloud account (mock services, SQLite, a fake model), tested in its own
environment. For security topics, give each control an insecure-mode flag and a scripted attack per
module that succeeds with the flag on and fails with it off. Infrastructure files for the clouds the
user names are optional; tag every resource, provide one destroy command, and never apply cloud
resources yourself. Say clearly what could not be run on the build machine.
