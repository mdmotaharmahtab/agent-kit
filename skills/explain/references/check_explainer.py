"""Mechanical hints for explanatory documents (HTML or Markdown). Standard library only.

Usage: python3 check_explainer.py <file.html|file.md> [--known WORD,WORD]

Sections are the h2 (##) headings; headings inside <nav>, <style>, <script> and <svg> do not count. The
summary is the text before the first h2, plus any h2 section whose title starts "Short version" or "Summary".
Markdown fenced code (``` or ~~~ fences) is never read as prose or headings. A fence counts as a figure when
it is a mermaid block or holds a "Figure N." or "Table N." caption line (a fenced text diagram).

Flags, in reading order:
  ACRONYM     an all-caps term whose first use is not expanded nearby
  IDENT-EARLY a code identifier inside the title, headings or the first section
  PREAMBLE    a filler phrase the explain skill forbids
  FORWARD     a forward reference ("later", "see section 3", ...)
  EMDASH      an em dash in prose (the explain skill bans em dashes; en dashes are not flagged)
  NO-FIGURE   a main section (h2 / ##) with no figure, or with more than 400 words per figure
              (figures: <svg>, <img>, <figure>, or an element whose class contains "mock" or
              "figure"; in Markdown, images, mermaid blocks, and lines starting "Figure N." or
              "Table N." as captions of text figures and tables). Sections such as the glossary,
              an appendix, the contents or the summary are not checked.
  USED-BEFORE-DEFINED
              a term the document defines (in <b>, <strong> or <dfn> in prose; in Markdown,
              **bold**) that already appears in an earlier subsection (h2/h3/h4 block), in
              prose, a table, a caption or figure text (SVG labels included). In the same
              subsection, a figure is flagged only if more than three paragraphs separate it
              from the definition; a figure just above its own explanation is allowed. Labels ending in
              "." or ":" and story labels are not treated as definitions.
  SUMMARY-USE one line listing defined terms that the summary uses before the background defines them
The newcomer review is the real test; treat this output as hints.
"""
import html.parser
import re
import sys
from pathlib import Path

GENERAL = set("""API APIS PDF HTML CSS JSON XML SQL URL UI ID IDS AI LLM LLMS CSV OK IT US UK CPU GPU
HTTP HTTPS CLI IDE OS PC TODO FAQ PR CI CD AWS GCP SDK UUID UTF ASCII CSV XLS XLSX DOCX NAN TRUE FALSE
OR AND NOT IF GB MB KB TB PM AM II III IV VI VII VIII IX XI XII""".split())
PREAMBLES = ["note that", "keep in mind", "it is worth noting", "it's worth noting", "before we dive",
             "importantly,", "in this section we will", "in this section, we will", "let's dive",
             "as mentioned earlier", "it should be noted"]
FORWARD = re.compile(r"\b(later in this|as shown later|shown below|see below|we will see|you will see|"
                     r"comes back|we return to|return to this|see section \d|in section \d+ we)\b", re.I)
ACR = re.compile(r"\b[A-Z][A-Z0-9]{1,7}s?\b")
SKIP = ("style", "script", "nav", "svg")     # HTML elements whose text and headings are not the document's prose
SUMMARY_TITLE = re.compile(r"\s*(?:\d+[.)]?\s*)?(?:short version|summary)\b", re.I)
FENCE = re.compile(r"\s*(`{3,}|~{3,})(.*)")
CAPTION = re.compile(r"\**(Figure|Table) \d+[.:]")


def md_lines(text):
    """Each Markdown line with its role: ("text", line); ("fence", info) for the line that opens fenced code,
    where info is what follows the fence, such as "mermaid"; ("code", line) inside the fence and on its closing line.
    A fence closes on a line of the same character, at least as long; an unclosed fence runs to the end."""
    fence = None
    for line in text.splitlines():
        m = FENCE.fullmatch(line)
        if fence is None:
            if m and not (m.group(1)[0] == "`" and "`" in m.group(2)):
                fence = m.group(1)
                yield "fence", m.group(2).strip()
            else:
                yield "text", line
        else:
            if m and m.group(1)[0] == fence[0] and len(m.group(1)) >= len(fence) and not m.group(2).strip():
                fence = None
            yield "code", line


