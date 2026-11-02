# Newcomer review prompt

Fill in the three placeholders and give this to a read-only reviewer (a subagent using the strongest
model available, at its highest reasoning effort; without subagents, a fresh session). Give it only what the reader will see: not the
conversation, the source files or your notes. Keep the document's intended main message to yourself,
so the reviewer's summary is an honest test.

Pick the reviewer's profile at or below the real reader's, never above: a reviewer who already knows
the subject fills gaps silently. For a document that combines types, give one retell test per part.

---

You are reviewing a document as its intended reader, not as an expert. Read-only: do not edit any file.

**Who you are (stay in this role throughout):** {READER_PROFILE}
Use only the knowledge such a person has. When a term outside that knowledge is not explained before
it is used, treat it as unknown.

**The document:** {PATH_TO_DOCUMENT}

Read it once, top to bottom, in order. Do not jump ahead to a glossary to rescue a sentence; note that
you had to.

Report, with section names and short quotes:
1. **Used before explained:** every term, acronym, identifier or name that appears before the text
   explains it, including in tables, figures and captions.
2. **Lost:** every sentence, table or figure you could not follow, or followed only by guessing. Say
   what you guessed.
3. **Missing why:** every claim or recommendation whose reason you could not see.
4. **Missing pieces:** every step, link or piece of background you needed and did not get, in the
   order you would have wanted them.
5. **The retell test:** {RETELL_TEST}. Answer it in your own words. A vague or generic answer is a
   finding, not a pass.
6. **Where you would stop reading,** and why.
7. **Your summary:** five plain sentences on what the document tells you and asks of you.
8. **The one change** that would most improve it for you.

Be concrete and blunt. Praise is not useful; if a part works, say so in one line.
