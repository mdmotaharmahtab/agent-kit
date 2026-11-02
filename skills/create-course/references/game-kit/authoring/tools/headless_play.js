/* Plays every page of the game headless (no browser) with authoring/tools/autoplay.js, using jsdom.
   Needs jsdom: run `npm install jsdom` in a folder of your choice (outside the game), then point NODE_PATH at the
   node_modules folder that install created, the one that holds jsdom/. From the game root:
     NODE_PATH=<your folder>/node_modules node authoring/tools/headless_play.js [world ...]
   (in PowerShell, first: $env:NODE_PATH = "<your folder>\node_modules")
   Prints one line per world: pages that played to their finish button, and any page that got stuck or threw. */
"use strict";
const fs = require("fs"), path = require("path");
let jsdom;
try { jsdom = require("jsdom"); } catch (e) {
  if (e.code !== "MODULE_NOT_FOUND") throw e;
  console.error("jsdom not found. Run `npm install jsdom` in a folder of your choice, then set NODE_PATH to that\n" +
    "folder's node_modules (the folder that holds jsdom/), for example:\n" +
    "  NODE_PATH=$HOME/tools/node_modules node authoring/tools/headless_play.js");
  process.exit(2);
}
const { JSDOM, VirtualConsole } = jsdom;
const ROOT = path.resolve(__dirname, "..", "..");
const AUTOPLAY = fs.readFileSync(path.join(__dirname, "autoplay.js"), "utf8");

function worldPages(id) {
  const holder = {};
  new Function("window", fs.readFileSync(path.join(ROOT, "worlds", id, "world.js"), "utf8"))(holder);
  const W = holder.WORLD;
  return [...W.levels, ...(W.sides || []), ...(W.bonus || [])].map((x) => x.file);
}

async function playPage(id, file) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => {   // jsdom lacks scrollTo and SVG geometry; those notices are not page errors
    const m = String(e.message || e).split("\n")[0];
    if (!m.startsWith("Not implemented")) errors.push(m);
  });
  const full = path.join(ROOT, "worlds", id, file);
  const dom = await JSDOM.fromFile(full, { runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, virtualConsole: vc });
  await new Promise((r) => { if (dom.window.document.readyState === "complete") r(); else dom.window.addEventListener("load", r); });
  await new Promise((r) => setTimeout(r, 50));
  let out = "";
  try { out = await dom.window.eval(AUTOPLAY); } catch (e) { out = "THREW " + e.message; }
  dom.window.close();
  const lines = String(out).split("\n");
  const stuck = lines.filter((l) => l.includes("disabled"));
  const finished = lines.some((l) => l.startsWith("END:"));
  const ok = finished && !stuck.length && /no errors/.test(lines[lines.length - 1]) && !errors.length;
  return { ok, note: ok ? "" : `${file}: ${stuck.join(" ")} ${lines.slice(-2).join(" | ")} ${errors.slice(0, 2).join(" ; ")}` };
}

(async () => {
  const ids = process.argv.slice(2).length ? process.argv.slice(2)
    : fs.readdirSync(path.join(ROOT, "worlds")).filter((d) => fs.existsSync(path.join(ROOT, "worlds", d, "world.js")));
  let bad = 0;
  for (const id of ids) {
    const pages = worldPages(id); let okCount = 0; const notes = [];
    for (const f of pages) { const r = await playPage(id, f); if (r.ok) okCount++; else notes.push(r.note); }
    bad += notes.length;
    console.log(`${id.padEnd(10)} ${okCount}/${pages.length} pages played to the end${notes.length ? "" : " ok"}`);
    notes.forEach((n) => console.log("    - " + n));
  }
  process.exit(bad ? 1 : 0);
})();
