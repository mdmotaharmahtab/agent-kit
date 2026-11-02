# System walkthrough

**The reader asks:** "How does this whole system work?" (an architecture, a pipeline, a platform).

**Done when:** the reader can pick any step and say what starts it, what runs it, what it reads and
writes, and what uses that next; and can trace a wrong result back to the step that made it.

**Spine:**
1. **The answer, and what is real:** what the system produces, for whom; then which parts exist today,
   which are proposed or illustrative, and where pieces outside the source live.
2. **The whole system on one diagram,** before any mechanism. Number the arrows in time order and label
   each with what passes along it and where it is stored; label each part with what runs it. Walk the
   running example down it once.
3. **One section per stage,** in the order the data moves, each in the same shape:
   - what it is for, and the example at this stage;
   - what starts it and what runs it (service or image, then file and function, quoting the few lines
     that matter);
   - what it reads and writes, each with one real example and where it lives, and who uses it next;
   - how it is built and shipped;
   - how it fails, and how you would notice.
   Teach a mechanism (storage, a runner, a file format) in the first stage that needs it.
4. **One run traced hop by hop,** from its trigger to the code: what fires it, what it passes, how each
   name is found, citing the file behind each hop; say so at the hop when the source lacks it.
5. **How a change ships,** and how the system grows, as "the same system, plus this".
6. **The path again,** forward in one sentence per stage, then backward from a wrong result to its source.

**Main picture:** the numbered, labelled diagram of spine item 2.

**Common failure:** a diagram that shows the order of work but not what passes between parts or what
runs each one, so the reader can retell the sequence but cannot find anything.

**Retell tests:** "Pick a step: what starts it, what runs it, what does it read and write, and what uses
that next?" and "This result looks wrong: which parts do you check, in what order?"

**Example:** how Brightside Books turns the day's orders into the morning sales report.
- Diagram: ① at 02:00 a scheduled job exports the day's orders → `orders/2026-10-27.csv` in storage →
  ② a cleaning job → the `daily_sales` table → ③ a report job → the PDF e-mailed to the shop managers.
- Stage ②: started when ① writes its file; runs as a container task calling `clean.py`'s `main()`;
  reads `orders/2026-10-27.csv` (1,284 rows), writes 1,261 rows to `daily_sales` (23 test orders
  dropped); read next by ③; fails loudly on a missing file, silently on a changed column name.
