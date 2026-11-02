"""Static checks over the whole game (run from the game root with any Python 3.8+):
    python3 authoring/tools/check_game.py
Reports, per world: pages listed in world.js that do not exist, side-here placeholders naming unknown side quests,
em/en dashes in page text, banned cast names, references to a normal course's modules or labs (a game page must
stand on its own), and the main-path word count of the longest stop, with a WARN for every stop above CAP words.
Main-path text is a stop's html without its collapsed boxes (<details>), code or request blocks (<pre>) and
attribute values (such as an option's data-fb feedback). Hard problems are ERROR lines (missing page, unknown side
quest, banned name) and make the exit code 1; the rest are WARN lines."""
import os, re, sys
from html import unescape

# Page text may hold characters a Windows console code page cannot print.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BANNED = re.compile(r"\b(EmployerName|ClientName)\b")   # edit: real names that must never appear
LONG = re.compile(r"long course|long-course|module \d\d|\bLab \d\b", re.I)
CAP = 220   # main-path words per stop

def world_data(path):
    src = open(path, encoding="utf-8").read()
    files = re.findall(r'file:\s*"([^"]+)"', src)
    sides = re.findall(r'\{\s*id:\s*"([^"]+)",\s*file:\s*"side-', src)
    return files, set(sides)

def text_of(html):
    html = re.sub(r"(?s)<(script|style|svg)\b.*?</\1>", " ", html)
    return re.sub(r"<(?:[^>\"']|\"[^\"]*\"|'[^']*')*>", " ", html)   # a quoted attribute value may hold a < or >

def stop_htmls(script):
    """The html of every stop: the template literal after each `html:` in the page's script."""
    out = []
    for m in re.finditer(r"\bhtml:\s*`", script):
        j = m.end()
        while j < len(script) and (script[j] != "`" or script[j - 1] == "\\"):
            j += 1
        out.append(script[m.end():j])
    return out

def main_path_words(stop):
    s = re.sub(r"(?s)<details\b.*?</details>", " ", stop)   # collapsed boxes are optional depth
    s = re.sub(r"(?s)<pre\b.*?</pre>", " ", s)              # requests, commands and code are not prose
    s = re.sub(r"\$\{[^}]*\}", " ", s)                      # template expressions
    return len(re.findall(r"[A-Za-z0-9]+(?:['’.-][A-Za-z0-9]+)*", unescape(text_of(s))))

hard = 0
for w in sorted(os.listdir(os.path.join(ROOT, "worlds"))):
    wd = os.path.join(ROOT, "worlds", w)
    wjs = os.path.join(wd, "world.js")
    if not os.path.exists(wjs):
        continue
    files, sides = world_data(wjs)
    problems = []          # "ERROR ..." lines are hard problems, "WARN  ..." lines are notes
    longest = (0, "", 0)   # words, page, stop number
    for f in files:
        if not os.path.exists(os.path.join(wd, f)):
            problems.append(f"ERROR missing page {f}"); hard += 1
    for f in sorted(os.listdir(wd)):
        if not f.endswith(".html"):
            continue
        s = open(os.path.join(wd, f), encoding="utf-8").read()
        for sid in re.findall(r'class="side-here" data-side="([^"]+)"', s):
            if sid not in sides:
                problems.append(f"ERROR {f}: unknown side quest '{sid}'"); hard += 1
        scripts = " ".join(re.findall(r"(?s)<script>(.*?)</script>", s))
        visible = text_of(s) + " " + scripts
        if "—" in visible or "–" in visible:
            problems.append(f"WARN  {f}: em/en dash")
        m = BANNED.search(visible)
        if m:
            problems.append(f"ERROR {f}: banned name '{m.group(0)}'"); hard += 1
        m = LONG.search(re.sub(r"lab\d_\w+", "", visible))
        if m and f != "index.html":
            problems.append(f"WARN  {f}: possible reference to a course module or lab '{m.group(0)}'")
        for k, stop in enumerate(stop_htmls(scripts)):
            n = main_path_words(stop)
            if n > longest[0]:
                longest = (n, f, k)
            if n > CAP:
                title = re.search(r"<h2>(.*?)</h2>", stop)
                problems.append(f"WARN  {f}: stop {k} ({title.group(1) if title else '?'}) has {n} main-path words (cap about {CAP})")
    size = f"longest stop {longest[0]} words ({longest[1]}, stop {longest[2]})" if longest[1] else "no stops found"
    errors = sum(1 for p in problems if p.startswith("ERROR"))
    print(f"{w:10} {len(files):3} pages listed  {size}  " + ("ok" if not problems else f"{errors} errors, {len(problems) - errors} warnings"))
    for p in problems[:12]:
        print("    - " + p)
    if len(problems) > 12:
        print(f"    ... and {len(problems) - 12} more")
sys.exit(1 if hard else 0)
