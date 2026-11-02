# Code walkthrough

**The reader asks:** "What does this code do, and how?"

**Done when:** the reader can predict the code's output for a new input, and knows where to change it.

**Spine:**
1. **What the code does, in one sentence,** and where it sits in the larger system.
2. **One input, followed through the code in execution order,** file by file. Quote each piece where
   it runs, then say what it did to the input.
3. **The lines that matter,** pointed out after each quote; cut lines you do not explain.
4. **What would change the result:** settings, edge cases, error paths.
5. **Real output,** from actually running the code, labelled with the versions used.

**Main picture:** the path of the input through files and functions.

**Common failure:** describing files one by one in folder order instead of following the input.

**Retell test:** "What does this code return for this new input, and which line decides it?"

**Example:** how Brightside Books computes an order total. Follow order 5021 (two books at 12.00 and
8.50, discount code AUTUMN10) through `cart.py` (sums 20.50), `discounts.py` (applies 10%: 18.45) and
`tax.py` (adds VAT on the discounted total), printing 19.37.
