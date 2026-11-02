/* =========================================================
   Course runtime
   - Course manifest (single source of truth for navigation)
   - Sidebar + progress rendering
   - Quiz engine (single/multi select, explanations, timer, scoring)
   Works from file:// — quiz banks are JS files that register into
   window.QUIZ_BANKS, not JSON fetched over HTTP.
   ========================================================= */

(function () {
  "use strict";

  // ---------- Course manifest ----------
  // `id` keys everything this course saves in the browser (best scores, an attempt in progress, the depth
  // choice), so every course needs its own; without one, a slug of `title` is used. `title` is the sidebar's
  // brand line. In MODULES, `file` is relative to the course root, `quiz` is the bank id registered by
  // quizzes/<quiz>.js, and `mins` is reading plus quiz. A module inserted later keeps its neighbours'
  // numbers: give it an `n` between theirs and a display `label`.
  const COURSE = { id: "example-course", title: "Example course" };
  const MODULES = [
    { n: 1, id: "m01", file: "modules/01-first-module.html", title: "First module title", quiz: "m01", mins: 120,
      blurb: "One sentence: what the learner can do after this module." },
    { n: 1.5, label: "01b", id: "m01b", file: "modules/01b-inserted-module.html", title: "A module inserted later", quiz: "m01b", mins: 90,
      blurb: "One sentence: what the learner can do after this module." },
    { n: 2, id: "m02", file: "modules/02-second-module.html", title: "Second module title", quiz: "m02", mins: 120,
      blurb: "One sentence: what the learner can do after this module." },
  ];
  // In EXAMS, `title` is what the sidebar and the last module's Next button show. Each exam page sets its own
  // question count and timer (data-count and data-timer on its .quiz div); keep the title in step with them.
  const EXAMS = [
    { id: "final-a", file: "exams/final-a.html", title: "Final exam A (65 questions, 130 min)" },
    { id: "final-b", file: "exams/final-b.html", title: "Final exam B (65 questions, 130 min)" },
    { id: "practice-mix", file: "exams/practice-mix.html", title: "Practice mix (40 random questions, untimed)" },
  ];
  // Optional pages for the sidebar's "Start here" list, only ones the course really has, for example
  //   { file: "principles.html", title: "The ideas the course stands on", mark: "★" },
  //   { file: "story.html", title: "The story (all episodes)", mark: "☰" }
  const PAGES = [];
  const PASS_PCT = 72;

  window.COURSE = Object.assign(COURSE, { MODULES, EXAMS, PAGES, PASS_PCT });
  window.QUIZ_BANKS = window.QUIZ_BANKS || {};

  // ---------- Storage ----------
  // Every localStorage call sits in a try: a browser can block storage (for example when its privacy settings
  // block site data), and then any use of localStorage throws. The course still works; it remembers nothing.
  const slug = t => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const STORE = COURSE.id || slug(COURSE.title) || "course";   // the prefix of every key this course writes
  const KEY = STORE + ".v1";
  function loadState() {
    try { return JSON.parse(localStorage.getItem(KEY)) || { scores: {} }; }
    catch { return { scores: {} }; }
  }
  function saveState(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage full or blocked */ } }
  function bestScore(id) { const s = loadState().scores[id]; return s ? s.best : null; }
  function recordScore(id, pct, total) {
    const s = loadState();
    const prev = s.scores[id] || { best: 0, attempts: 0 };
    s.scores[id] = { best: Math.max(prev.best, pct), last: pct, attempts: prev.attempts + 1, total, at: new Date().toISOString() };
    saveState(s);
  }
  window.COURSE.bestScore = bestScore;
  window.COURSE.resetProgress = function () { try { localStorage.removeItem(KEY); } catch { /* blocked */ } location.reload(); };

  // ---------- Utilities ----------
  function rootPrefix() {
    // Pages live at root (index.html), modules/, or exams/. Compute "../" as needed.
    const p = location.pathname.replace(/\\/g, "/");
    return (/\/(modules|exams)\/[^/]*$/.test(p)) ? "../" : "";
  }
  function el(tag, attrs, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") e.className = v;
      else if (k === "html") e.innerHTML = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const c of children) if (c != null) e.append(c);
    return e;
  }
  function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  // mulberry32, a small seeded random generator by Tommy Ettinger (2017, public domain under CC0):
  // gist.github.com/tommyettinger/46a874533244883189143505d203312c. A saved seed replays the same question order.
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function fmtTime(sec) { const m = Math.floor(sec / 60), s = sec % 60; return `${m}:${String(s).padStart(2, "0")}`; }

  // ---------- Sidebar ----------
  function currentModule() {
    const p = location.pathname.replace(/\\/g, "/");
    return MODULES.find(m => p.endsWith("/" + m.file) || p.endsWith(m.file.split("/").pop()))
        || EXAMS.find(e => p.endsWith("/" + e.file) || p.endsWith(e.file.split("/").pop()));
  }
  function renderSidebar() {
    const host = document.querySelector("[data-sidebar]");
    if (!host) return;
    const pre = rootPrefix();
    const cur = currentModule();
    const state = loadState();
    const passed = MODULES.filter(m => (state.scores[m.quiz]?.best || 0) >= PASS_PCT).length;

    host.innerHTML = "";
    host.append(el("a", { class: "brand", href: pre + "index.html" }, COURSE.title));
    const wrap = el("div", { class: "progress-wrap" });
    wrap.append(el("div", { class: "small" }, `Modules passed: ${passed} / ${MODULES.length}`));
    const bar = el("div", { class: "bar" }, el("div", { style: `width:${Math.round(100 * passed / MODULES.length)}%` }));
    wrap.append(bar);
    host.append(wrap);

    if (PAGES.length) {
      host.append(el("h2", {}, "Start here"));
      const ol0 = el("ol");
      const p = location.pathname.replace(/\\/g, "/");
      PAGES.forEach(pg => {
        ol0.append(el("li", {}, el("a", { href: pre + pg.file, class: p.endsWith("/" + pg.file) ? "active" : "" },
          el("span", { class: "num" }, pg.mark || "★"), el("span", {}, pg.title))));
      });
      host.append(ol0);
    }

    host.append(el("h2", { style: "margin-top:18px" }, "Modules"));
    const ol = el("ol");
    for (const m of MODULES) {
      const best = state.scores[m.quiz]?.best;
      const a = el("a", { href: pre + m.file, class: cur && cur.id === m.id ? "active" : "" },
        el("span", { class: "num" }, m.label || String(m.n).padStart(2, "0")),
        el("span", {}, m.title),
        best != null ? el("span", { class: "done", title: `Best quiz score ${best}%` }, best >= PASS_PCT ? "✅" : "🟡") : null);
      ol.append(el("li", {}, a));
    }
    host.append(ol);

    if (EXAMS.length) {
      host.append(el("h2", { style: "margin-top:18px" }, "Final exams"));
      const ol2 = el("ol");
      for (const e of EXAMS) {
        const best = state.scores[e.id]?.best;
        ol2.append(el("li", {}, el("a", { href: pre + e.file, class: cur && cur.id === e.id ? "active" : "" },
          el("span", { class: "num" }, "★"), el("span", {}, e.title),
          best != null ? el("span", { class: "done" }, best >= PASS_PCT ? "✅" : "🟡") : null)));
      }
      host.append(ol2);
    }
    host.append(el("p", { class: "small", style: "margin-top:18px" },
      `Pass mark ${PASS_PCT}%. Progress is stored in this browser only. `,
      el("a", { href: "#", onclick: (ev) => { ev.preventDefault(); if (confirm("Reset all quiz progress?")) window.COURSE.resetProgress(); } }, "Reset")));
  }

  // ---------- Pager (prev/next) ----------
  function renderPager() {
    const host = document.querySelector("[data-pager]");
    if (!host) return;
    const cur = currentModule();
    if (!cur || cur.n == null) return;
    const pre = rootPrefix();
    const idx = MODULES.findIndex(m => m.id === cur.id);
    const prev = idx > 0 ? MODULES[idx - 1] : null;
    const next = idx >= 0 && idx < MODULES.length - 1 ? MODULES[idx + 1] : null;
    host.innerHTML = "";
    host.append(prev ? el("a", { class: "btn secondary", href: pre + prev.file }, "← " + prev.title) : el("span"));
    host.append(next ? el("a", { class: "btn next", href: pre + next.file }, next.title + " →")
                     : EXAMS.length ? el("a", { class: "btn next", href: pre + EXAMS[0].file }, "Take " + EXAMS[0].title + " →") : el("span"));
  }

  // ---------- Quiz engine ----------
  // Usage: <div class="quiz" data-quiz="m02" data-count="18" data-timer="0" data-title="Module 2 quiz"></div>
  // Bank format (quizzes/<id>.js):
  //   window.QUIZ_BANKS["m02"] = [{ id, type:"single"|"multi", domain, difficulty, scenario?, question,
  //                                 options:[{text, correct, why}], explanation }]
  // For finals: data-quiz="final-a" can also use data-from="m01,m02,..." to sample from module banks.
  // An attempt in progress (seed, answers, deadline) is saved per quiz, so a reload or a closed tab keeps it.
  const ATTEMPT_KEY = STORE + ".attempt.";
  function bankFingerprint(bank) { return bank.length + ":" + bank.map(q => q.id).join(",").length; }
  function loadAttempt(id, fp) {
    try { const a = JSON.parse(localStorage.getItem(ATTEMPT_KEY + id)); return a && a.fp === fp ? a : null; }
    catch { return null; }
  }
  function saveAttempt(id, a) { try { localStorage.setItem(ATTEMPT_KEY + id, JSON.stringify(a)); } catch { /* storage full or blocked */ } }
  function clearAttempt(id) { try { localStorage.removeItem(ATTEMPT_KEY + id); } catch { /* blocked */ } }

  function renderQuiz(host, fresh) {
    const bankId = host.dataset.quiz;
    const title = host.dataset.title || "Knowledge check";
    let bank = window.QUIZ_BANKS[bankId];
    if (!bank && host.dataset.from) {
      bank = host.dataset.from.split(",").flatMap(k => window.QUIZ_BANKS[k.trim()] || []);
    }
    if (!bank || !bank.length) {
      host.innerHTML = `<h2>${title}</h2><p class="muted">Quiz bank "${bankId}" not found. Make sure <code>quizzes/${bankId}.js</code> is included on this page.</p>`;
      return;
    }
    const count = Math.min(parseInt(host.dataset.count || bank.length, 10), bank.length);
    const timerMin = parseInt(host.dataset.timer || "0", 10);
    const fp = bankFingerprint(bank) + ":" + count + ":" + timerMin;
    if (fresh) clearAttempt(bankId);
    const saved = loadAttempt(bankId, fp);
    const attempt = saved || { fp, seed: Date.now() & 0xffffffff, answers: {}, deadline: timerMin > 0 ? Date.now() + timerMin * 60000 : 0 };
    if (!saved) saveAttempt(bankId, attempt);
    const rng = mulberry32(attempt.seed);
    const picked = shuffle(bank, rng).slice(0, count).map(q => ({
      ...q,
      _opts: shuffle(q.options.map((o, i) => ({ ...o, _i: i })), rng),
    }));

    host.innerHTML = "";
    host.append(el("h2", {}, title));
    const meta = el("div", { class: "quiz-meta" });
    const multiCount = picked.filter(q => q.type === "multi").length;
    meta.append(el("span", {}, `${count} questions`), el("span", {}, `${multiCount} multi-select`), el("span", {}, `Pass mark ${PASS_PCT}%`));
    const timerEl = el("span", { class: "timer", role: "timer", "aria-label": "Time remaining" });
    if (timerMin > 0) meta.append(timerEl);
    const best = bestScore(bankId);
    if (best != null) meta.append(el("span", {}, `Your best: ${best}%`));
    host.append(meta);
    host.append(el("p", { class: "muted", style: "font-size:14px" },
      "Read each scenario carefully. Multi-select questions state how many answers to choose. Every option has an explanation, shown after you submit; read the wrong ones too, that is where the learning is. Your answers" +
      (timerMin > 0 ? " and the timer" : "") + " are saved in this browser, so a reload continues the same attempt."));
    if (saved && Object.keys(saved.answers).length) host.append(el("p", { class: "muted", style: "font-size:14px" }, "Resumed your saved attempt."));
    const live = el("div", { class: "sr-only", "aria-live": "polite" });
    host.append(live);

    const form = el("form", { onsubmit: (e) => { e.preventDefault(); grade(false); } });
    picked.forEach((q, qi) => {
      const qEl = el("div", { class: "q", id: `${bankId}-${qi}` });
      const nCorrect = q.options.filter(o => o.correct).length;
      const kind = q.type === "multi" ? `Choose ${nCorrect}` : "Choose one";
      const head = el("div", { class: "q-head", "aria-hidden": "true" },
        el("span", { class: "q-num" }, `Q${qi + 1}`),
        el("span", { class: "q-domain" }, q.domain || "General"),
        el("span", { class: "q-type" }, kind));
      qEl.append(head);
      if (q.scenario) qEl.append(el("div", { class: "scenario-text", html: q.scenario }));
      const qText = el("div", { class: "q-text", id: `${bankId}-${qi}-text`, html: q.question });
      qEl.append(qText);
      const fs = el("fieldset", { class: "q-fieldset", "aria-describedby": `${bankId}-${qi}-text` },
        el("legend", { class: "sr-only" }, `Question ${qi + 1} of ${count}, ${q.domain || "General"}, ${kind}`));
      const ul = el("ul", { class: "opts" });
      const prev = new Set(attempt.answers[qi] || []);
      q._opts.forEach((o) => {
        const input = el("input", { type: q.type === "multi" ? "checkbox" : "radio", name: `q${qi}`, value: String(o._i) });
        if (prev.has(o._i)) input.checked = true;
        input.addEventListener("change", () => {
          attempt.answers[qi] = [...qEl.querySelectorAll("input:checked")].map(i => parseInt(i.value, 10));
          saveAttempt(bankId, attempt);
        });
        const li = el("li", {}, el("label", {}, input, el("span", { html: o.text })));
        li.dataset.i = o._i;
        ul.append(li);
      });
      fs.append(ul);
      qEl.append(fs);
      form.append(qEl);
    });
    const submit = el("button", { class: "btn", type: "submit" }, "Submit answers");
    form.append(el("div", { style: "margin-top:18px; display:flex; gap:10px; flex-wrap:wrap" }, submit,
      el("button", { class: "btn secondary", type: "button", onclick: () => {
        const answered = Object.values(attempt.answers).filter(a => a.length).length;
        if (answered && !confirm("Start a new random set? Your current answers will be discarded.")) return;
        if (tick) clearInterval(tick);
        renderQuiz(host, true);
      } }, "New random set")));
    host.append(form);

    // Timer: counts down to the saved deadline, so a reload does not reset it
    let tick = null;
    if (timerMin > 0) {
      const left = () => Math.max(0, Math.round((attempt.deadline - Date.now()) / 1000));
      const draw = () => {
        const r = left();
        timerEl.textContent = "⏱ " + fmtTime(r);
        if (r <= 300) timerEl.classList.add("low");
        return r;
      };
      const announced = new Set();
      if (draw() <= 0) { setTimeout(() => grade(true), 0); }
      else tick = setInterval(() => {
        const r = draw();
        for (const mark of [600, 300, 60]) if (r <= mark && !announced.has(mark)) { announced.add(mark); live.textContent = `${mark / 60} minute${mark > 60 ? "s" : ""} remaining.`; }
        if (r <= 0) { clearInterval(tick); alert("Time is up. Your answers will be graded now."); grade(true); }
      }, 1000);
    }

    function grade(timeUp) {
      if (!timeUp) {
        const unanswered = picked.filter((q, qi) => !(attempt.answers[qi] || []).length).length;
        if (unanswered && !confirm(`${unanswered} question${unanswered > 1 ? "s are" : " is"} unanswered. Submit anyway?`)) return;
      }
      if (tick) clearInterval(tick);
      clearAttempt(bankId);
      let correctCount = 0;
      const byDomain = {};
      picked.forEach((q, qi) => {
        const qEl = form.querySelector(`#${CSS.escape(bankId + "-" + qi)}`);
        const chosen = new Set([...qEl.querySelectorAll("input:checked")].map(i => parseInt(i.value, 10)));
        const correct = new Set(q.options.map((o, i) => o.correct ? i : -1).filter(i => i >= 0));
        const isRight = chosen.size === correct.size && [...chosen].every(i => correct.has(i));
        if (isRight) correctCount++;
        const d = q.domain || "General";
        byDomain[d] = byDomain[d] || { right: 0, total: 0 };
        byDomain[d].total++; if (isRight) byDomain[d].right++;

        qEl.querySelectorAll("input").forEach(i => i.disabled = true);
        qEl.querySelectorAll("li").forEach(li => {
          const i = parseInt(li.dataset.i, 10);
          const o = q.options[i];
          let mark = "";
          if (o.correct && chosen.has(i)) { li.classList.add("correct"); mark = "Your choice, correct. "; }
          else if (o.correct && !chosen.has(i)) { li.classList.add("missed"); mark = "Correct option you missed. "; }
          else if (!o.correct && chosen.has(i)) { li.classList.add("wrong"); mark = "Your choice, incorrect. "; }
          if (mark) li.querySelector("label").prepend(el("span", { class: "sr-only" }, mark));
          if (o.why) li.append(el("div", { class: "why", html: (o.correct ? "✔ " : "✘ ") + o.why }));
        });
        qEl.append(el("div", { class: "verdict " + (isRight ? "ok" : "bad") }, isRight ? "Correct" : "Incorrect"));
        if (q.explanation) qEl.append(el("div", { class: "explain", html: q.explanation }));
      });
      const pct = Math.round(100 * correctCount / picked.length);
      recordScore(bankId, pct, picked.length);
      const res = el("div", { class: "result " + (pct >= PASS_PCT ? "pass" : "fail"), tabindex: "-1", role: "status" });
      res.append(el("div", { class: "score" }, `${pct}%  (${correctCount}/${picked.length})`));
      res.append(el("div", {}, pct >= PASS_PCT ? "Pass. Re-read the explanations on anything you missed anyway." : `Below the ${PASS_PCT}% pass mark. Review the weakest domains below, re-read those sections, then take a new random set.`));
      const t = el("table");
      t.append(el("tr", {}, el("th", { scope: "col" }, "Domain"), el("th", { scope: "col" }, "Score")));
      Object.entries(byDomain).sort((a, b) => (a[1].right / a[1].total) - (b[1].right / b[1].total)).forEach(([d, v]) => {
        t.append(el("tr", {}, el("td", {}, d), el("td", {}, `${v.right}/${v.total}`)));
      });
      res.append(t);
      form.querySelector("button[type=submit]").disabled = true;
      host.append(res);
      res.scrollIntoView({ behavior: "smooth", block: "start" });
      res.focus({ preventScroll: true });
      renderSidebar();
    }
  }

  // ---------- Index page cards ----------
  function renderIndexCards() {
    const host = document.querySelector("[data-module-cards]");
    if (!host) return;
    const state = loadState();
    host.innerHTML = "";
    for (const m of MODULES) {
      const best = state.scores[m.quiz]?.best;
      const card = el("a", { class: "module-card", href: m.file },
        el("div", { class: "n" }, `Module ${m.label || String(m.n).padStart(2, "0")} · ~${m.mins} min`),
        el("h3", {}, m.title),
        el("p", {}, m.blurb || ""),
        best != null ? el("span", { class: "score-badge " + (best >= PASS_PCT ? "pass" : "fail") }, `Best quiz: ${best}%`) : el("span", { class: "score-badge" }, "Not attempted"));
      host.append(card);
    }
  }

  // ---------- Core path / full module ----------
  // Authors mark deep-dive material with data-depth="reference" on an <h2>/<h3> (hides the heading
  // and everything up to the next heading of the same or higher level) or on any block element.
  // Some blocks are reference by default: labs (.lab), the "explain it back" prompts (#self-check, but
  // never the quiz), further reading (#reading), the flavors table, scenario cards after the second,
  // and tables. data-depth="core" overrides a default.
  const DEPTH_KEY = STORE + ".depth";
  function wordsIn(el) { return (el.innerText || "").split(/\s+/).filter(Boolean).length; }
  function sectionRange(h) {
    // all following siblings until the next heading of same-or-higher level
    const lvl = parseInt(h.tagName[1], 10);
    const out = [h];
    let n = h.nextElementSibling;
    while (n) {
      if (/^H[1-6]$/.test(n.tagName) && parseInt(n.tagName[1], 10) <= lvl) break;
      out.push(n); n = n.nextElementSibling;
    }
    return out;
  }
  function setupDepth() {
    const main = document.querySelector("main.content");
    if (!main || !document.querySelector("[data-quiz]")) return;          // module pages only
    if (!currentModule() || currentModule().n == null) return;
    const meta = main.querySelector(".meta");
    if (!meta) return;

    // 1. Collect reference material.
    const refEls = new Set();
    main.querySelectorAll('[data-depth="reference"]').forEach(el => {
      if (/^H[1-6]$/.test(el.tagName)) sectionRange(el).forEach(e => refEls.add(e)); else refEls.add(el);
    });
    ["self-check", "reading"].forEach(id => {
      const h = main.querySelector("#" + id);
      if (h && h.dataset.depth !== "core") sectionRange(h).forEach(e => refEls.add(e));
    });
    main.querySelectorAll(".lab, .flavors").forEach(e => { if (e.dataset.depth !== "core") refEls.add(e); });
    main.querySelectorAll(".scenario-card").forEach((e, i) => { if (i >= 2 && e.dataset.depth !== "core") refEls.add(e); });
    main.querySelectorAll("table").forEach(t => {
      if (t.closest(".quiz, .flavors, .lab, .console-mock, .core-ideas, .episode-end")) return;
      if (t.dataset.depth !== "core" && !t.closest('[data-depth="core"]')) refEls.add(t);
    });
    // never hide these
    main.querySelectorAll(".quiz, .pager, .episode, .episode-end, .core-ideas, .objectives, .takeaways, .meta, h1, .lead").forEach(e => refEls.delete(e));

    // 2. Mark; count the hidden words once (an element inside another hidden one is already counted).
    const isHidden = e => !!e && e.classList.contains("depth-hidden");
    refEls.forEach(e => e.classList.add("depth-hidden"));
    const outer = [...refEls].filter(e => !e.parentElement.closest(".depth-hidden"));
    const skipWords = outer.reduce((s, e) => s + wordsIn(e), 0);
    const total = wordsIn(main) - [...main.querySelectorAll(".quiz")].reduce((s, q) => s + wordsIn(q), 0);
    // 3. A skip note before each hidden heading or lab, unless a hidden heading of a higher level just above
    //    it already covers it (an h3 inside a hidden h2 section). A heading's note counts its hidden run.
    const isHead = e => /^H[23]$/.test(e.tagName);
    const level = e => isHead(e) ? +e.tagName[1] : 9;
    const covered = e => {
      for (let n = e.previousElementSibling; isHidden(n); n = n.previousElementSibling) if (isHead(n) && level(n) < level(e)) return true;
      return false;
    };
    const starts = outer.filter(e => (isHead(e) || e.classList.contains("lab")) && !covered(e));
    starts.forEach(e => {
      let w = wordsIn(e);
      if (isHead(e)) for (let n = e.nextElementSibling; isHidden(n) && !starts.includes(n); n = n.nextElementSibling) w += wordsIn(n);
      const head = isHead(e) ? e : e.querySelector("h2, h3, h4");
      const name = head ? head.textContent.trim() : "Lab";
      e.parentNode.insertBefore(el("div", { class: "core-skip" },
        `Skipped on the core path: "${name}" (~${Math.max(1, Math.round(w / 200))} min). `,
        el("a", { href: "#", onclick: (ev) => { ev.preventDefault(); setMode("full"); } }, "Show full module")), e);
    });
    // A "Reference" badge on every hidden heading, seen in the full module.
    main.querySelectorAll("h2.depth-hidden, h3.depth-hidden").forEach(h => {
      if (!h.querySelector(".ref-badge")) h.append(el("span", { class: "ref-badge", title: "Not on the core path" }, "Reference"));
    });

    const coreMin = Math.max(5, Math.round((total - skipWords) / 200));
    const fullMin = Math.max(coreMin, Math.round(total / 200));

    // 4. Toggle UI.
    const seg = el("div", { class: "seg" });
    const bCore = el("button", { type: "button", onclick: () => setMode("core") }, `Core path · ~${coreMin} min`);
    const bFull = el("button", { type: "button", onclick: () => setMode("full") }, `Full module · ~${fullMin} min`);
    seg.append(bCore, bFull);
    const bar = el("div", { class: "depth-toggle" },
      el("strong", {}, "How deep today?"), seg,
      el("span", { class: "est" }, `Reading time only; quiz and labs are extra.`),
      el("span", { class: "hint" }, "Core path keeps the ideas, explanations, diagrams, story and quiz. It hides labs, deep-dive sections, extra scenarios, comparison tables, the explain-it-back prompts and further reading. Your choice is remembered across modules."));
    meta.insertAdjacentElement("afterend", bar);

    function setMode(m) {
      try { localStorage.setItem(DEPTH_KEY, m); } catch { /* blocked: the choice lasts until the page closes */ }
      document.body.classList.toggle("core-path", m === "core");
      bCore.classList.toggle("on", m === "core");
      bFull.classList.toggle("on", m !== "core");
    }
    // A link to hidden material (a "Lab 1" pointer, a cross-reference) shows the full module, then jumps.
    document.addEventListener("click", (ev) => {
      const a = ev.target.closest && ev.target.closest('a[href^="#"]');
      if (!a || !document.body.classList.contains("core-path")) return;
      const t = document.getElementById(a.getAttribute("href").slice(1));
      if (t && t.closest(".depth-hidden")) setMode("full");
    });
    let saved = null;
    try { saved = localStorage.getItem(DEPTH_KEY); } catch { /* blocked */ }
    setMode(saved || "full");
  }
  window.COURSE.setupDepth = setupDepth;

  // ---------- On this page: right-hand contents panel ----------
  // Built from the page's own h2/h3 headings, so it never needs per-module edits. Sections hidden by the
  // depth switch carry .depth-hidden and are hidden in the panel on the core path by CSS.
  function setupToc() {
    const main = document.querySelector("main.content");
    const layout = document.querySelector(".layout");
    if (!main || !layout || document.querySelector("nav.toc")) return;
    if (!/\/modules\//.test(location.pathname.replace(/\\/g, "/"))) return;
    const skip = ".quiz, .episode, .episode-end, .objectives, .core-ideas, .takeaways, .flavors, .callout, .scenario-card, .console-mock, [data-widget], .meta";
    const heads = [...main.querySelectorAll("h2, h3")].filter(h => !h.closest(skip));
    if (heads.filter(h => h.tagName === "H2").length < 3) return;
    const used = new Set([...document.querySelectorAll("[id]")].map(e => e.id));
    const label = h => { const c = h.cloneNode(true); c.querySelectorAll(".ref-badge").forEach(b => b.remove()); return c.textContent.trim(); };
    const slug = t => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "part";
    heads.forEach(h => {
      if (h.id) return;
      let id = "s-" + slug(label(h)), n = 2;
      while (used.has(id)) id = "s-" + slug(label(h)) + "-" + n++;
      h.id = id; used.add(id);
    });
    const nav = el("nav", { class: "toc", "aria-label": "On this page" }, el("div", { class: "toc-title" }, "On this page"));
    const top = el("ol");
    const items = [];
    let group = null;
    heads.forEach(h => {
      const a = el("a", { href: "#" + h.id }, label(h));
      const li = el("li", { class: (h.tagName === "H2" ? "toc-h2" : "toc-h3") + (h.closest(".depth-hidden") ? " toc-ref" : "") }, a);
      if (h.tagName === "H2" || !group) {
        group = { li, sub: null };
        top.append(li);
      } else {
        if (!group.sub) { group.sub = el("ol", { class: "toc-sub" }); group.li.append(group.sub); }
        group.sub.append(li);
      }
      items.push({ h, li, a, parent: h.tagName === "H2" ? li : group.li });
    });
    nav.append(top);
    layout.append(nav);

    let ticking = false;
    function spy() {
      ticking = false;
      let current = null;
      for (const it of items) {
        if (it.h.offsetParent === null) continue;            // hidden by the depth switch
        if (it.h.getBoundingClientRect().top <= 110) current = it; else break;
      }
      items.forEach(it => { it.a.classList.toggle("active", it === current); it.li.classList.remove("open"); });
      if (current) {
        current.parent.classList.add("open");
        const r = current.a.getBoundingClientRect(), nr = nav.getBoundingClientRect();
        if (r.top < nr.top + 40 || r.bottom > nr.bottom - 20) nav.scrollTop += r.top - nr.top - nr.height / 3;
      }
    }
    window.addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(spy); } }, { passive: true });
    spy();
  }
  window.COURSE.setupToc = setupToc;

  // ---------- Boot ----------
  document.addEventListener("DOMContentLoaded", () => {
    renderSidebar();
    renderPager();
    renderIndexCards();
    document.querySelectorAll("[data-quiz]").forEach(renderQuiz);
    setupDepth();
    setupToc();
  });
})();