class Collector(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.skip = 0
        self.stack = []
        self.chunks = []  # (text, tags, section_index)
        self.section = 0
        self.figures = {}
        self.titles = {}

    def handle_starttag(self, tag, attrs):
        cls = dict(attrs).get("class") or ""
        if tag in ("svg", "img", "figure") or "mock" in cls or "figure" in cls:
            if not self.skip:
                self.figures[self.section] = self.figures.get(self.section, 0) + 1
        if tag in SKIP:
            self.skip += 1
        if tag == "h2" and not self.skip:      # a "Contents" heading in the nav is not a section
            self.section += 1
        self.stack.append(tag)

    def handle_endtag(self, tag):
        if tag in SKIP:
            self.skip = max(0, self.skip - 1)
        while self.stack:
            if self.stack.pop() == tag:
                break

    def handle_data(self, data):
        if self.skip or not data.strip():
            return
        if self.stack and self.stack[-1] == "h2":
            self.titles[self.section] = (self.titles.get(self.section, "") + data).strip()
        self.chunks.append((data, tuple(self.stack), self.section))


def load(path):
    text = Path(path).read_text(encoding="utf-8")
    if path.lower().endswith((".html", ".htm")):
        c = Collector()
        c.feed(text)
        return c.chunks, c.figures, c.titles
    chunks, section, figures, titles = [], 0, {}, {}
    for role, line in md_lines(text):
        if (role == "fence" and line.lower().startswith("mermaid")) or (role == "code" and CAPTION.match(line.strip())):
            figures[section] = figures.get(section, 0) + 1
        if role != "text":
            continue
        if line.startswith("## "):
            section += 1
            titles[section] = line[3:].strip()
        if line.strip().startswith("![") or CAPTION.match(line.strip()):
            figures[section] = figures.get(section, 0) + 1
        tags = ("h",) if line.startswith("#") else ()
        for i, part in enumerate(re.split(r"`([^`]+)`", line)):
            if part.strip():
                chunks.append((part, tags + (("code",) if i % 2 else ()), section))
    return chunks, figures, titles


def summary_blocks(block_h2, titles):
    """The heading blocks that make up the summary: those before the first h2, and those of an h2 section
    titled "Short version" or "Summary". block_h2[b] is the number of the h2 section block b belongs to."""
    return {b for b, h in enumerate(block_h2) if h == 0 or SUMMARY_TITLE.match(titles.get(h, ""))}


class OrderCollector(html.parser.HTMLParser):
    """Visible text in reading order (figure labels included), split into heading blocks."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.skip = 0          # style, script, nav
        self.svg = 0
        self.stack = []
        self.block = 0         # increments at every h2/h3/h4 outside nav, style, script and svg
        self.block_h2 = [0]    # per block: the h2 section it belongs to (0 = before the first h2)
        self.h2_titles = {}    # h2 number -> its title
        self.pieces = []       # (text, where, block)
        self.defs = []         # (term, block)
        self.cut = False       # stop at glossary / appendix
        self.bold = None
        self.n_h2 = 0
        self.mock = []         # parallel to stack: is this element (or an ancestor) a mock screenshot?

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        self.mock.append(bool(self.mock and self.mock[-1]) or "mock" in (a.get("class") or ""))
        if tag in ("style", "script", "nav"):
            self.skip += 1
        if tag == "svg":
            self.svg += 1
        if tag in ("h2", "h3", "h4") and not self.skip and not self.svg:
            self.block += 1
            if tag == "h2":
                self.n_h2 += 1
                self.h2_titles[self.n_h2] = ""
                if (a.get("id") or "") in ("glossary", "appendix"):
                    self.cut = True
            self.block_h2.append(self.n_h2)
        if tag in ("b", "strong", "dfn") and not self.svg and "lbl" not in (a.get("class") or "") and not self.mock[-1]:
            self.bold = []
        self.stack.append(tag)

    def handle_endtag(self, tag):
        if tag in ("style", "script", "nav"):
            self.skip = max(0, self.skip - 1)
        if tag == "svg":
            self.svg = max(0, self.svg - 1)
        if tag in ("b", "strong", "dfn") and self.bold is not None:
            term = re.sub(r"\s+", " ", "".join(self.bold)).strip()
            heading = any(t in ("h1", "h2", "h3", "h4", "th", "figcaption") for t in self.stack)
            if (not heading and not self.cut and 3 <= len(term) <= 40
                    and not term.endswith((".", ":", "?", "!", ",")) and not re.search(r"\d", term)):
                self.defs.append((term, self.block, len(self.pieces) - len(self.bold)))
            self.bold = None
        while self.stack:
            self.mock.pop()
            if self.stack.pop() == tag:
                break

    def handle_data(self, data):
        if self.skip or self.cut or not data.strip():
            return
        if "h2" in self.stack and not self.svg and self.n_h2 in self.h2_titles:
            self.h2_titles[self.n_h2] += data
        if self.bold is not None:
            self.bold.append(data)
        where = "figure" if (self.svg or "figcaption" in self.stack) else (
            "heading" if any(t in ("h1", "h2", "h3", "h4") for t in self.stack) else "prose")
        self.pieces.append((data, where, self.block))


def order_findings(path):
    """A defined term used in an earlier heading block than the one that defines it."""
    text = Path(path).read_text(encoding="utf-8")
    if path.lower().endswith((".html", ".htm")):
        c = OrderCollector()
        c.feed(text)
        pieces, defs, summary = c.pieces, c.defs, summary_blocks(c.block_h2, c.h2_titles)
    else:
        pieces, defs, block, n_h2, block_h2, titles = [], [], 0, 0, [0], {}
        for role, line in md_lines(text):
            if role != "text":
                continue
            if re.match(r"#{2,4}\s", line):
                if re.match(r"##\s+(glossary|appendix)", line, re.I):
                    break
                block += 1
                if line.startswith("## "):
                    n_h2 += 1
                    titles[n_h2] = line[3:].strip()
                block_h2.append(n_h2)
            for m in re.finditer(r"\*\*([^*]{3,40})\*\*", line):
                if not m.group(1).endswith((".", ":", "?", "!", ",")):
                    defs.append((m.group(1).strip(), block))
            pieces.append((line, "heading" if line.startswith("#") else "prose", block))
        summary = summary_blocks(block_h2, titles)
    out, done, in_summary = [], set(), []
    for d in defs:
        term, dblock = d[0], d[1]
        dpos = d[2] if len(d) > 2 else None
        key = term.lower()
        if key in done:
            continue
        done.add(key)
        pat = re.compile(r"(?<![A-Za-z])" + re.escape(key) + r"(s|es)?(?![A-Za-z])", re.I)
        for idx, (t, where, block) in enumerate(pieces):
            if block > dblock or (dpos is not None and idx >= dpos) or (dpos is None and block >= dblock):
                break
            if block == dblock:
                # same subsection: only a figure far above its explanation is a problem
                prose_between = sum(1 for t2, w2, b2 in pieces[idx:dpos] if w2 == "prose" and len(t2.split()) > 6)
                if where != "figure" or prose_between <= 3 or not pat.search(t):
                    continue
                ctx = re.sub(r"\s+", " ", t.strip())[:80]
                out.append(("USED-BEFORE-DEFINED",
                            f'"{term}" appears in a figure {prose_between} paragraphs before this subsection defines it: {ctx}'))
                break
            if pat.search(t):
                if block in summary:
                    in_summary.append(term)
                else:
                    ctx = re.sub(r"\s+", " ", t.strip())[:80]
                    out.append(("USED-BEFORE-DEFINED",
                                f'"{term}" is defined in a later subsection but used first in {where}: {ctx}'))
                break
    if in_summary:
        out.append(("SUMMARY-USE", "terms used in the title or summary before the background defines them "
                    "(check each is plain enough there): " + ", ".join(in_summary)))
    return out


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    args = sys.argv[1:]
    known = set(GENERAL)
    if "--known" in args:
        i = args.index("--known")
        if i + 1 >= len(args) or args[i + 1].startswith("--"):
            print("--known needs a comma-separated list of terms the reader knows, for example: --known MCP,RAG")
            sys.exit(2)
        known |= {w.strip().upper() for w in args[i + 1].split(",") if w.strip()}
        del args[i:i + 2]
    if not args:
        print(__doc__)
        return
    path = args[0]
    chunks, figures, titles = load(path)
    full = " ".join(t for t, _, _ in chunks)
    seen, findings = set(), []
    pos = 0
    for text, tags, section in chunks:
        in_code = "code" in tags or "pre" in tags
        heading = any(t in ("h1", "h2", "h3", "h4", "title", "h") for t in tags)
        ctx = re.sub(r"\s+", " ", text.strip())[:90]
        if in_code and (heading or section <= 1) and len(text.strip()) > 1:
            findings.append(("IDENT-EARLY", f"`{text.strip()[:40]}` in {'heading' if heading else 'opening section'}"))
        if not in_code:
            low = text.lower()
            for p in PREAMBLES:
                if p in low:
                    findings.append(("PREAMBLE", f'"{p}": {ctx}'))
            m = FORWARD.search(text)
            if m:
                findings.append(("FORWARD", f'"{m.group(0)}": {ctx}'))
            if "—" in text and text.strip() != "—":
                findings.append(("EMDASH", ctx))
            for m in ACR.finditer(text):
                word = m.group(0)
                if word.endswith("s") and word[:-1].isupper():
                    word = word[:-1]
                if word in known or word in seen or word.isdigit() or re.fullmatch(r"[A-Z]\d+", word):
                    continue
                seen.add(word)
                at = full.find(text, pos)
                window = full[max(0, at + m.start() - 90): at + m.end() + 250]
                expanded = re.search(r"\(\s*" + re.escape(word) + r"s?\s*\)", window) or \
                    re.search(re.escape(word) + r"s?\s*\(\s*[A-Za-z][a-z]", window) or \
                    re.search(re.escape(word) + r"s?\s*(means|stands for|is short for|=|is the|is a|is an|are the)\b", window) or \
                    re.search(r"\b(short for|stands for)\b", window[90:])
                if not expanded and re.search(r"(do not|don't|need not) need to know|do not need to know|no need to know", text, re.I):
                    seen.discard(word)          # "you do not need to know X" is not where X is first used
                    continue
                if not expanded:
                    findings.append(("ACRONYM", f"{word} first used without expansion: {ctx}"))
        pos = full.find(text, pos) + len(text) if full.find(text, pos) >= 0 else pos
    words = {}
    for text, _, section in chunks:
        words[section] = words.get(section, 0) + len(text.split())
    skip_titles = ("glossary", "appendix", "contents", "open questions", "all findings", "suggested order",
                   "short version", "summary", "next tests", "next steps")
    for section in sorted(titles):
        title = titles[section]
        if any(t in title.lower() for t in skip_titles):
            continue
        n_fig, n_words = figures.get(section, 0), words.get(section, 0)
        if n_fig == 0:
            findings.append(("NO-FIGURE", f'section "{title[:50]}" ({n_words} words) has no figure'))
        elif n_words / n_fig > 400:
            findings.append(("NO-FIGURE", f'section "{title[:50]}": {n_words} words, {n_fig} figure(s); about 400 words per figure is the budget'))
    findings.extend(order_findings(path))
    counts = {}
    for kind, msg in findings:
        counts[kind] = counts.get(kind, 0) + 1
        print(f"{kind:12s} {msg}")
    print("\nSummary:", ", ".join(f"{k} {v}" for k, v in sorted(counts.items())) or "no findings")


if __name__ == "__main__":
    main()
