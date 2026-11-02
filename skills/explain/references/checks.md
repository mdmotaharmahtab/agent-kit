# Checks before showing a document

Run these after every write or edit, not only at the end. Each takes minutes and catches the errors
readers notice first.

## Order pass
1. Read top to bottom as the reader. At every term, acronym, identifier, person, file or number, ask:
   has the reader already met it, above this point or in the same sentence? If not, move its
   introduction earlier or explain it here.
2. Read every figure's labels and caption the same way. Labels count as text. A figure may introduce
   a term only if its caption or the paragraph right after it explains every such label.
3. When you move or insert a block (a figure, table, example, section), list what it relies on and
   make sure each of those is introduced before its new position.
4. Run `check_explainer.py <file>` (HTML or Markdown) and resolve every `USED-BEFORE-DEFINED` line.
   Treat its other output as hints.

## Consistency pass
1. Every value shown more than once (a version, a name, a number, an identifier) is the same
   everywhere. Search for each one.
2. Values in previews, examples and figures come from one real source where possible: a run of the
   code, a real file, a real query. Copy them from there; do not type them by hand.
3. When two sources disagree on a value, keep one value throughout the running example and record the
   disagreement in the sources note. Never quietly compute one from the other.
4. A count stated in prose matches the table or list it summarises. Each general statement (always,
   never, every, none) holds against the exceptions the document reports later; if not, reword one.
5. Opening and closing agree: what the start promises, the end delivers, in the same order.

## Figure check
1. Every figure is walked through in the prose, using its own labels. In a flow or system figure,
   number the arrows in time order and label each with what passes along it.
2. In a browser, labels do not overlap each other and arrows do not cross text. Measure (for example
   with SVG `getBBox`) rather than trusting a scaled screenshot.
3. Nothing is wider than the page at a normal width.

## Claims and code
1. Label claims where the difference matters: **Fact** (checked against a source), **Guess** (our
   reading, to confirm), **Recommendation** (what we propose). A label is a short tag after the
   sentence. State the convention once, at the first label. A Guess replaces hedging words; it does not
   add to them. Cite the source of each fact; a claim read directly from a cited file needs no label.
   Keep provenance (scripts, line numbers, versions, who confirmed what) in one sources note, with at
   most a short pointer in the text.
2. Before writing that something is absent, search as the reader would, under other names and through
   other routes to the same result, and say beside the claim what was searched.
3. Run every snippet that can run, and show its real output, with the versions used.
4. Never reproduce credentials, even when reporting that they leaked. Name the file and the variable.
5. Keep the scripts that produce a document's numbers and figures with the document (in the project,
   or a folder beside the document when the sources are read-only), and name them. Never only in a
   scratch folder.
