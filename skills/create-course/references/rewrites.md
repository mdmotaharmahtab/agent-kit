# Rewriting existing modules

When the learner approves a new shape on one module and asks for the rest to follow, the run is long and
must survive compaction. Keep its state in files, as the `autonomous` skill describes: a
checkpoint file (`CHECKPOINT.md`) with one queue row per module (rewritten, reviewed, fixes applied, quiz balanced) and every
remaining step, including your own.

Per module:

1. **Back up the page once** (`backup/NN.before-rewrite.html`).
2. **Write the new region as its own file** (`rewrite/NN-sections.html`), with placeholders for material
   kept from the old page, always in the old numbering: `{{FIG:old:new}}`, `{{CODE:sN:k}}`,
   `{{TABLE:sN:k}}`, `{{WIDGET:n}}`, `{{SHOT:name}}`, and `{{LAB:n}}` or `{{LAB:n:m}}` for a lab kept as lab n (or
   renumbered to m); `splice.py` warns about any old lab left unused.
3. **Splice it in** with `authoring/rewrite/splice.py <base> <sections> <out>`, from a patch script kept in
   the project (see the `autonomous` skill's rule on patch scripts: re-runnable, and reporting every anchor it
   did not find).
4. **Check it:** the checker, explain's checks, the page in a browser (measure SVG labels with `getBBox`;
   run every interactive part).
5. **Review it** read-only (a subagent in the background, or a fresh session) and start the next module while it runs; apply the review,
   then rebalance the quiz (`authoring/rewrite/quizfix/apply.py` reports how often the correct option is
   the longest).

Verify version-sensitive facts against current primary sources before writing, and again when a
reviewer contradicts you. Record verified facts in the checkpoint, so every later module and reviewer
uses the same ones.
