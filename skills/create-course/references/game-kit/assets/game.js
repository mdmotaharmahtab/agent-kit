/* Game course engine (version 2). Works offline, no build step.

   Layout: index.html (the world map) lists every world from assets/worlds.js, which also sets
   window.GAME_ID: progress is saved in this browser under that id. Each world lives in
   worlds/<id>/ with world.js (window.WORLD), index.html (the world hub) and its pages. A page loads
   ../../assets/game.css, ../../assets/worlds.js, world.js, ../../assets/game.js, then calls one of:
     GAME.level({ level: N, stops, phases })      a main-quest level (N indexes WORLD.levels)
     GAME.level({ side: "id", stops, phases })    a side quest (optional depth, from WORLD.sides)
     GAME.level({ bonus: "id", stops, phases })   a bonus mission: practice mission or exam (WORLD.bonus)

   WORLDS (assets/worlds.js) = [{ n, id, title, levels, d, ready }]: n orders the world map; levels is the
     main-quest level count shown as "2/3 levels"; ready: false dims a world not built yet, marked "(coming)"
     (its link still opens).
   WORLD = { id, title, blurb, levels: [{ n, file, title, d, final }], sides: [{ id, file, title, d, from }],
             bonus: [{ id, file, title, d, kind: "mission" | "exam" }], score: { rows, cols } | null }
     level.final = true marks the world's final level: it is labelled "Final level" (on the hub, "Final")
       instead of "Level N of M", it does not count in M, and buttons that lead to it show its title alone.
     side.from = the level number it branches from (its last button returns there).
     score.cols = [{ level, head, cells: [[ "yes"|"no"|"mid", text ], ...] }] (one cell per row).

   A stop is { phase, html, ready, enter(api), leave() }:
     phase  one of the page's phases (it lights the phase pill at the top)
     html   the panel content. Placeholders the engine fills after rendering:
              <div class="side-here" data-side="id"></div>   a card linking to that side quest
              <div class="cloud-here"></div>                 the Azure / AWS / neutral switch
     ready  true if Continue is enabled at once; false if a challenge must be solved first
     enter  runs after the html is shown; gets the api below
   The api:
     api.ready()                                   enable Continue
     api.choice(boxSel, fbSel, onRight, opts)      buttons.opt with data-ok="1|0" and data-fb="...";
                                                   opts.hold = true keeps Continue locked (a later challenge unlocks it);
                                                   options are shuffled unless opts.keepOrder (e.g. numeric scales)
     api.sort(sel, cards, buckets, onDone, opts)   cards: [{t, a, fb, wrong}], a = the right bucket;
                                                   wrong = {bucket: what goes wrong if you pick it}
     api.order(sel, steps, onDone, opts)           steps in the right order: [{t, why, early}]; shown shuffled
                                                   (sort, order and terminal also take opts.hold, like choice)
     api.parts(sel, texts, outSel, onEach)         clickable spans with data-k; texts[k] shown in outSel
     api.meet(texts, outSel, onAll, onEach)        click map nodes (data-meet="k") to unlock them
     api.terminal(sel, steps, onDone)              a mock console for practice missions:
                                                   steps: [{ say, choices: [{ cmd, ok, out, fb }] }]; the right
                                                   choice prints its output and moves on; a wrong one explains why
     api.quiz(sel, qs, opts)                       exam mode: qs = [{ q, options: [..], answer: index, why,
                                                   wrong: { index: text } }]; opts = { pass: 0.72, onDone(score) };
                                                   one question at a time, feedback after each, score at the end;
                                                   answer may be an array (choose all that apply).
                                                   GAME.fromBank(bank, n) converts a normal course's quiz bank (options shuffled);
                                                   GAME.shuffleOptions(q) shuffles one hand-written question
   Map helpers (also on GAME): light(ids), unlit(ids), mark(ids, cls), focus(id), packet(wireId, color)
   GAME.unlock(name) adds a concept chip; GAME.chips(sel) lists them. GAME.scorecard(sel, level) draws the
   world's scorecard so far. GAME.cloudSwitch(sel); elements with data-cloud="azure" etc. show only for the
   chosen cloud (remembered across the whole game). GAME.worldHub(sel) and GAME.worldMap(sel) draw the hubs. */
