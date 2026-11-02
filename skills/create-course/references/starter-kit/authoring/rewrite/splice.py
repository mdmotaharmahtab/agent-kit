"""Splice rewritten concept sections into a module, keeping figures, code, tables, widgets, labs and
screenshots from the old page by reference.

Usage: python3 splice.py <module.html> <sections.html> <out.html>

The region replaced runs from the module's <h2 id="section-1"> heading up to its <h2 id="scenarios">
heading; a comment just above that heading stays with it. Labs sit inside the sections, so they are part
of the region. The sections file holds the new <h2 id="section-N"> blocks, with placeholders for material
kept from the old page, always in the old numbering:
  {{FIG:n}}, {{FIG:n:m}}   the old <div class="diagram"> whose caption starts "Figure n.", with that
                           <p class="caption">; the second form renumbers it to Figure m
  {{CODE:sN:k}}            the k-th <pre> of old section N (pre blocks inside its labs count too)
  {{TABLE:sN:k}}           the k-th <table> of old section N
  {{WIDGET:n}}             the n-th data-widget block of the old region
  {{LAB:n}}, {{LAB:n:m}}   the old <div class="lab" id="lab-n">, whole; the second form renumbers it to
                           lab-m and "Lab m" in its heading
  {{SHOT:name}}            the <figure class="shot"> whose image src contains name (anywhere in the page)
Old figures and labs that the new sections do not use are reported, so nothing is dropped silently.
"""
import re
import sys
from pathlib import Path

mod, secs, out = (Path(a) for a in sys.argv[1:4])
with open(mod, encoding="utf-8", newline="") as f:   # newline="": keep CRLF as it is, so the output can keep it too
    src = f.read()
new = secs.read_text(encoding="utf-8")


def anchor(text, needle):
    i = text.find(needle)
    if i < 0:
        raise SystemExit(f"{mod.name}: anchor {needle} not found")
    return i


# Original concept region: section-1 up to the scenarios heading, leaving the comment and indentation above it
start = anchor(src, '<h2 id="section-1"')
end = anchor(src, '<h2 id="scenarios"')
if end < start:
    raise SystemExit(f'{mod.name}: <h2 id="scenarios"> comes before <h2 id="section-1">')
m = re.search(r"<!--(?:(?!-->).)*-->\s*$", src[start:end], re.S)
if m:
    end = start + m.start()
line_start = src.rfind("\n", 0, end) + 1
if not src[line_start:end].strip():
    end = line_start
region = src[start:end]

# Figures: diagram div + following caption
fig_blocks = {}
for m in re.finditer(r'(<div class="diagram">.*?</div>\s*<p class="caption">(Figure (\d+))\..*?</p>)', region, re.S):
    fig_blocks[m.group(3)] = m.group(1)

# Code blocks and tables per original section
sections = re.split(r'(?=<h2 id="section-\d+")', region)
code_blocks, table_blocks = {}, {}
for s in sections:
    m = re.match(r'<h2 id="section-(\d+)"', s)
    if m:
        code_blocks[m.group(1)] = re.findall(r'<pre[^>]*>.*?</pre>', s, re.S)
        table_blocks[m.group(1)] = re.findall(r'<table[^>]*>.*?</table>', s, re.S)


def div_block(text, i):
    """The <div ...>...</div> that opens at i, nested divs included."""
    depth = 0
    for t in re.finditer(r"<(/?)div\b[^>]*>", text[i:]):
        depth += -1 if t.group(1) else 1
        if depth == 0:
            return text[i:i + t.end()]
    raise SystemExit(f"{mod.name}: the <div> at character {i} is never closed")


# Labs: <div class="lab" id="lab-N"> blocks, whole
lab_blocks = {}
for m in re.finditer(r'<div\b(?=[^>]*\bclass="(?:[^"]*\s)?lab(?:\s[^"]*)?")(?=[^>]*\bid="lab-(\d+)")[^>]*>', region):
    lab_blocks[m.group(1)] = div_block(region, m.start())


def sub_fig(m):
    n, renum = m.group(1), m.group(2)
    if n not in fig_blocks:
        raise SystemExit(f"Figure {n} not found in original module")
    block = fig_blocks[n]
    if renum:
        block = block.replace(f'<p class="caption">Figure {n}.', f'<p class="caption">Figure {renum}.', 1)
    return block


def sub_code(m):
    n, k = m.group(1), int(m.group(2))
    blocks = code_blocks.get(n, [])
    if k < 1 or k > len(blocks):
        raise SystemExit(f"CODE s{n}:{k} not found (section {n} has {len(blocks)} blocks)")
    return blocks[k - 1]


