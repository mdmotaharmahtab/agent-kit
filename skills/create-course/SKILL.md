---
name: create-course
description: Build a self-paced course or study guide (offline HTML by default; first ask whether the user wants a game course or a normal course) on any technical topic for a specific learner, with a gap-filling syllabus, modules that explain core ideas first, practice inside the sections, quizzes and certification-style exams, an optional story, widgets and reference app, and independent reviews. Use when the user asks to "create a course", "make a curriculum", "teach me X properly", "build learning material", "make a study guide with exams", or similar. For a single explanatory document, use explain.
---

# Create a course

A course works when the learner can do the work afterwards and still knows why a year later. Every
page of a course is an explanation, so the `explain` skill's core (its SKILL.md, section 1) applies to
every page and every author. This skill adds what a course needs on top: a learner profile, a
syllabus, practice, quizzes and exams, and a build process that many authors can follow.

## 1. The core (every course)

1. **Ask the format first: game course or normal course.** *Because* they are built from different
   kits and in a different order (section 3).
2. **Write the learner profile before the syllabus,** and put it in the authoring spec: what they
   know well, the gap to teach from zero, how they learn, where they will apply it, the outcome they
   want. Ask; do not assume a default learner. *Because* every author must teach the same person.
3. **Fill the gaps in the syllabus.** List the requested topics and mark the one that matters most;
   add the prerequisites they skipped, the adjacent topics a practitioner always meets, the
   operational layer, and a capstone. Say what you added and why. *Because* the learner does not know
   what they do not know.
4. **Each module answers one main question, and its shape follows that question's type** in explain
   (system, mechanism, how-to, domain, and so on). The course adds its own parts around it
   (`references/normal-course.md`). *Because* one fixed module shape fits one kind of topic.
5. **Core ideas first, flavors second.** Each module opens with three to six core ideas, each stated as
   the problem that forces it, with no tool or vendor name; it ends with a flavors table where the names
   belong. *Because* tools and notations are variations of a few ideas, and the ideas are what last.
6. **Practice inside the section it practises,** in the forms a practitioner uses for this field
   (`references/labs.md`). *Because* practice far from the teaching tests memory, not understanding.
7. **Show how real teams do it, beside the concept:** the product or library they would use, what it
   handles and what the team still writes, with versions checked against current documentation.
   *Because* the learner has to carry the idea into real work.
8. **Teach at most two end-to-end flows,** the ones real deployments use; every other shape is a short,
   labelled variation of one of them. *Because* equal weight on many shapes hides which one is standard.
9. **Quizzes test understanding and hands-on skill, not recall** (`references/quiz-format.md`).
   *Because* a learner who can only recall terms has not learned the topic.
10. **Pilot first.** Build one module (or the game's Level 0), check it in depth and get the learner's
    reaction before writing the rest. *Because* a wrong level or format found in one module is cheap;
    found in sixteen, it is a rewrite.
11. **Answers go into the page.** When the learner asks "how?" or "why?", the answer is added where the
    question arose, not only given in chat. *Because* the next reader will have the same question.

## 2. Sizes

Choose by the learner's available time, and state the size in the plan.

| Size | When | Shape |
|---|---|---|
| Study guide | A few hours, one topic | 1 to 5 pages, one quiz bank per page, no finals, no story or app; relax the checker's per-module minimums with each page's exception comment |
| Course | Weeks of study | 6 to 16 modules in 3 to 5 layers with a dependency order; a bank of 24 to 50 questions per module; two finals and a practice mix; story, widgets and reference app only if they help this learner |
| Game | The learner prefers short stops and play over long reading | Worlds of levels with side quests and bonus missions (`references/game-course.md`) |

A long course is not a better course. If the learner will not read it, offer the game format or the
kit's "core path" mode, which hides optional depth.

## 3. Pages

| Need | Page |
|---|---|
| A normal course: output layout, module shape, story, widgets, reference app | `references/normal-course.md`, kit `references/starter-kit/` |
| A game course | `references/game-course.md`, kit `references/game-kit/` |
| Labs and screenshots | `references/labs.md` |
| Quiz bank format and exam rules | `references/quiz-format.md` |
| Rewriting existing modules | `references/rewrites.md` |
| Prompts for module authors, exam authors, editors and reviewers | `references/subagent-prompt.md` |

This skill uses two sibling skills from the same kit: `explain` (its core and `check_explainer.py`, at
`../explain/references/`) and, for long runs, `autonomous`. Where your tool has no subagents, give each prompt to a
fresh session with only the files it lists, one module at a time.

## 4. Process

1. **Plan, and wait for approval:** the learner profile, the size, the syllabus as a table (one line
   per module: why it is here, its scope boundary, its explain type), what you added beyond the request,
   the format and the process. Leave room to insert a module later (labels like "07b").
2. **Scaffolding first,** copied from the kit, before any content; test it in a browser over localhost (no browser: the kit's checker and, for games, `headless_play.js`).
3. **The spec** (`authoring/SPEC.md`) and, if the course has a story, the story bible
   (`authoring/STORY.md`) before any author starts. Authors read these and explain's core, not the
   conversation.
4. **The pilot module.** Check it in depth: technical accuracy, the explain checks, the learner's read.
   Put every gap it shows into the spec, then use it as the example for the rest.
5. **One author per module,** in parallel, each owning only its own files (`references/subagent-prompt.md`).
   Finals come after the modules. Widgets and the reference app can be built in parallel as new files and
   embedded only after module editing is finished.
6. **Checks:** the kit's checker with zero errors; explain's `check_explainer.py` on every page; pages
   opened in a browser.
7. **Reviews:** read-only reviewers split by module range, plus one across the course. Collect the findings in
   `authoring/REVIEW_TODOS.md`, then triage each one: fix it in place, move it to optional depth, or decline it with
   a reason, so the course does not grow by additions. A second vendor's model reviews only if
   the user asks.
8. **Report:** where the course is and how to open it, the syllabus with your additions, what was
   verified and how, and what was not.

Never let two agents edit the same file at the same time.

## 5. Safety

- Use made-up names for clients, employers and third parties, and obviously fake placeholders for
  keys and tokens, even as examples of a leak.
- For attack topics, write defence only: attacks as paraphrased, inert placeholders, no working
  payloads, challenges that choose a defence.
- Take console screenshots only when the user asks, read-only (`references/labs.md`).

## 6. Done when

- The checker passes with zero errors, and every page opens from `file://` with a working sidebar,
  pager, quizzes and widgets.
- Every module has its core ideas, sections shaped by its type, practice inside the sections, a flavors
  table, takeaways that restate the core ideas, "explain it back" prompts and a bank that parses.
- The pilot's lessons are in the spec; the reviews are done and their accepted findings fixed.
- The report names what could not be verified.

## 7. When the learner says they do not understand

Follow explain's section 5: explain first, name the gap, then change the page where the gap is, as
agreed.

---

*This skill was made with the help of Claude.*
