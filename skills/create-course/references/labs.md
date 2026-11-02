# Labs and screenshots

A lab simulates doing the work, for a learner who cannot run a real project during the course. It sits
inside the section it practises, right after the part that teaches it, numbered in page order
(`id="lab-N"`), 300 to 700 words.

## The shape of a lab

One concrete task, done the way a practitioner of this field would:

1. **The task** in one sentence, and why it matters here.
2. **The steps in the forms the field uses.** For cloud and infrastructure topics: the console click path
   with a rendered mock of the panel (an HTML replica with the lab's values, labelled as illustrative),
   the equivalent command line with realistic output, and the equivalent infrastructure-as-code. For a
   data topic: the query and its result. For a library: the code and its real output. Show every step;
   never skip one because it seems obvious.
3. **Verify it worked,** including a negative test (the request that must now fail, and the error it
   gives).
4. **Clean up,** if anything was created.
5. **What to notice:** the one or two things the lab was for.

Use realistic placeholder ids, never real ones. When a step is not documented by the vendor, say so and
label it a Guess.

## Real console screenshots

Do not take screenshots of the user's consoles on your own initiative. When the user signs in and asks
for captures:

- Work read-only: open create forms and settings pages, type placeholder values, and never click
  Create, Save, Enable, Delete, or a consent banner.
- On an account picker, choose only an account the user named for this; ask if none is shown or you
  cannot tell.
- Avoid pages that list real resources. Crop account, tenant and project ids and avatars, and check every
  image before keeping it.
- Vendor documentation screenshots are copyrighted; do not copy them.

Place each capture next to the matching mock, as a captioned figure.
