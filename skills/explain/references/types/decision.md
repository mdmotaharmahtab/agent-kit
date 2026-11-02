# Decision

**The reader asks:** "Which option should we choose?" They must decide, or defend a decision.

**Done when:** the reader can make the choice and defend it to someone who prefers another option.

**Spine:**
1. **The recommendation and its main reason,** first.
2. **What must be true of any answer:** the criteria, each with why it matters here.
3. **The options against the criteria,** in one table whose columns are explained first.
4. **When each option wins:** the conditions under which the other choices would be right. This is
   what makes the recommendation trustworthy.
5. **Risks of the recommendation,** and how to notice early that it was wrong.
6. **What it costs to change course later.**

**Main picture:** the criteria table.

**Common failure:** a table of features with no criteria, leaving the reader to decide what matters.

**Retell test:** "Someone prefers option B. Argue for the recommendation, and say when they would be
right."

**Example:** Brightside Books choosing a database for orders. Recommendation: PostgreSQL, because orders
need transactions across several tables (order, stock, payment) and the shop's traffic fits one
server for years. DynamoDB wins if traffic grows a hundredfold or the access patterns are simple
key lookups.
