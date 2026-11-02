"""Course checker: validates module pages, quiz banks and exam pages against authoring/SPEC.md.

Usage (from the course root, with any Python 3.8 or later):
    python3 tools/check_course.py            # check everything the manifest in assets/app.js lists
    python3 tools/check_course.py m02 m07    # check selected modules or exams, by id

Standard library only. Exit code 1 if any ERROR is found.

A module page that breaks a rule on purpose says so in one comment, which the checker reads:
    <!-- check_course: lab=0 scenario-card=1 questions=18-30 (orientation has no hands-on part) -->
Keys: any block counted in MIN_ERROR or MIN_WARN (a new minimum), words (a new prose ceiling),
questions (a new bank size, lo-hi) and domains (a new minimum). Other text in the comment is ignored.
"""
from __future__ import annotations

import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

# ---------- The rules. No module ids here: a page states its own exceptions (see above). ----------
REQUIRED_IDS = ["why", "section-1", "scenarios", "resolution", "self-check", "reading"]  # labs live inside sections
MIN_ERROR = {"scenario-card": 3, "lab": 1}          # fewer is an ERROR
MIN_WARN = {"svg": 4, "compare": 2, "warning": 3}   # fewer is a WARN
MAX_WORDS = 14000                                   # prose words above this: WARN (there is no minimum)
QUESTIONS = (24, 50)                                # a module bank: fewer is an ERROR, more a WARN
FINAL_QUESTIONS = (65, 70)
MIN_DOMAINS = 5                                     # fewer domains in a module bank: WARN
LONGEST_CORRECT_MAX = 0.20                          # correct option the longest in more of a bank: ERROR

ROOT = Path(__file__).resolve().parents[1]
QUIZ_DIR = ROOT / "quizzes"

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr", "path", "circle", "rect", "line", "polyline", "polygon", "ellipse", "use", "stop"}
EXCEPTION_KEYS = set(MIN_ERROR) | set(MIN_WARN) | {"words", "questions", "domains"}


class Collector(HTMLParser):
    """Collects structure facts and checks tag nesting."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: list[tuple[str, int]] = []
        self.errors: list[str] = []
        self.ids: dict[str, int] = {}
        self.classes: list[str] = []
        self.svg_count = 0
        self.text_parts: list[str] = []
        self.in_skip = 0  # inside <pre>, <svg>, <script>, <style>
        self.data_quiz: str | None = None
        self.scripts: list[str] = []
        self.hrefs: list[str] = []
        self.captions = 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        line = self.getpos()[0]
        if "id" in a:
            self.ids[a["id"]] = self.ids.get(a["id"], 0) + 1
        if "class" in a and a["class"]:
            self.classes.extend(a["class"].split())
            if "caption" in a["class"].split():
                self.captions += 1
        if tag == "svg":
            self.svg_count += 1
            if not a.get("aria-label"):
                self.errors.append(f"line {line}: <svg> missing aria-label")
        if "data-quiz" in a:
            self.data_quiz = a["data-quiz"]
        if tag == "script" and a.get("src"):
            self.scripts.append(a["src"])
        if tag == "a" and a.get("href"):
            self.hrefs.append(a["href"])
        if tag in ("pre", "svg", "script", "style"):
            self.in_skip += 1
        if tag not in VOID:
            self.stack.append((tag, line))

    def handle_startendtag(self, tag, attrs):
        # <tag ... /> self-closing: treat as void
        self.handle_starttag(tag, attrs)
        if tag not in VOID and self.stack and self.stack[-1][0] == tag:
            self.stack.pop()
        if tag in ("pre", "svg", "script", "style"):
            self.in_skip -= 1

    def handle_endtag(self, tag):
        line = self.getpos()[0]
        if tag in VOID:
            return
        if tag in ("pre", "svg", "script", "style"):
            self.in_skip = max(0, self.in_skip - 1)
        # pop to matching tag, reporting mismatches
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                for unclosed in self.stack[i + 1:]:
                    self.errors.append(f"line {line}: </{tag}> closes while <{unclosed[0]}> (opened line {unclosed[1]}) is still open")
                del self.stack[i:]
                return
        self.errors.append(f"line {line}: stray </{tag}> with no open tag")

    def handle_data(self, data):
        if not self.in_skip:
            self.text_parts.append(data)

    def finish(self):
        for tag, line in self.stack:
            if tag not in ("html", "body"):
                self.errors.append(f"<{tag}> opened at line {line} never closed")


def page_exceptions(mid: str, src: str, out: list[str]) -> dict:
    """The page's own exceptions, from <!-- check_course: key=value ... --> comments."""
    ex: dict = {}
    for body in re.findall(r"<!--\s*check_course:(.*?)-->", src, re.S):
        for key, val in re.findall(r"([a-z-]+)=(\d+(?:-\d+)?)", body):
            if key not in EXCEPTION_KEYS:
                out.append(f"WARN  {mid}: unknown check_course key {key!r} (known: {', '.join(sorted(EXCEPTION_KEYS))})")
            elif key == "questions":
                lo, _, hi = val.partition("-")
                ex[key] = (int(lo), int(hi) if hi else QUESTIONS[1])
            else:
                ex[key] = int(val.split("-")[0])
    if ex:
        out.append(f"INFO  {mid}: page exceptions {ex}")
    return ex


