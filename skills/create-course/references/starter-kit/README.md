# Course starter kit

Copy this folder's contents into a new course directory, then:

1. Edit the manifest at the top of `assets/app.js`: the course `id` and `title`, then `MODULES` and `EXAMS`
   (ids, files, titles, blurbs, minutes) and the optional `PAGES`. The `id` prefixes every key the course
   saves in the browser (best scores, an attempt in progress, the depth choice): give each course its own,
   such as `"k8s-security-2026"`, or two courses opened in one browser share progress. Without an `id`, a
   slug of the title is used. `PAGES` lists extra pages for the sidebar's "Start here" (a principles page, a
   story page); list only pages the course has. The example entries are placeholders; replace them.
2. Edit `authoring/SPEC.md`: rewrite the learner profile and the topic list; keep the structure rules,
   quiz rules, lab rules and the definition of done unless the user asked for something else.
3. Edit `index.html`: title, lead, who it is for, the course map SVG, conventions. In `exams/`, put the course
   title in each page's `<title>`, and point `practice-mix.html` at the module banks (`data-from` and one script
   tag per bank).
4. Keep `authoring/TEMPLATE.html`, `quizzes/_example.js`, `assets/style.css`, `tools/check_course.py`
   as they are unless the course needs new components. Add CSS classes rather than inline styles.
Commands below say `python3`; on Windows use `py -3` if `python3` is not found.

5. Serve with `python3 -m http.server 8765 --directory <course root>` when checking in a browser;
   `file://` pages render but browser automation tools cannot read them. Kill stale servers on the port first.
6. `python3 tools/check_course.py` (standard library only) reads the manifest from `assets/app.js` and checks
   every module page with its bank, then the exam pages. A bare copy of the kit fails it with three errors,
   "missing module file", one per example module in the manifest, until those pages exist; the finals' banks
   show as warnings until they are written. Its rules sit in one block at the top. A page that breaks a rule on
   purpose says so itself, in a comment the checker reads, for example an orientation module with no lab:
   `<!-- check_course: lab=0 scenario-card=1 questions=18-30 -->`. The keys are the counted blocks
   (`svg`, `scenario-card`, `compare`, `warning`, `lab`: a new minimum), `words` (a new prose ceiling),
   `questions` (a new bank size) and `domains` (a new minimum); other words in the comment are ignored.
7. Module pages get a "Core path / Full module" switch under `.meta`. The core path hides labs (`.lab`), the
   explain-it-back prompts (`#self-check`, not the quiz), further reading (`#reading`), the flavors table, scenario
   cards after the second, tables and anything marked `data-depth="reference"`; `data-depth="core"` keeps a block.
8. `assets/widgets.js` and `widgets.css` are the widget library (token decoder, flows, policy evaluators,
   spot-the-bug, terminal replay, `defense-lab`); `authoring/WIDGETS.md` documents every embed. Most widgets carry
   built-in samples on security topics (tokens, cookies, CORS, OAuth flows, AWS IAM, Kubernetes NetworkPolicy,
   relationship-based access); `spot-the-bug`, `terminal-replay` and `defense-lab` take their content from the
   page, so they suit any topic.
9. `authoring/rewrite/splice.py` replaces a module's concept region (from `#section-1` up to `#scenarios`,
   labs included) with a new sections file whose placeholders pull figures, code, tables, widgets, labs and
   screenshots from the old page, and renumbers lettered scenario cards. `authoring/rewrite/quizfix/apply.py
   mNN` applies a JSON of option-text replacements and reports how often the correct option is still the
   longest. See the skill's `references/rewrites.md`.
