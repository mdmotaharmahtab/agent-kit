# Quiz bank format, exam rules and question-writing checklist

## Exam rules

Model the exams on cloud certification exams, not textbook recaps, so that a learner who only memorised terms
fails and one who understands the mechanics passes.

- A bank of 24 to 50 questions per module; the page shows a random 18.
- For a course size: two timed finals of 65 questions, written independently of each other and integrative (most
  questions span two or three modules, none duplicates a module question), and a practice mix.
- Pass mark about 72%, a per-domain breakdown, best scores kept.

## File format

One file per bank at `quizzes/<id>.js`. Two JavaScript wrapper lines around a
STRICT JSON array (double-quoted keys and strings, no trailing commas, no comments,
lowercase `true`/`false`, internal quotes escaped as `\"`). The checker runs
`json.loads` on the array.

```js
window.QUIZ_BANKS = window.QUIZ_BANKS || {};
window.QUIZ_BANKS["m02"] = [
  {
    "id": "m02-q01",
    "type": "single",
    "domain": "Token validation",
    "difficulty": "hard",
    "scenario": "A Python web API accepts JWTs issued by the company's identity provider ... (HTML allowed: <code>, <em>, <strong>, <br>)",
    "question": "What is the root cause of the vulnerability?",
    "options": [
      { "text": "...", "correct": true,  "why": "One or two sentences on why this is right." },
      { "text": "...", "correct": false, "why": "Why a half-informed engineer picks this and why it is wrong." },
      { "text": "...", "correct": false, "why": "..." },
      { "text": "...", "correct": false, "why": "..." }
    ],
    "explanation": "Two to four sentences stating the general principle tested."
  }
];
```

Fields:

| Field | Rule |
|---|---|
| `id` | unique in the bank, `mNN-qNN` |
| `type` | `single` (exactly 1 correct, 4 to 6 options) or `multi` (2 or 3 correct, 5 options) |
| `domain` | short label from the module's takeaways; drives the per-domain score table |
| `difficulty` | `medium` or `hard`; never `easy` |
| `scenario` | concrete setup; optional only if `question` itself is long and concrete |
| `question` | the ask; for multi include "Choose TWO" / "Choose THREE" |
| `options` | 4 to 6; each has `text`, `correct`, `why` |
| `explanation` | principle, not a restatement of the correct option |

Page wiring: `<div class="quiz" data-quiz="m02" data-count="18" data-title="Module 2 quiz"></div>`
plus `<script src="../quizzes/m02.js"></script>` before `app.js`. Finals add
`data-timer="130"` (minutes). A mixed page uses `data-from="m00,m01,..."`.

## Question-writing checklist

Before accepting a question, confirm:

- [ ] There is exactly one defensible answer set. A domain expert would not argue for a distractor.
- [ ] The scenario is needed to answer. Removing it should make the question unanswerable.
- [ ] Distractors are real mechanisms misapplied (right tool, wrong threat), not nonsense.
- [ ] At least one distractor is the "most paranoid" option that does not fit the constraint.
- [ ] Wording does not give the answer away (only option with a qualifier, etc.). Across the bank the correct
      option is the longest in no more than 20% of questions and not systematically the shortest;
      `tools/check_course.py` fails a bank above 20%. To fix, write replacement option texts into a quizfix JSON
      and run `authoring/rewrite/quizfix/apply.py`; a lengthened distractor must stay wrong for the reason its
      `why` gives.
- [ ] Multi-select states the count and the correct set is unambiguous.
- [ ] Every `why` teaches something; none says only "incorrect".
- [ ] `explanation` states the principle so the learner can transfer it.
- [ ] Domain tag matches a takeaway; every concept section has at least 2 questions.
- [ ] Across the bank: 60 to 70% single, 30 to 40% multi, about 60% hard, at least 2 "this design is acceptable" questions.
- [ ] About 5 hands-on questions per module, built on its snippets, labs and console steps: predict the output or
      failure of a snippet, pick the right call or setting, spot the misconfiguration, order the steps of a real setup.

## Good stems

- "What is the root cause?"
- "Which option is the MOST secure that still satisfies <constraint>?"
- "What happens next when <event>?"
- "Which TWO changes most directly reduce <specific risk>?"
- "What is wrong with this configuration?" (show the config)
- "In which order do these steps occur?"
- "The team proposes <design>. Is it acceptable, and why?"

## Stems to avoid

- "Which of the following is true about X?" (definition recall)
- "What does the acronym X stand for?"
- Options that are all correct except one obviously silly one.