def check_module(mid: str, file: str, quiz_path: Path) -> list[str]:
    out: list[str] = []
    html_path = ROOT / file
    if not html_path.exists():
        return [f"ERROR {mid}: missing module file {file}"]
    src = html_path.read_text(encoding="utf-8")
    ex = page_exceptions(mid, src, out)
    c = Collector()
    c.feed(src)
    c.finish()
    for e in c.errors:
        out.append(f"ERROR {mid}: HTML {e}")

    # Widgets need the widget script and stylesheet, or they render as nothing
    if "data-widget=" in src:
        if "widgets.js" not in src:
            out.append(f"ERROR {mid}: page has data-widget blocks but does not load assets/widgets.js")
        if "widgets.css" not in src:
            out.append(f"ERROR {mid}: page has data-widget blocks but does not load assets/widgets.css")

    # Required ids
    for rid in REQUIRED_IDS:
        if rid not in c.ids:
            out.append(f"ERROR {mid}: missing required id #{rid}")
    dups = [k for k, v in c.ids.items() if v > 1]
    if dups:
        out.append(f"ERROR {mid}: duplicate ids: {', '.join(dups[:10])}")

    # Structural minimums
    counts = {
        "svg": c.svg_count,
        "scenario-card": c.classes.count("scenario-card"),
        "compare": c.classes.count("compare"),
        "warning": c.classes.count("warning"),
        "lab": c.classes.count("lab"),
    }
    if counts["lab"] > 3:
        out.append(f"WARN  {mid}: {counts['lab']} labs (spec says 1-3)")
    if counts["lab"] and "console-mock" not in c.classes and "terminal" not in c.classes:
        out.append(f"WARN  {mid}: labs present but no console-mock or terminal blocks")
    for level, rules in (("ERROR", MIN_ERROR), ("WARN ", MIN_WARN)):
        for k, need in rules.items():
            need = ex.get(k, need)
            if counts[k] < need:
                out.append(f"{level} {mid}: only {counts[k]} {k} (need >= {need})")
    if c.captions < c.svg_count:
        out.append(f"WARN  {mid}: {c.svg_count} diagrams but {c.captions} captions")
    for cls in ("objectives", "takeaways", "quiz", "pager", "lead", "meta"):
        if cls not in c.classes:
            out.append(f"ERROR {mid}: missing .{cls} block")
    if "definition" in c.classes or "intuition" in c.classes:   # the module blueprint explains terms in prose
        out.append(f"WARN  {mid}: definition or intuition callout found (the blueprint explains terms in prose)")

    # Word count (prose only): a ceiling, no floor
    words = len(re.findall(r"[A-Za-z][A-Za-z'-]+", " ".join(c.text_parts)))
    cap = ex.get("words", MAX_WORDS)
    if words > cap:
        out.append(f"WARN  {mid}: prose word count {words} above {cap}")
    out.append(f"INFO  {mid}: words={words} svg={counts['svg']} labs={counts['lab']} scenarios={counts['scenario-card']} compare={counts['compare']} warnings={counts['warning']}")

    # Em dashes in prose: the explain skill's core bans them (en dashes, as in 2019–2024, are fine)
    em = sum(p.count("—") for p in c.text_parts)
    if em:
        out.append(f"WARN  {mid}: {em} em dash(es) in prose (the explain skill bans them: use a comma, a colon or a new sentence)")

    # Quiz wiring
    if c.data_quiz != mid:
        out.append(f"ERROR {mid}: data-quiz is {c.data_quiz!r}, expected {mid!r}")
    if f"../quizzes/{mid}.js" not in c.scripts:
        out.append(f"ERROR {mid}: page does not include ../quizzes/{mid}.js")
    if "../assets/app.js" not in c.scripts:
        out.append(f"ERROR {mid}: page does not include ../assets/app.js")

    # Local link targets exist
    for h in c.hrefs:
        if h.startswith(("http://", "https://", "#", "mailto:")):
            continue
        target = (html_path.parent / h.split("#")[0]).resolve()
        if h.split("#")[0] and not target.exists():
            out.append(f"WARN  {mid}: link target not found: {h}")

    # Quiz bank
    out.extend(check_quiz(mid, quiz_path, ex.get("questions", QUESTIONS), ex.get("domains", MIN_DOMAINS)))
    return out


