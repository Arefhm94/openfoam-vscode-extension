#!/usr/bin/env python3
"""
Script 02: Parse Istream constructors of each discovered scheme to determine
the exact token sequence expected (format string + argument list).

Usage:
    python3 scripts/02_parse_constructors.py \
        --src /path/to/OpenFOAM-13 \
        --registry data/01_scheme_registry.json \
        --out data/02_constructor_signatures.json
"""

import re, json, sys
from pathlib import Path
from argparse import ArgumentParser

READ_PATTERNS = [
    (re.compile(r'readScalar\s*\(\s*is\s*\)'),          'scalar',  None),
    (re.compile(r'readLabel\s*\(\s*is\s*\)'),            'integer', None),
    (re.compile(r'Switch\s*\(\s*is\s*\)'),               'boolean', None),
    (re.compile(r'word\s+\w+\s*\(\s*is\s*\)'),           'word',    None),
    (re.compile(r'is\s*>>\s*\w+'),                        'word',    None),
    (re.compile(r'interpolationScheme.*?New\s*\('),       'scheme',  'interpolationScheme'),
    (re.compile(r'gradScheme.*?New\s*\('),                'scheme',  'gradScheme'),
    (re.compile(r'snGradScheme.*?New\s*\('),              'scheme',  'snGradScheme'),
]

OPTIONAL_RE = re.compile(r'if\s*\(\s*is\s*\.\s*good\s*\(\s*\)|is\s*\.\s*peek\s*\(\s*\)\s*!=')

RANGE_RE = re.compile(r'//.*?(\d+\.?\d*)\s*[-–to]+\s*(\d+\.?\d*)')

def extract_constructor_body(src_text: str, class_name: str) -> str:
    pattern = re.compile(
        rf'{re.escape(class_name)}\s*\([^)]*Istream[^)]*\)\s*:', re.DOTALL
    )
    m = pattern.search(src_text)
    if not m:
        return ''
    start = m.end()
    depth = 0
    for i, ch in enumerate(src_text[start:], start):
        if ch == '{': depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                return src_text[start:i+1]
    return ''

def parse_arguments(body: str) -> list:
    args = []
    in_optional = False
    for line in body.splitlines():
        if OPTIONAL_RE.search(line):
            in_optional = True
        for pat, atype, scheme_cat in READ_PATTERNS:
            if pat.search(line):
                arg: dict = {
                    'position': len(args),
                    'type': atype,
                    'required': not in_optional,
                }
                if scheme_cat:
                    arg['schemeCategory'] = scheme_cat
                    arg['name'] = scheme_cat
                else:
                    arg['name'] = atype
                rm = RANGE_RE.search(line)
                if rm and atype == 'scalar':
                    arg['range'] = [float(rm.group(1)), float(rm.group(2))]
                args.append(arg)
                break
    return args

def build_format(scheme_name: str, arguments: list) -> str:
    parts = [scheme_name]
    for arg in arguments:
        t = arg['type']
        if t == 'scheme':
            parts.append(f'<{arg["schemeCategory"]}>')
        elif t == 'scalar':
            if 'range' in arg:
                lo, hi = arg['range']
                parts.append(f'<{arg["name"]}:{lo}-{hi}>')
            else:
                parts.append(f'<{arg["name"]}>')
        elif t == 'boolean':
            parts.append('<on|off>')
        else:
            parts.append(f'<{arg.get("name", t)}>')
        if not arg['required']:
            parts[-1] = f'[{parts[-1]}]'
    return ' '.join(parts)

def process(src_root: Path, registry: dict) -> dict:
    signatures: dict = {}
    for cat, cat_data in registry.get('categories', {}).items():
        signatures[cat] = {}
        for keyword, member in cat_data.get('members', {}).items():
            src_file = src_root / member.get('sourceFile', '')
            body = ''
            if src_file.exists():
                try:
                    text = src_file.read_text(errors='ignore')
                    body = extract_constructor_body(text, member.get('concreteClass', '').split('::')[-1])
                except Exception:
                    pass
            args = parse_arguments(body)
            signatures[cat][keyword] = {
                'format': build_format(keyword, args),
                'arguments': args,
            }
    return signatures

def main():
    ap = ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--registry', default='data/01_scheme_registry.json')
    ap.add_argument('--out', default='data/02_constructor_signatures.json')
    args = ap.parse_args()

    src = Path(args.src)
    registry = json.loads(Path(args.registry).read_text())
    sigs = process(src, registry)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(sigs, indent=2))
    print(f'Written {args.out}')

if __name__ == '__main__':
    main()