(function () {
"use strict";
const $ = (s) => document.querySelector(s);
/* One saved state per game, for all its worlds (the world map reads them all): the key is the game's id, or,
   for a game without one, its folder (the path up to /worlds/ or the root page). Two games never share it. */
const STORE = "game." + (window.GAME_ID || location.pathname.replace(/\/worlds\/[^/]+\/[^/]*$|\/[^/]*$/, ""));
const state = (() => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; } })();
state.worlds = state.worlds || {};
state.cloud = state.cloud || "azure";
function save() { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* private mode */ } }

const WORLD = window.WORLD || { id: "none", title: "", levels: [], sides: [], bonus: [], score: null };
WORLD.sides = WORLD.sides || []; WORLD.bonus = WORLD.bonus || [];
function wstate(id) {
  const w = state.worlds[id || WORLD.id] = state.worlds[id || WORLD.id] || { done: [], sides: [], bonus: {} };
  w.done = w.done || []; w.sides = w.sides || []; w.bonus = w.bonus || {};
  return w;
}
const LEVELS = WORLD.levels;

/* ---------- scorecard ---------- */
function scorecard(sel, level) {
  const el = typeof sel === "string" ? $(sel) : sel;
  if (!el || !WORLD.score) return;
  const W = wstate(), rows = WORLD.score.rows, all = WORLD.score.cols;
  const cols = all.filter((c) => c.level <= level || W.done.includes(c.level));
  const pending = all.filter((c) => !cols.includes(c));
  const head = `<tr><th>Question</th>${cols.map((c) => `<th class="${c.level === level ? "now" : ""}">${c.head}</th>`).join("")}${pending.map((c) => `<th>${c.head.split(".")[0]}. ?</th>`).join("")}</tr>`;
  const body = rows.map((r, i) => `<tr><td>${r}</td>${cols.map((c) =>
    `<td class="${c.cells[i][0]} ${c.level === level ? "now" : ""}">${c.cells[i][1]}</td>`).join("")}${pending.map(() => '<td class="q">?</td>').join("")}</tr>`).join("");
  el.innerHTML = `<div class="score-wrap"><table class="score">${head}${body}</table></div>`;
}

/* ---------- map helpers ---------- */
function light(ids) { ids.forEach((id) => { const el = document.getElementById(id); if (el) el.classList.add("lit"); }); }
function unlit(ids) { ids.forEach((id) => { const el = document.getElementById(id); if (el) el.classList.remove("lit"); }); }
function mark(ids, cls) { ids.forEach((id) => { const el = document.getElementById(id); if (el) { el.classList.remove("bad", "warn", "ok"); if (cls) el.classList.add(cls); } }); }
function focus(id) {
  document.querySelectorAll(".node").forEach((n) => n.classList.remove("focus"));
  if (id) { const el = document.getElementById(id); if (el) el.classList.add("focus"); }
}
function packet(path, color) {
  const p = $("#packet"), wire = document.getElementById(path);
  if (!p || !wire || !wire.getTotalLength) return;
  const len = wire.getTotalLength(); let t0 = null;
  p.setAttribute("fill", color || "var(--purple)");
  function step(ts) {
    if (!t0) t0 = ts; const k = Math.min((ts - t0) / 900, 1);
    const pt = wire.getPointAtLength(k * len); p.setAttribute("cx", pt.x); p.setAttribute("cy", pt.y);
    if (k < 1) requestAnimationFrame(step); else setTimeout(() => { p.setAttribute("cx", -20); p.setAttribute("cy", -20); }, 300);
  }
  requestAnimationFrame(step);
}

/* ---------- concepts ---------- */
const concepts = [];
function unlock(name) {
  if (concepts.includes(name)) return;
  concepts.push(name);
  const t = $("#toast");
  if (t) { t.textContent = "Concept unlocked: " + name; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 1800); }
  renderHeader();
}
function chips(sel) { const el = $(sel); if (el) el.innerHTML = concepts.map((c) => `<span class="unlock">&#10003; ${c}</span>`).join(""); }

