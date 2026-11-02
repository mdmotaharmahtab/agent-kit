# Reference

**The reader asks:** "What is X again?" They come to look one thing up, not to read top to bottom.

**Done when:** the reader can find the answer to a specific question in under half a minute.

**Spine:**
1. **One sentence on what this reference covers** and how it is ordered (alphabetical, by area).
2. **Entries, all in the same shape.** The same fields in the same order every time, so the eye knows
   where to look. Choose the fields once for this reference (for example: what it is, when to use it,
   the essential values, one example, the common mistake), then keep them for every entry.
3. **Cross-links** between entries that are used together.

A reference part of a longer document restates in lookup form what the main text teaches. A fact the
main text needs is taught there first, never only in the reference.

**Main picture:** a table or a card per entry; no narrative.

**Common failure:** entries in different shapes, so every lookup starts with working out the layout.

**Retell test:** "Find the answer to this specific question. How long did it take?"

**Example:** Brightside Books' order API.

| Endpoint | Does | Required fields | Example | Common mistake |
|---|---|---|---|---|
| `POST /orders` | Creates an order | `customer_id`, `items` | `{"customer_id": 88, "items": [{"isbn": "9780000000017", "qty": 1}]}` | Sending a price; the server sets prices |
| `GET /orders/{id}` | Returns one order | none | `GET /orders/5021` | Expecting deleted orders to return 404; they return `status: cancelled` |
