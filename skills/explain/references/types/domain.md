# Domain explainer

**The reader asks:** "What is this unfamiliar field, or this unfamiliar file, and why does it matter
to my work?"

**Done when:** the reader can do the work by hand with the real material (find the record, read its
values, reach the same verdict an expert would) and can talk to the people who know the field.

**Spine:**
1. **The answer, and what is real:** what the thing is and why it matters to the reader's work; what
   exists today and what is planned.
2. **The world it comes from,** as a ladder of plain terms, each built on the last, up to the point.
3. **What it is and where it sits** in the work: who makes it, when, and who uses it.
4. **What is inside, following the running example** through every part that matters, each part shown
   as a real record at the place the text first describes it.
5. **The work done by hand:** walk the example through the job as the person who does it would, each step
   with its hands-on form (core 4). If a tool automates the job, each tool step then names the hand step
   it replaces.
6. **How to read it without being fooled,** by hand and in code: the traps, the most harmful first.
7. **Reference** (see `reference.md`), for lookup only.

**Main picture:** one real record of the file or artifact, its fields labelled in plain words, shown
where the text first says what it holds. If the work turns it into another record, show one of that too.

**Common failure:** describing what the file contains in prose and counts, so the reader understands the
idea but is stuck the moment they open the real file.

**Retell tests:** "What is this, and why does it matter to the work?" and "Open the real file: find the
running example's record, read the values that matter, and say what they lead to."

**Example:** for a new engineer at Brightside Books, the ONIX product feed (the standard file publishers
use to describe their books) and why the catalogue depends on it. The main picture is one real product
record for *The Salt Road*: the ISBN, the title, the price block with its currency, and the
availability code `20`, each labelled ("20 means available now"). The hand step: a cataloguer looks up
that code in the code list to decide whether the book can be sold today.