/* ---------- cloud switch ---------- */
function applyCloud() {
  document.body.classList.remove("cloud-azure", "cloud-aws", "cloud-neutral");
  document.body.classList.add("cloud-" + state.cloud);
  document.querySelectorAll(".cloud-switch button").forEach((b) => b.classList.toggle("on", b.dataset.c === state.cloud));
}
function cloudSwitch(sel) {
  document.querySelectorAll(sel).forEach((el) => {
    el.innerHTML = `<div class="cloud-switch" role="group" aria-label="Choose a cloud">
      <button data-c="azure">Azure</button><button data-c="aws">AWS</button><button data-c="neutral">Cloud-neutral</button></div>`;
    el.querySelectorAll("button").forEach((b) => b.onclick = () => { state.cloud = b.dataset.c; save(); applyCloud(); });
  });
  applyCloud();
}

/* ---------- side-quest cards inside a stop ---------- */
function sideCards() {
  const W = wstate();
  document.querySelectorAll(".side-here").forEach((el) => {
    const s = WORLD.sides.find((x) => x.id === el.dataset.side);
    if (!s) { el.innerHTML = ""; return; }
    el.innerHTML = `<a class="side-link ${W.sides.includes(s.id) ? "done" : ""}" href="${s.file}">
      <span class="k">Side quest${W.sides.includes(s.id) ? " &middot; done" : " &middot; optional"}</span>
      <span class="t">${s.title}</span><span class="d">${s.d || ""}</span></a>`;
  });
}

