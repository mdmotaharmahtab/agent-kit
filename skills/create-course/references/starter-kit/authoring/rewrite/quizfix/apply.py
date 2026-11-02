"""Apply option-text rewrites to a quiz bank: python3 apply.py m02
Reads quizfix/<bank>.json ({question id: {option index: new text}}), backs the bank up once to
authoring/rewrite/backup/, writes it back, and reports how often the correct option is still the
longest (tools/check_course.py fails a bank above 20%)."""
import json, shutil, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
bank = sys.argv[1]
qpath = ROOT / "quizzes" / f"{bank}.js"
backup = HERE.parent / "backup" / f"{bank}.quiz.before-lengthfix.js"
t = qpath.read_text(encoding="utf-8")
a = t.index("= [") + 2
head, qs = t[:a], json.loads(t[a:t.rindex("]") + 1])
fixes = json.loads((HERE / f"{bank}.json").read_text(encoding="utf-8"))
byid = {q["id"]: q for q in qs}
for qid, opts in fixes.items():
    if qid not in byid:
        raise SystemExit(f"{bank}: no question {qid!r} in the bank; nothing written")
    for i in opts:
        if not 0 <= int(i) < len(byid[qid]["options"]):
            raise SystemExit(f"{bank}: {qid} has no option {i} (indexes start at 0); nothing written")
backup.parent.mkdir(parents=True, exist_ok=True)
if not backup.exists():
    shutil.copy(qpath, backup)
for qid, opts in fixes.items():
    for i, text in opts.items():
        byid[qid]["options"][int(i)]["text"] = text
still = [q["id"] for q in qs if max(q["options"], key=lambda o: len(o["text"])).get("correct")]
qpath.write_text(head.rstrip("[").rstrip() + " " + json.dumps(qs, indent=2, ensure_ascii=False) + ";\n", encoding="utf-8")
print(f"{bank}: correct option still the longest in {len(still)}/{len(qs)} ({len(still) / max(len(qs), 1):.0%}; the checker allows 20%): {still}")
