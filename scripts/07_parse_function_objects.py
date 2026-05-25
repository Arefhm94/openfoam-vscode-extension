#!/usr/bin/env python3
"""Script 07: Extract functionObject types and their keywords."""
import re, json
from pathlib import Path
from argparse import ArgumentParser

FODIR = 'src/functionObjects'
LOOKUP_RE = re.compile(r'dict\s*\.\s*(?:lookup|lookupOrDefault|readIfPresent|found)\s*\(\s*"([^"]+)"')
RRTS_RE = re.compile(r'addToRunTimeSelectionTable\s*\(\s*\w+\s*,\s*(\w+)\s*,')
BRIEF_RE = re.compile(r'(?://!|/\*[!*])\s*(.+?)(?:\*/|$)', re.DOTALL)

def main():
    ap = ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--out', default='data/07_function_objects.json')
    args = ap.parse_args()

    src = Path(args.src)
    base = src / FODIR
    result: dict = {}

    if base.exists():
        for c in base.rglob('*.C'):
            try:
                text = c.read_text(errors='ignore')
            except Exception:
                continue
            tm = RRTS_RE.search(text)
            if not tm:
                continue
            name = tm.group(1)
            name = name[0].lower() + name[1:]
            keywords = {m.group(1): {'required': True} for m in LOOKUP_RE.finditer(text)}
            h = c.with_suffix('.H')
            brief = ''
            if h.exists():
                try:
                    ht = h.read_text(errors='ignore')
                    bm = BRIEF_RE.search(ht)
                    if bm:
                        brief = ' '.join(bm.group(1).split()[:15])
                except Exception:
                    pass
            result[name] = {'brief': brief, 'keywords': keywords}

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2))
    print(f'Written {len(result)} function objects → {args.out}')

if __name__ == '__main__':
    main()