def sub_table(m):
    n, k = m.group(1), int(m.group(2))
    t = table_blocks.get(n, [])
    if not 1 <= k <= len(t):
        raise SystemExit(f"TABLE s{n}:{k} not found")
    return t[k - 1]


# {{WIDGET:n}}: the n-th data-widget block in the original concept region
orig_widgets = re.findall(r'<div data-widget="[^"]+"[^>]*>(?:\s*<script type="application/json">.*?</script>\s*)?</div>', region, re.S)


def sub_widget(m):
    i = int(m.group(1))
    if not 1 <= i <= len(orig_widgets):
        raise SystemExit(f"WIDGET:{i} not found (original has {len(orig_widgets)})")
    return orig_widgets[i - 1]


def sub_lab(m):
    n, renum = m.group(1), m.group(2)
    if n not in lab_blocks:
        raise SystemExit(f"LAB:{n} not found (original has {', '.join('lab-' + k for k in lab_blocks) or 'no labs'})")
    block = lab_blocks[n]
    if renum:
        block = block.replace(f'id="lab-{n}"', f'id="lab-{renum}"', 1)
        block = re.sub(rf"(<h[2-4][^>]*>\s*)Lab {n}\b", rf"\g<1>Lab {renum}", block, count=1)
    return block


# {{SHOT:name}}: the figure.shot block whose img src contains name (searched in the whole base file)
def sub_shot(m):
    name = m.group(1)
    mm = re.search(r'<figure class="shot">(?:(?!</figure>).)*' + re.escape(name) + r'(?:(?!</figure>).)*</figure>', src, re.S)
    if not mm:
        raise SystemExit(f"SHOT {name} not found")
    return mm.group(0)


new = re.sub(r'\{\{FIG:(\d+)(?::(\d+))?\}\}', sub_fig, new)
new = re.sub(r'\{\{TABLE:s(\d+):(\d+)\}\}', sub_table, new)
new = re.sub(r'\{\{WIDGET:(\d+)\}\}', sub_widget, new)
new = re.sub(r'\{\{LAB:(\d+)(?::(\d+))?\}\}', sub_lab, new)
new = re.sub(r'\{\{SHOT:([^}]+)\}\}', sub_shot, new)
new = re.sub(r'\{\{CODE:s(\d+):(\d+)\}\}', sub_code, new)
_left = re.search(r"\{\{(FIG|CODE|TABLE|WIDGET|LAB|SHOT):[^}]*\}\}", new)
if _left:
    raise SystemExit("unresolved placeholder: " + _left.group(0))

# Report unused figures and labs so nothing is silently dropped
placeholders = secs.read_text(encoding="utf-8")
used_orig = set(re.findall(r'\{\{FIG:(\d+)', placeholders))
for n in fig_blocks:
    if n not in used_orig:
        print(f"WARNING: Figure {n} from the original is not used in the new sections")
used_labs = set(re.findall(r'\{\{LAB:(\d+)', placeholders))
for n in lab_blocks:
    if n not in used_labs:
        print(f"WARNING: lab-{n} from the original is not used in the new sections")
used_figs = re.findall(r'<p class="caption">Figure (\d+[a-z]?)\.', new)
if len(used_figs) != len(set(used_figs)):
    print("WARNING: duplicate figure numbers:", used_figs)
lab_ids = re.findall(r'\bid="lab-(\d+)"', new)
if len(lab_ids) != len(set(lab_ids)):
    print("WARNING: duplicate lab ids:", lab_ids)

# Preserve the module's line-ending style
nl = "\r\n" if "\r\n" in src else "\n"
new = new.replace("\r\n", "\n").rstrip().replace("\n", nl)
result = src[:start] + new + nl + nl + src[end:]
# renumber lettered scenario cards 1..n when the opening scenario owns the letters A-C
if re.search(r'<h4>Scenario [A-F][:<]', result) and 'ol type="A"' in result:
    result = re.sub(r"\bScenario ([A-F])\b", lambda m: "Scenario " + str("ABCDEF".index(m.group(1)) + 1), result)
with open(out, "w", encoding="utf-8", newline="") as f:   # newline="": write the line endings chosen above as they are
    f.write(result)
words_old = len(re.findall(r"\w+", re.sub(r"<pre.*?</pre>|<svg.*?</svg>|<[^>]+>", " ", region, flags=re.S)))
words_new = len(re.findall(r"\w+", re.sub(r"<pre.*?</pre>|<svg.*?</svg>|<[^>]+>", " ", new, flags=re.S)))
print(f"wrote {out}  concept prose: {words_old} -> {words_new} words; figure order: {used_figs}; labs: {lab_ids}")
