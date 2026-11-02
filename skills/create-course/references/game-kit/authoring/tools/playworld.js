/* Run from any page of the game served over http (e.g. the root index): plays every page of one world in hidden
   frames with autoplay.js and returns one line per page. Usage in the console:
     window.PLAY_WORLD = "example"; await eval(await (await fetch('/authoring/tools/playworld.js')).text()) */
(async () => {
  const id = window.PLAY_WORLD, base = `/worlds/${id}/`;
  const src = await (await fetch("/authoring/tools/autoplay.js", { cache: "no-store" })).text();
  const wsrc = await (await fetch(base + "world.js", { cache: "no-store" })).text();
  const holder = {}; new Function("window", wsrc)(holder); const W = holder.WORLD;
  const pages = [...W.levels.map((l) => l.file), ...(W.sides || []).map((s) => s.file), ...(W.bonus || []).map((b) => b.file)];
  const out = [`${id}: ${W.levels.length} levels, ${(W.sides || []).length} side quests, ${(W.bonus || []).length} bonus`];
  for (const f of pages) {
    const fr = document.createElement("iframe"); fr.style.cssText = "width:1200px;height:800px;position:fixed;left:-3000px";
    fr.src = base + f + "?v=" + Date.now(); document.body.append(fr);
    const loaded = await Promise.race([new Promise((r) => fr.onload = () => r(true)), new Promise((r) => setTimeout(() => r(false), 8000))]);
    if (!loaded) { out.push(`${f}: DID NOT LOAD`); fr.remove(); continue; }
    await new Promise((r) => setTimeout(r, 300));
    const errs = []; fr.contentWindow.addEventListener("error", (e) => errs.push(e.message));
    let res = "";
    try { res = await fr.contentWindow.eval(src); } catch (e) { res = "THREW " + e.message; }
    const lines = String(res).split("\n");
    const stuck = lines.filter((l) => l.includes("disabled"));
    out.push(`${f}: ${Math.max(lines.length - 2, 0)} stops ${stuck.length ? "STUCK " + stuck.join(" ") : "ok"} | ${lines.slice(-2).join(" | ")} ${errs.join(";")}`);
    fr.remove();
  }
  return out.join("\n");
})()