def parse_bank(quiz_path: Path):
    src = quiz_path.read_text(encoding="utf-8")
    m = re.search(r'window\.QUIZ_BANKS\["([^"]+)"\]\s*=\s*(\[.*\])\s*;\s*$', src, re.S)
    if not m:
        raise ValueError("could not find window.QUIZ_BANKS[\"id\"] = [ ... ]; wrapper")
    bank_id, arr = m.group(1), m.group(2)
    try:
        data = json.loads(arr)
    except json.JSONDecodeError as e:
        # give a useful context snippet
        pos = e.pos
        snippet = arr[max(0, pos - 80):pos + 80].replace("\n", " ")
        raise ValueError(f"array is not strict JSON: {e.msg} at char {pos}: ...{snippet}...")
    return bank_id, data


def check_quiz(mid: str, quiz_path: Path, qrange, min_domains: int | None = None) -> list[str]:
    out: list[str] = []
    if not quiz_path.exists():
        return [f"ERROR {mid}: missing quiz bank {quiz_path.name}"]
    try:
        bank_id, data = parse_bank(quiz_path)
    except ValueError as e:
        return [f"ERROR {mid}: quiz bank {e}"]
    if bank_id != mid:
        out.append(f"ERROR {mid}: bank registered as {bank_id!r}")
    lo, hi = qrange
    n = len(data)
    if n < lo:
        out.append(f"ERROR {mid}: {n} questions (need >= {lo})")
    elif n > hi:
        out.append(f"WARN  {mid}: {n} questions (spec says <= {hi})")
    ids = set()
    singles = multis = 0
    domains: dict[str, int] = {}
    diffs: dict[str, int] = {}
    for i, q in enumerate(data):
        tag = f"{mid} q{i + 1} ({q.get('id', '?')})"
        for key in ("id", "type", "domain", "difficulty", "question", "options", "explanation"):
            if key not in q or q[key] in ("", None, []):
                out.append(f"ERROR {tag}: missing {key}")
        if q.get("id") in ids:
            out.append(f"ERROR {tag}: duplicate id")
        ids.add(q.get("id"))
        opts = q.get("options", [])
        if not (4 <= len(opts) <= 6):
            out.append(f"ERROR {tag}: {len(opts)} options (want 4-6)")
        correct = sum(1 for o in opts if o.get("correct") is True)
        t = q.get("type")
        if t == "single":
            singles += 1
            if correct != 1:
                out.append(f"ERROR {tag}: single with {correct} correct options")
        elif t == "multi":
            multis += 1
            if correct not in (2, 3):
                out.append(f"ERROR {tag}: multi with {correct} correct options (want 2-3)")
            qt = (q.get("question", "") + q.get("scenario", "")).lower()
            if not re.search(r"choose (two|three|2|3)|select (two|three|2|3)|which (two|three)", qt):
                out.append(f"WARN  {tag}: multi question text should say how many to choose")
        else:
            out.append(f"ERROR {tag}: type {t!r} invalid")
        for j, o in enumerate(opts):
            if not o.get("text"):
                out.append(f"ERROR {tag}: option {j + 1} has no text")
            if not o.get("why"):
                out.append(f"ERROR {tag}: option {j + 1} has no why")
            if "correct" not in o or not isinstance(o["correct"], bool):
                out.append(f"ERROR {tag}: option {j + 1} correct must be true/false")
        if q.get("difficulty") not in ("medium", "hard"):
            out.append(f"ERROR {tag}: difficulty must be medium|hard")
        if not q.get("scenario") and len(q.get("question", "")) < 120:
            out.append(f"WARN  {tag}: no scenario and short question; spec wants scenario-based questions")
        domains[q.get("domain", "?")] = domains.get(q.get("domain", "?"), 0) + 1
        diffs[q.get("difficulty", "?")] = diffs.get(q.get("difficulty", "?"), 0) + 1
    if n:
        pct_multi = 100 * multis / n
        if not (25 <= pct_multi <= 45):
            out.append(f"WARN  {mid}: {pct_multi:.0f}% multi-select (spec wants 30-40%)")
        if diffs.get("hard", 0) < 0.5 * n:
            out.append(f"WARN  {mid}: only {diffs.get('hard', 0)}/{n} hard questions (spec wants ~60%)")
        # Length tell: a test-wise learner picks the longest option, so the correct one may be the
        # longest in at most LONGEST_CORRECT_MAX of the questions.
        tells = [q.get("id", "?") for q in data if q.get("options") and
                 max(q["options"], key=lambda o: len(o.get("text", ""))).get("correct") is True]
        if len(tells) > LONGEST_CORRECT_MAX * n:
            out.append(f"ERROR {mid}: correct option is the longest in {len(tells)}/{n} questions "
                       f"(limit {LONGEST_CORRECT_MAX:.0%}; rebalance with authoring/rewrite/quizfix/apply.py): {', '.join(tells[:10])}")
        short = sum(1 for q in data if q.get("options") and
                    min(q["options"], key=lambda o: len(o.get("text", ""))).get("correct") is True)
        if short > 0.4 * n:
            out.append(f"WARN  {mid}: correct option is the shortest in {short}/{n} questions (keep it under 40%)")
        if min_domains and len(domains) < min_domains:
            out.append(f"WARN  {mid}: only {len(domains)} domains (spec wants 5-8)")
    out.append(f"INFO  {mid}: questions={n} single={singles} multi={multis} domains={len(domains)} hard={diffs.get('hard', 0)}")
    return out


