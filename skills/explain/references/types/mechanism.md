# Mechanism

**The reader asks:** "How does this technique work?" (an algorithm, a protocol, a design pattern, one
part of a system).

**Done when:** the reader can run the example through the mechanism by hand and predict what happens.

**Spine:**
1. **The core idea in one bold sentence,** stated as the problem it solves.
2. **Why the obvious way fails,** shown on the example.
3. **The mechanism as numbered steps,** with the example's values at every step.
4. **Each piece and the problem it stops,** in a small table, so every piece earns its place.
5. **The same idea elsewhere,** if it appears in another guise the reader knows.
6. **Common misreadings,** each marked right, partly right or wrong, with the reason.
7. **Look-alikes:** when two terms or objects are easy to confuse, separate them in a small table.

**Main picture:** a flow of the numbered steps, or a before-and-after.

**Common failure:** naming the parts without showing the example moving through them.

**Retell test:** "Take this new input and walk it through the steps."

**Example:** how Brightside Books' "customers also bought" list is computed.
1. Core: show books that people who bought this book also bought, ranked by how often.
2. Obvious way: "most popular books overall" shows the same five bestsellers on every page.
3. Steps: for *The Salt Road*, collect its 412 orders → count the other books in those orders →
   *Tide Tables* appears in 61 → divide by *Tide Tables'* overall popularity → rank → show the top 4.
4. Table: the division by overall popularity stops bestsellers from always winning.
