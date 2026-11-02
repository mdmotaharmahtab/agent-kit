# How-to

**The reader asks:** "How do I do this?" (set something up, run a procedure, recover from a failure).

**Done when:** the reader can do it alone, from start to finish, and knows what to do when a step
fails.

**Spine:**
1. **What this achieves and when to use it,** in one or two sentences.
2. **Before you start:** access, tools and versions, with how to check each one.
3. **Numbered steps.** Each step is one action, with the exact command or click, and the **expected
   result** right after it, so the reader can tell it worked.
4. **If a step fails:** the likely causes and fixes, placed at that step, not at the end.
5. **How to undo it,** if the procedure changes something.
6. **Why it works,** briefly and last, for the reader who wants it.

**Main picture:** the expected output of key steps (a terminal result, a screen, a file).

**Common failure:** steps that assume a setting, a path or a permission the reader does not have.

**Retell test:** "Could you do this on your own machine, without asking anyone?"

**Example:** restoring Brightside Books' orders database from last night's backup.
1. Check you can reach the backup store: `aws s3 ls s3://brightside-backups/orders/` lists
   `2026-10-27.dump`.
2. Restore into a new database, never over the live one: `pg_restore -d orders_restore 2026-10-27.dump`
   prints no errors and ends after about four minutes.