def check_exam(eid: str, file: str, module_ids: list[str]) -> list[str]:
    """A final has its own bank (quizzes/<id>.js); a practice mix draws from module banks (data-from)."""
    page = ROOT / file
    if not page.exists():
        return [f"WARN  {eid}: exam page {file} not written yet"]
    src = page.read_text(encoding="utf-8")
    m = re.search(r'data-from="([^"]*)"', src)
    if not m:
        bank = QUIZ_DIR / f"{eid}.js"
        if not bank.exists():
            return [f"WARN  {eid}: quiz bank not written yet"]
        out = check_quiz(eid, bank, FINAL_QUESTIONS)
        if f"../quizzes/{eid}.js" not in src:
            out.append(f"ERROR {eid}: page does not include ../quizzes/{eid}.js")
        return out
    out: list[str] = []
    drawn = [x.strip() for x in m.group(1).split(",") if x.strip()]
    for bid in drawn:
        if bid not in module_ids:
            out.append(f"ERROR {eid}: data-from names {bid!r}, which is not a module in the manifest")
        elif f"../quizzes/{bid}.js" not in src:
            out.append(f"ERROR {eid}: draws from {bid!r} but does not include ../quizzes/{bid}.js")
    left_out = [x for x in module_ids if x not in drawn]
    if left_out:
        out.append(f"WARN  {eid}: does not draw from {', '.join(left_out)}")
    out.append(f"INFO  {eid}: draws from {len(drawn)} module banks")
    return out


def main(argv: list[str]) -> int:
    # Page text may hold characters a Windows console code page cannot print.
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    manifest = (ROOT / "assets" / "app.js").read_text(encoding="utf-8")
    modules = re.findall(r'id:\s*"(m\d\d[a-z]?)",\s*file:\s*"([^"]+)"', manifest)
    exams = re.findall(r'id:\s*"([^"]+)",\s*file:\s*"(exams/[^"]+)"', manifest)
    selected = set(argv[1:])
    results: list[str] = []
    if not modules:
        results.append('ERROR manifest: no modules found in assets/app.js (entries look like { n: 1, id: "mNN", file: "modules/..." })')
    for sid in sorted(selected - {m for m, _ in modules} - {e for e, _ in exams}):
        results.append(f"WARN  {sid}: not a module or exam id in the manifest")
    for mid, file in modules:
        if selected and mid not in selected:
            continue
        results.extend(check_module(mid, file, QUIZ_DIR / f"{mid}.js"))
    for eid, file in exams:
        if selected and eid not in selected:
            continue
        results.extend(check_exam(eid, file, [m for m, _ in modules]))
    errors = [r for r in results if r.startswith("ERROR")]
    for r in results:
        print(r)
    print(f"\n{len(errors)} error(s), {sum(1 for r in results if r.startswith('WARN'))} warning(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