/* ---------- page engine ---------- */
let cfg = null, i = 0, kind = "level", entry = null;
function renderHeader() {
  if (!cfg) return;
  $("#progress").innerHTML = cfg.stops.map((_, k) => `<span class="dot ${k < i ? "done" : k === i ? "now" : ""}"></span>`).join("");
  const uc = $("#unlockedCount"); if (uc) uc.textContent = concepts.length + " concepts unlocked";
  document.querySelectorAll("#phase span").forEach((s) => s.classList.toggle("on", s.dataset.p === cfg.stops[i].phase));
}
function makeApi() {
  const api = {
    ready() { const g = $("#go"); if (g) g.disabled = false; const h = $("#gohint"); if (h) h.remove(); },
    choice(boxSel, fbSel, onRight, opts) {
      const box = $(boxSel), fb = $(fbSel); let solved = false;
      // shuffle the options once, so the right answer's position never gives it away
      if (!(opts && opts.keepOrder)) {
        const groups = new Set([...box.querySelectorAll("button.opt")].map((x) => x.parentNode));
        groups.forEach((g) => { const bs = [...g.querySelectorAll(":scope > button.opt")];
          bs.map((x) => [Math.random(), x]).sort((p, q) => p[0] - q[0]).forEach(([, x]) => g.appendChild(x)); });
      }
      box.querySelectorAll("button.opt").forEach((b) => b.onclick = () => {
        if (solved) return;
        const ok = b.dataset.ok === "1";
        b.classList.add(ok ? "right" : "wrong");
        fb.className = "feedback show " + (ok ? "right" : "wrong");
        fb.innerHTML = (ok ? "&#10003; " : "&#10007; Not this one. ") + b.dataset.fb + (ok ? "" : " <i>Try another answer.</i>");
        if (ok) { solved = true; if (onRight) onRight(); if (!(opts && opts.hold)) api.ready(); }
      });
    },
    sort(sel, cards, buckets, onDone, opts) {
      const box = $(sel); let done = 0;
      box.innerHTML = cards.map((c, k) => `<div class="sort-card" data-i="${k}"><div>${c.t}</div>
        <div class="btns">${buckets.map((x) => `<button data-v="${x}">${x}</button>`).join("")}</div><div class="fb"></div></div>`).join("");
      box.querySelectorAll(".sort-card").forEach((card) => {
        const c = cards[+card.dataset.i]; let solved = false;
        card.querySelectorAll("button").forEach((b) => b.onclick = () => {
          if (solved) return;
          const fb = card.querySelector(".fb"); fb.classList.add("show");
          if (b.dataset.v === c.a) {
            b.classList.add("right"); solved = true; fb.innerHTML = "&#10003; " + c.fb; done++;
            if (c.onRight) c.onRight();
            if (done === cards.length) { if (onDone) onDone(); if (!(opts && opts.hold)) api.ready(); }
          } else {
            b.classList.add("wrong");
            const why = (c.wrong && c.wrong[b.dataset.v]) || c.hint || "Not quite. Think again.";
            fb.innerHTML = "&#10007; " + why;
          }
        });
      });
    },
    order(sel, steps, onDone, opts) {
      const box = $(sel); let next = 0;
      const shuffled = steps.map((s, k) => ({ s, k })).sort(() => Math.random() - 0.5);
      box.innerHTML = `<div class="order-done"></div><div class="feedback" style="margin:0 0 8px"></div><div class="order-pool">${shuffled.map((x) =>
        `<button data-k="${x.k}">${x.s.t}</button>`).join("")}</div>`;
      const doneEl = box.querySelector(".order-done"), fb = box.querySelector(".feedback");
      box.querySelectorAll(".order-pool button").forEach((b) => b.onclick = () => {
        const k = +b.dataset.k;
        if (k === next) {
          doneEl.insertAdjacentHTML("beforeend", `<div class="step"><b>${k + 1}</b>${steps[k].t}${steps[k].why ? `<div class="hint">${steps[k].why}</div>` : ""}</div>`);
          b.remove(); fb.className = "feedback"; next++;
          if (steps[k].onRight) steps[k].onRight();
          if (next === steps.length) { if (onDone) onDone(); if (!(opts && opts.hold)) api.ready(); }
        } else {
          b.classList.add("wrong"); setTimeout(() => b.classList.remove("wrong"), 700);
          fb.className = "feedback show wrong";
          fb.innerHTML = "&#10007; Not yet. " + (steps[k].early || "Something else has to happen first.");
        }
      });
    },
    parts(sel, texts, outSel, onEach) {
      document.querySelectorAll(sel).forEach((s) => s.onclick = () => {
        document.querySelectorAll(sel).forEach((x) => x.classList.remove("sel"));
        s.classList.add("sel", "seen"); $(outSel).innerHTML = texts[s.dataset.k];
        if (onEach) onEach(s.dataset.k);
      });
    },
    meet(texts, outSel, onAll, onEach) {
      const met = new Set(), keys = Object.keys(texts);
      document.querySelectorAll(".node[data-meet]").forEach((n) => {
        const k = n.dataset.meet; if (!texts[k]) return;
        n.classList.add("clickable");
        n.onclick = () => {
          met.add(k); light([n.id]); focus(n.id); if (onEach) onEach(k);
          $(outSel).innerHTML = texts[k] + `<div class="hint" style="margin-top:6px">${met.size} of ${keys.length} met.</div>`;
          if (met.size === keys.length && onAll) onAll();
        };
      });
    },
    terminal(sel, steps, onDone, opts) {
      const box = $(sel); let k = 0;
      box.innerHTML = `<pre class="term" aria-live="polite"></pre><div class="term-say"></div><div class="opts term-opts"></div><div class="feedback"></div>`;
      const out = box.querySelector(".term"), say = box.querySelector(".term-say"), choicesEl = box.querySelector(".term-opts"), fb = box.querySelector(".feedback");
      function render() {
        if (k >= steps.length) { say.innerHTML = "<b>Mission complete.</b>"; choicesEl.innerHTML = ""; if (onDone) onDone(); if (!(opts && opts.hold)) api.ready(); return; }
        const s = steps[k]; say.innerHTML = s.say || "";
        const order = s.choices.map((_, j) => j).sort(() => Math.random() - 0.5);   // never let position give the command away
        choicesEl.innerHTML = order.map((j) => `<button class="opt" data-j="${j}"><code>${s.choices[j].cmd}</code></button>`).join("");
        choicesEl.querySelectorAll("button").forEach((b) => b.onclick = () => {
          const c = s.choices[+b.dataset.j];
          if (c.ok) {
            out.insertAdjacentHTML("beforeend", `<span class="ps">$</span> ${c.cmd}\n${c.out || ""}\n`);
            out.scrollTop = out.scrollHeight; fb.className = "feedback";
            if (c.fb) { fb.className = "feedback show right"; fb.innerHTML = "&#10003; " + c.fb; }
            k++; render();
          } else {
            b.classList.add("wrong"); fb.className = "feedback show wrong"; fb.innerHTML = "&#10007; " + (c.fb || "Not this one.");
          }
        });
      }
      render();
    },
    quiz(sel, qs, opts) {
      opts = opts || {}; const pass = opts.pass || 0.72;
      const box = $(sel); let k = 0, right = 0; const missed = [];
      function render() {
        if (k >= qs.length) {
          const score = right / qs.length, ok = score >= pass;
          box.innerHTML = `<div class="box ${ok ? "ok" : "test"}"><span class="tag">${ok ? "Passed" : "Not yet"}</span>
            ${right} of ${qs.length} right (${Math.round(score * 100)}%). The pass mark is ${Math.round(pass * 100)}%.</div>
            ${missed.length ? `<h3>Review what you missed</h3>${missed.map((m) => `<div class="sort-card"><div><b>${m.q}</b></div>
              <div class="hint">Right answer: ${(Array.isArray(m.answer) ? m.answer : [m.answer]).map((j) => m.options[j]).join(" + ")}</div><div>${m.why || ""}</div></div>`).join("")}` : ""}
            <button class="back" id="quizAgain">Try again</button>`;
          box.querySelector("#quizAgain").onclick = () => { k = 0; right = 0; missed.length = 0; render(); };
          if (opts.onDone) opts.onDone(score);
          api.ready(); return;
        }
        const Q = qs[k]; let answered = false; const multi = Array.isArray(Q.answer);
        const isRight = (j) => multi ? Q.answer.includes(j) : j === Q.answer;
        box.innerHTML = `<div class="hint">Question ${k + 1} of ${qs.length} &middot; ${right} right so far${multi ? " &middot; <b>choose all that apply</b>" : ""}</div>
          <p class="quiz-q">${Q.q}</p><div class="opts">${Q.options.map((o, j) => `<button class="opt" data-j="${j}">${multi ? "&#9744; " : ""}${o}</button>`).join("")}</div>
          ${multi ? '<div style="margin-top:8px"><button class="back" id="quizCheck">Check my answer</button></div>' : ""}
          <div class="feedback"></div><div class="nav" style="margin-top:10px"><button class="go" id="quizNext" disabled>Next question</button></div>`;
        const fb = box.querySelector(".feedback"), nx = box.querySelector("#quizNext"), picked = new Set();
        function grade(chosen) {
          answered = true;
          const ok = multi ? (chosen.size === Q.answer.length && Q.answer.every((j) => chosen.has(j))) : isRight([...chosen][0]);
          if (ok) right++; else missed.push(Q);
          box.querySelectorAll("button.opt").forEach((b) => {
            const j = +b.dataset.j;
            if (isRight(j)) b.classList.add("right"); else if (chosen.has(j)) b.classList.add("wrong");
          });
          const wrongTexts = [...chosen].filter((j) => !isRight(j) && Q.wrong && Q.wrong[j]).map((j) => Q.wrong[j]);
          fb.className = "feedback show " + (ok ? "right" : "wrong");
          fb.innerHTML = (ok ? "&#10003; " : "&#10007; ") + (wrongTexts.length ? wrongTexts.join(" ") + " " : "") + (Q.why || "");
          nx.disabled = false;
        }
        box.querySelectorAll("button.opt").forEach((b) => b.onclick = () => {
          if (answered) return;
          const j = +b.dataset.j;
          if (!multi) { grade(new Set([j])); return; }
          if (picked.has(j)) { picked.delete(j); b.classList.remove("sel"); b.innerHTML = b.innerHTML.replace("&#9745;", "&#9744;").replace("☑", "☐"); }
          else { picked.add(j); b.classList.add("sel"); b.innerHTML = b.innerHTML.replace("☐", "☑"); }
        });
        const ck = box.querySelector("#quizCheck"); if (ck) ck.onclick = () => { if (!answered && picked.size) grade(picked); };
        nx.onclick = () => { k++; render(); };
      }
      render();
    }
  };
  return api;
}
function finishButton() {
  if (kind === "side") {
    const L = LEVELS.find((x) => x.n === entry.from);
    return `${L ? `<a href="${L.file}"><button class="go">Back to ${L.final ? L.title : `Level ${L.n}: ${L.title}`}</button></a> ` : ""}<a href="index.html"><button class="back">World map</button></a>`;
  }
  if (kind === "bonus") return '<a href="index.html"><button class="go">Back to the world map</button></a>';
  const nextLevel = LEVELS.find((x) => x.n === cfg.level + 1);
  return nextLevel ? `<a href="${nextLevel.file}"><button class="go" id="next">${nextLevel.final ? nextLevel.title : `Level ${nextLevel.n}: ${nextLevel.title}`}</button></a>`
    : '<a href="index.html"><button class="go">Back to the world map</button></a>';
}
function markDone() {
  const W = wstate();
  if (kind === "level" && !W.done.includes(cfg.level)) W.done.push(cfg.level);
  if (kind === "side" && !W.sides.includes(entry.id)) W.sides.push(entry.id);
  if (kind === "bonus" && !(entry.id in W.bonus)) W.bonus[entry.id] = true;
  save();
}
function show(k) {
  const prev = cfg.stops[i];
  if (prev && prev.leave) prev.leave();
  document.querySelectorAll(".node.clickable").forEach((n) => { n.classList.remove("clickable"); n.onclick = null; });
  i = k; const s = cfg.stops[i], last = i === cfg.stops.length - 1;
  $("#panel").innerHTML = s.html + `<div class="nav">
    ${i > 0 ? '<button class="back" id="back">Back</button>' : ""}
    ${!last ? `<button class="go" id="go" ${s.ready ? "" : "disabled"}>${i === 0 ? (kind === "level" ? "Start the mission" : "Start") : "Continue"}</button>` : finishButton()}
    ${s.ready || last ? "" : '<span class="hint" id="gohint">Solve the challenge to continue.</span>'}</div>`;
  if (last) markDone();
  cloudSwitch(".cloud-here"); sideCards();
  if (s.enter) s.enter(makeApi());
  const go = $("#go"); if (go) go.onclick = () => show(i + 1);
  const back = $("#back"); if (back) back.onclick = () => show(i - 1);
  renderHeader(); window.scrollTo(0, 0);
}
function level(c) {
  cfg = c;
  const home = `<a class="home" href="index.html">&larr; ${WORLD.title || "World"}</a>`;
  let title, label;
  if (c.side) {
    kind = "side"; entry = WORLD.sides.find((x) => x.id === c.side) || { id: c.side, title: c.side, from: null };
    title = entry.title; const fromL = LEVELS.find((x) => x.n === entry.from);
    label = `${home} &middot; Side quest${fromL ? ` from ${fromL.final ? "the final level" : "Level " + fromL.n}` : ""}`;
  } else if (c.bonus) {
    kind = "bonus"; entry = WORLD.bonus.find((x) => x.id === c.bonus) || { id: c.bonus, title: c.bonus, kind: "mission" };
    title = entry.title; label = `${home} &middot; Bonus ${entry.kind === "exam" ? "exam" : "mission"}`;
  } else {
    kind = "level"; entry = LEVELS.find((x) => x.n === c.level) || { n: c.level, title: "" };
    const mains = LEVELS.filter((x) => !x.final), lastN = mains.length ? mains[mains.length - 1].n : 0;
    title = entry.title; label = `${home} &middot; ${entry.final ? "Final level" : `Level ${c.level} of ${lastN}`}`;
  }
  document.title = `${WORLD.title}: ${title}`;
  $("#lvlLabel").innerHTML = label;
  $("#lvlTitle").textContent = title;
  document.body.classList.add("kind-" + kind);
  const phases = c.phases || (kind === "level" ? ["briefing", "setup", "request", "response", "tests", "debrief"] : ["briefing", "debrief"]);
  const names = { briefing: "Briefing", setup: "Setup", request: "Request", response: "Response", tests: "Tests", debrief: "Debrief",
    choose: "Choose", practice: "Practice", exam: "Exam", deeper: "Deeper" };
  $("#phase").innerHTML = phases.map((p) => `<span data-p="${p}">${names[p] || p}</span>`).join("");
  applyCloud();
  show(0);
}

