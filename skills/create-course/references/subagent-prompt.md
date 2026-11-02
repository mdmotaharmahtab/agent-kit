# Subagent prompt templates

Fill every <angle> field. Give each subagent the strongest model available, at its highest reasoning effort. Keep the full
syllabus in every module prompt so scope stays consistent, and ask for a report so you can verify without reading
the whole file. Run the pilot module's author alone first and check its page in depth before starting the rest.

## Module-author prompt

```
You are writing ONE module of a self-paced HTML course, "<course title>".
Course root: <absolute path>

FIRST, read these completely and follow every rule in them:
1. authoring/SPEC.md  (the course's requirements and definition of done)
2. The explain skill's SKILL.md, section 1 (the core), and its type page for this module: <type page path>
3. authoring/TEMPLATE.html  (exact page structure and inline SVG conventions)
4. quizzes/_example.js  (exact quiz bank format; strict JSON inside the array)
5. <the pilot module's page, as the example to match>

Then write exactly TWO files and nothing else:
- modules/<NN-slug>.html
- quizzes/m<NN>.js  (register under window.QUIZ_BANKS["m<NN>"])

Do not edit assets/, index.html, or other modules. Do not ask questions; make reasonable decisions and report them
at the end. Write each file whole, in one step.

YOUR MODULE: Module <NN>, "<title>". ~<minutes> min. Prerequisites: <modules> (the learner already knows <list>;
do not re-teach, refer back). Main question: <the question>; explain type: <type>.

Full course syllabus (scope boundaries): <one line per module, marking what neighbours own that this module must
NOT teach in depth>.

<Learner-specific framing for this module.>

Topics to cover (numbered, concrete):
1. <topic: the mechanisms, names, specifications and snippets to show>
2. ...

Figures: <one per key idea; list them>.
Scenario cards (at least 3): <incident patterns; made-up names for organisations>.
Labs (1 to 3, 300 to 700 words each, inside the section they practise): <the one task each; the forms to show>.
Quiz (24 to 50): test <what mechanics, what decisions under constraints>, with about 5 hands-on questions built on
the module's snippets and labs and at least 2 "this design is acceptable" questions. Domains: <5 to 8 labels>.

When finished, report: word count, figure count, question count (single and multi), domains used, and anything you
were unsure about.
```

## Final-exam author prompt (after modules exist)

```
Read every module page in modules/ and every bank in quizzes/m*.js. Write
quizzes/final-<a|b>.js registered as window.QUIZ_BANKS["final-<a|b>"] with 65
questions in the strict JSON format of quizzes/_example.js. Rules: integrative
(most questions span 2-3 modules), scenario-based, no easy questions, 60-70%
single and 30-40% multi, every option has "why", every question has
"explanation", at least 5 "this design is acceptable" questions, no question may
duplicate a module-bank question, roughly even coverage across modules, domain
tags = module titles. Final B must be written to differ from Final A in scenarios
and emphasis (B leans on design trade-offs and judgement). Report counts by module
and by type.
```

## Fix-editor prompt (after reviews; one per disjoint module range)

```
You are the fix-and-clarity editor for modules <range>. You own ONLY <files>.
Read authoring/SPEC.md, the explain skill's SKILL.md section 1 and the module's type
page, authoring/reviews/<report>.md, authoring/REVIEW_TODOS.md, authoring/STORY.md.
Mandate A: apply every review item (Done / Skipped with reason).
Mandate B: clarity pass against the explain core and SPEC: core ideas after the
objectives; each section opens with the question it answers; term lists rewritten as
explanations; every code block and figure taught; flavors table before takeaways;
takeaways restate the core ideas. Integrate each fix where the learner first needs
it. Keep all structure ids and story blocks. Edit with exact anchors, never
whole-file rewrites. Run the checker per module. Write
authoring/reviews/fixes-<range>.md and report the core ideas chosen per module.
```

## Story-thread prompt

```
Read authoring/STORY.md (bible), SPEC.md, style.css (.episode, .episode-end,
.timeline exist). For each module insert an Episode box before <h2 id="why"> and an
"after this module" wrap-up after #resolution, agreeing with the module's teaching
(follow the module on conflicts, keep the bible's names and numbers). Create
story.html with a timeline (one item per episode, the cumulative architecture SVG,
link to the module). Edit index.html to link it. Validate with a
script; run the checker.
```

## Widgets prompt (new files only)

```
Build assets/widgets.js + widgets.css (dependency-free, file:// safe, ES2019, IIFE,
boots on [data-widget]): <list widgets and options>. Pure logic on
window.WIDGET_LOGIC with a self-test page (widgets-demo.html, your own). Write
authoring/WIDGETS.md with exact embed snippets and target sections. Do not edit
modules. Test in a browser on a spare port or via self-tests; have a read-only
reviewer (a subagent, or a fresh session) for protocol accuracy and accessibility, then fix.
```

## Reference-app prompt (new folder only)

```
Build <app>/ : a small local app composing what the course teaches, runnable with no
cloud account (mock services, SQLite, fake model), a test suite, README and
MODULE_MAP.md. <For security topics: INSECURE_* flags per control and an attacks/
script per module that succeeds with the flag on and fails with it off.> <Optional:
infrastructure files for <clouds>, every resource tagged, one destroy command.> Own
environment; run the tests; state what was not executed on this machine. Do not deploy.
```

## Review subagent prompt (read-only)

```
You are reviewing a course, read-only. Do not edit files. Course root: <path>.
Read authoring/SPEC.md, then every modules/*.html and quizzes/*.js <or the subset
assigned>. Report in sections with file and section references:
1. Technical accuracy: wrong claims, invented names/flags/RFC numbers, outdated
   product names, misleading simplifications. Quote the sentence.
2. Contradictions between modules or with SPEC.
3. Exam quality: questions with no defensible single answer, ambiguous
   multi-selects, distractors that are arguably correct, giveaway wording, answers
   that contradict the module text, questions answerable without the scenario.
   List by question id.
4. Coverage gaps vs the topic outline for the module.
5. Structure: missing sections, broken HTML, diagrams that do not match captions.
6. Forward references: any sentence that relies on a later section or module to make its point, bare
   "(2.7)" pointers to later sections, and "we come back to this later" teasers. Quote each one.
7. Real-world practice: mechanisms taught without showing how real apps do it (which product or library, what it
   handles, what you still write); snippets with outdated APIs or unpinned versions.
8. Clarity for the learner in authoring/SPEC.md: use items 1 to 4 of the explain skill's
   references/review-prompt.md, with the learner profile as the persona.
9. What can be removed, merged or moved to optional depth.
Be actionable and specific. No praise.
```
