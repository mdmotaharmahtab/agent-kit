/* Plays the current game page to the end: meets map nodes, clicks request parts, solves choice / sort / order
   challenges by trying options, plays mock terminals (tries commands until one runs) and exams (answers every
   question), then presses Continue. Returns a log: one line per stop, a flag where Continue stayed disabled,
   and any errors. Run from a page's console: await eval(await (await fetch('../../authoring/tools/autoplay.js')).text()) */
(async () => {
  const q = (s) => document.querySelector(s), qa = (s) => [...document.querySelectorAll(s)];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = []; const errors = [];
  window.addEventListener("error", (e) => errors.push(e.message));
  for (let guard = 0; guard < 60; guard++) {
    const title = (q("#panel h2") || q("#panel h3") || {}).textContent || "?";
    for (let pass = 0; pass < 5; pass++) {
      qa(".node.clickable").forEach((n) => n.dispatchEvent(new MouseEvent("click", { bubbles: true })));
      qa("#panel [data-k]").forEach((p) => { if (!p.closest(".order-pool")) p.click(); });
      qa("#panel button[data-tab], #panel .tab, #panel [role=tab]").forEach((b) => b.click());
      qa("#panel button.opt[data-ok='1']").forEach((b) => b.click());
      qa("#panel .sort-card").forEach((card) => {
        if (card.querySelector("button.right") || !card.querySelector(".btns")) return;
        for (const b of card.querySelectorAll(".btns button")) { b.click(); if (card.querySelector("button.right")) break; }
      });
      for (let t = 0; t < 80 && qa("#panel .order-pool button").length; t++) {
        for (const b of qa("#panel .order-pool button")) { const n = qa("#panel .order-pool button").length; b.click(); if (qa("#panel .order-pool button").length < n) break; }
      }
      for (let t = 0; t < 40 && qa("#panel .term-opts button").length; t++) {          // mock terminal
        const term = q("#panel pre.term"), before = term ? term.textContent.length : 0;
        for (const b of qa("#panel .term-opts button")) { b.click(); if (!term || term.textContent.length > before || !qa("#panel .term-opts button").length) break; }
      }
      for (let t = 0; t < 120 && q("#quizNext"); t++) {                                  // exam
        const opt = q("#panel .opts button.opt:not(.right):not(.wrong)") || q("#panel .opts button.opt");
        if (q("#quizCheck")) { if (opt) opt.click(); q("#quizCheck").click(); } else if (opt && q("#quizNext").disabled) opt.click();
        q("#quizNext").click(); await wait(5);
      }
      await wait(60);
    }
    const go = q("#go");
    log.push(`${guard}: ${title.trim()}${go && go.disabled ? "  <-- Continue still disabled" : ""}`);
    if (!go) { log.push("END: " + (qa("#panel .nav a button").map((b) => b.textContent.trim()).join(" / ") || "no finish button")); break; }
    if (go.disabled) break;
    go.click(); await wait(100);
  }
  return log.concat(errors.length ? ["ERRORS: " + errors.join(" | ")] : ["no errors"]).join("\n");
})()