/* ---------- question banks ---------- */
/* Convert a bank in a normal course's format (the starter kit's quizzes/mNN.js: {scenario, question,
   type: "single"|"multi", options: [{text, correct, why}], explanation}) into api.quiz questions. With n, it keeps
   n questions spread evenly over the bank, in bank order (every length/n-th question), not a random draw. */
function fromBank(bank, n) {
  const qs = bank.map((b) => {
    const right = b.options.map((o, j) => o.correct ? j : -1).filter((j) => j >= 0);
    const wrong = {}; b.options.forEach((o, j) => { if (!o.correct && o.why) wrong[j] = o.why; });
    return { q: (b.scenario ? `<span class="hint">${b.scenario}</span><br><br>` : "") + `<b>${b.question}</b>`,
      options: b.options.map((o) => o.text), answer: b.type === "multi" ? right : right[0],
      why: b.options.filter((o) => o.correct).map((o) => o.why).filter(Boolean).join(" ")
        + (b.explanation ? "<br><br><b>Why it matters:</b> " + b.explanation : ""), wrong };
  });
  qs.forEach(shuffleOptions);   // the banks put the right answer first; never let position give it away
  if (!n || n >= qs.length) return qs;
  const step = qs.length / n; return Array.from({ length: n }, (_, k) => qs[Math.floor(k * step)]);
}
/* Shuffle one question's options in place, remapping answer (index or array) and wrong (index -> text). */
function shuffleOptions(Q) {
  const order = Q.options.map((_, j) => j).sort(() => Math.random() - 0.5), pos = {};
  order.forEach((old, nw) => { pos[old] = nw; });
  Q.options = order.map((old) => Q.options[old]);
  Q.answer = Array.isArray(Q.answer) ? Q.answer.map((j) => pos[j]).sort((a, b) => a - b) : pos[Q.answer];
  if (Q.wrong) { const w = {}; Object.keys(Q.wrong).forEach((j) => { w[pos[j]] = Q.wrong[j]; }); Q.wrong = w; }
  return Q;
}

