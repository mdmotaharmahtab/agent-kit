---
name: explain
description: Explain anything so the intended reader understands it on the first read, in chat or in a document. Use for chat explanations, guides, reports, design and architecture write-ups, how-tos, reference pages, decision documents, code walkthroughs and review write-ups (not the review of a change itself); when the user asks to "explain", "help me understand", "write this up" or "document this"; and whenever the user says they do not understand an explanation. Not for courses with lessons and exams (use create-course), code comments or commit messages.
---

# Explain

An explanation works when the reader can retell it after one read. Everything here serves that.
Read the core every time. For a document, also pick its type (section 3) and read that type's page.

## 1. The core (every explanation, any size)

1. **Answer first.** The first one or two sentences give the point in plain words, before any
   background. Then say what exists today, what is proposed, and what is only illustrative.
   *Because* a reader who knows where you are going, and what is real, can place every later detail.
2. **Know the reader.** Before writing, say in one line who reads it, what they already know, and
   what they need to do with it. Write for the least-informed reader it must serve. *Because* most
   bad explanations are written for the author.
3. **Define before use, one name per thing.** No term, acronym, label or identifier before its plain
   explanation, including in tables, figures and captions. Describe the thing first, name it second,
   and call it the same name every time; never use one word for two things. Everyday words may be
   used in their everyday sense; a word with a special meaning in the subject is defined before that
   meaning is used. Expand an acronym at first use. When two things are easy to confuse, separate
   them where they first appear together. *Because* one undefined word stops a reader cold, and two
   names for one thing make them think there are two things.
4. **One concrete example with real values,** introduced early and reused whenever the idea returns.
   For each step the reader will look up, code or do, show its hands-on form at the step: where (file,
   sheet or table, column, command), the value used, and one real result. *Because* an abstract rule
   clicks only when the reader sees it act on something specific.
5. **Core idea first, complications second.** State the simple idea and the problem it solves; add
   each complication as "the core, plus this, because of this problem". Point out when two things
   that look different are the same idea. When a tool automates work people do, that work is the
   core: show it done by hand before the tool. *Because* the reader needs a frame before the exceptions.
6. **Explain, do not list.** Every item says what it is for or what goes wrong without it. A list of
   names is not an explanation. *Because* names give the reader nothing to reason with.
7. **Plain words, short sentences.** About 20 words, one idea each. No preambles ("note that",
   "it is worth noting"), no stacked hedges, no jargon hiding a simple idea, no em dashes (use a
   comma, a colon or a new sentence). *Because* effort spent
   decoding the sentence is effort taken from the idea.
8. **As short as understanding allows.** Cut anything the reader does not need. Never cut something
   they do need: if they would ask "but what is that?", it is missing. *Because* length is a cost,
   and a gap is a bigger one.
9. **Check the order before sending.** Read top to bottom as the reader: every term, example and
   figure label must already have been introduced where it appears. *Because* things moved or
   inserted late are the most common source of "used before explained".
10. **Be right, and say how sure you are.** Check facts against a source before writing them. Mark
    what is a guess. *Because* one confident error costs the reader's trust in everything else.

## 2. Sizes

| Size | When | Adds to the core |
|---|---|---|
| Chat answer | Any answer in conversation | Nothing. Two to five sentences for the answer, detail only as needed, at most one small table |
| Short document | Up to about 1,000 words | A "Who this is for" of one or two short sentences; one figure per key idea; run the checks (`references/checks.md`) |
| Long document | More than about 1,000 words | All of the above; a sample before writing the rest (section 4, step 3); a newcomer review (`references/review-prompt.md`) before showing the whole |

## 3. Pick the type

A document's shape follows the question its reader brings. Name the type in the plan; if it is
unclear, ask. Each type's page gives its spine, its main picture, its common failure and its retell
test: the question a reviewer asks to check it worked.

| The reader asks | Type | Page |
|---|---|---|
| "How does this whole system work?" | System walkthrough | `references/types/system.md` |
| "How does this technique or mechanism work?" | Mechanism | `references/types/mechanism.md` |
| "How do I do this?" | How-to | `references/types/how-to.md` |
| "What is X again?" | Reference | `references/types/reference.md` |
| "Which option should we choose?" | Decision | `references/types/decision.md` |
| "What did you find, and what should we do?" | Findings | `references/types/findings.md` |
| "What is this unfamiliar field or file?" | Domain explainer | `references/types/domain.md` |
| "What does this code do?" | Code walkthrough | `references/types/code.md` |

A document may combine types (a findings report with a reference appendix). Give each part its own
type's shape and its own retell test, rather than one shape for everything. Where a later part's spine
repeats what an earlier part covered, make that item a one-line pointer. When the subject is a
code repository, choose by the reader's question: how it runs end to end is a system walkthrough,
what one piece of code does is a code walkthrough; link the two rather than merging them.

The pages use one made-up example throughout, a small online bookshop called Brightside Books, so
the same subject shows how each type explains differently.

## 4. Documents: the process

1. **Investigate read-only first,** so the plan rests on the real material.
2. **Plan, and wait for approval.** The plan states the reader line, the type (or types), the running
   example, the outline in that type's spine, and the figures.
3. **Long documents: write a sample first:** the opening plus one section of each type the document
   combines (not necessarily the first sections), so every element the document will repeat appears
   once. Get the user's read on level and format before writing the rest.
4. **Write,** following the core and the type's page.
5. **Check:** the order pass, the consistency pass and the figure check in `references/checks.md`,
   plus the mechanical checker `references/check_explainer.py` (HTML or Markdown).
6. **Review long documents** with a read-only newcomer reviewer (`references/review-prompt.md`), given
   the type's retell test. The writer runs it unless whoever assigned the work said they would. Fix by
   cutting before explaining: a reviewer's question shows a gap, not always a need, so before defining
   part of an identifier, an internal label or a source's history, ask whether it changes what the
   reader does; if not, cut it. Put each accepted fix where it is first needed.
7. **Report** the reader line used, what the review found and fixed, and what could not be verified.

Formats: HTML documents start from `references/template.html` (offline, no external fetches, a
contents sidebar, inline SVG figures). Markdown and Word follow the same rules without the HTML parts;
in Markdown and chat, figures are tables, fenced text diagrams or Mermaid.

## 5. When the reader says they do not understand

1. **Explain first,** plainly and from the top, before any tool call or edit. Do not lean on the
   explanation that failed.
2. **Then name the gap:** which part of the explanation assumed something the reader did not have.
3. **Then say what you will change,** and change it only if that was already agreed.

"I do not understand X" is a request to be taught X, not to rewrite X. Treat it as a sign the reader
line was wrong somewhere, not as a wording problem.

---

*This skill was made with the help of Claude.*