/* ---------- hubs ---------- */
function card(href, n, t, d, done, extra) {
  return `<a class="lvl ${done ? "done" : ""} ${extra || ""}" href="${href}"><div class="n">${n}</div><div class="t">${t}</div><div class="d">${d || ""}</div></a>`;
}
function worldHub(sel) {
  const el = $(sel), W = wstate();
  const lv = LEVELS.map((L) => card(L.file, L.final ? "Final" : "Level " + L.n, L.title, L.d, W.done.includes(L.n))).join("");
  const sd = WORLD.sides.map((s) => card(s.file, `Side quest${s.from != null ? " &middot; after Level " + s.from : ""}`, s.title, s.d, W.sides.includes(s.id), "side")).join("");
  const bn = WORLD.bonus.map((b) => card(b.file, b.kind === "exam" ? "Bonus exam" : "Bonus mission", b.title, b.d, b.id in W.bonus, "bonus")).join("");
  el.innerHTML = `<h2>Main quest</h2><div class="levels">${lv}</div>
    ${sd ? `<h2>Side quests</h2><p class="hint">Optional depth. Each one branches off a level and brings you back to it.</p><div class="levels">${sd}</div>` : ""}
    ${bn ? `<h2>Bonus missions</h2><p class="hint">Practice the real task, or take the exam.</p><div class="levels">${bn}</div>` : ""}
    ${WORLD.score ? `<h2>The scorecard so far</h2><p class="hint">A column appears when you finish its level.</p><div id="hubScore"></div>` : ""}`;
  if (WORLD.score) scorecard("#hubScore", -1);
}
function worldMap(sel) {
  const el = $(sel), list = (window.WORLDS || []).slice().sort((p, q) => p.n - q.n);
  el.innerHTML = `<div class="levels">${list.map((w) => {
    const W = state.worlds[w.id] || { done: [] }, total = w.levels || 0, done = (W.done || []).length;
    return `<a class="lvl ${total && done >= total ? "done" : ""} ${w.ready === false ? "soon" : ""}" href="worlds/${w.id}/index.html">
      <div class="n">World ${w.n}${total ? ` &middot; ${done}/${total} levels` : ""}</div><div class="t">${w.title}</div><div class="d">${w.d}</div></a>`;
  }).join("")}</div>`;
}

window.GAME = { fromBank, shuffleOptions, level, light, unlit, mark, focus, packet, unlock, chips, scorecard, cloudSwitch, worldHub, worldMap,
  WORLD, LEVELS, state, wstate, save, $ };
})();
