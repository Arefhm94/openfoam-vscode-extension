#!/usr/bin/env python3
"""
Script 01: Discover every runtime-selectable keyword across the OpenFOAM source tree.
Groups schemes by base class (scheme category).

Usage:
    python3 scripts/01_discover_schemes.py --src /path/to/OpenFOAM-13 --out data/01_scheme_registry.json
"""

import re, json, sys
from pathlib import Path
from argparse import ArgumentParser

CATEGORY_MAP = {
    'gradScheme':          r'gradScheme',
    'divScheme':           r'divScheme',
    'laplacianScheme':     r'laplacianScheme',
    'interpolationScheme': r'interpolationScheme',
    'snGradScheme':        r'snGradScheme',
    'ddtScheme':           r'ddtScheme',
    'd2dt2Scheme':         r'd2dt2Scheme',
    'fluxScheme':          r'fluxScheme',
    'RASModel':            r'RASModel|RASturb',
    'LESModel':            r'LESModel|LESturb',
    'wallModel':           r'wallModel',
    'fvOption':            r'fvOption',
    'functionObject':      r'functionObject|functionObjects',
    'decompositionMethod': r'decompositionMethod',
    'patchType':           r'patchType',
    'wallDistMethod':      r'wallDistMethod',
    'fvConstraint':        r'fvConstraint',
}

MACRO_PATTERNS = [
    re.compile(r'addToRunTimeSelectionTable\s*\(\s*(\w+)\s*,\s*(\w+)\s*,\s*(?:dictionary|word)\s*\)'),
    re.compile(r'addNamedToRunTimeSelectionTable\s*\(\s*(\w+)\s*,\s*(\w+)\s*,\s*\w+\s*,\s*(\w+)\s*\)'),
    re.compile(r'makeInterpolationScheme\s*\(\s*(\w+)\s*\)'),
    re.compile(r'makeSnGradScheme\s*\(\s*(\w+)\s*\)'),
    re.compile(r'makeLimitedSurfaceInterpolationScheme\s*\(\s*(\w+)\s*\)'),
    re.compile(r'makeFvWallDistanceMethod\s*\(\s*(\w+)\s*\)'),
]

def classify_base(base_class: str) -> str:
    for cat, pat in CATEGORY_MAP.items():
        if re.search(pat, base_class, re.IGNORECASE):
            return cat
    return base_class

def discover(src_root: Path) -> dict:
    registry: dict = {'version': '13', 'categories': {}}
    cats = registry['categories']

    for ext in ('*.C', '*.H'):
        for fpath in src_root.rglob(ext):
            try:
                text = fpath.read_text(errors='ignore')
            except Exception:
                continue
            rel = str(fpath.relative_to(src_root))

            for macro in MACRO_PATTERNS:
                for m in macro.finditer(text):
                    g = m.groups()
                    if len(g) == 3:
                        base, concrete, keyword = g
                    elif len(g) == 2:
                        base, concrete = g
                        keyword = concrete
                    else:
                        keyword = g[0]; base = 'interpolationScheme'; concrete = g[0]

                    cat = classify_base(base)
                    cats.setdefault(cat, {'baseClass': f'Foam::{base}', 'members': {}})
                    cats[cat]['members'][keyword] = {
                        'concreteClass': f'Foam::{concrete}',
                        'sourceFile': rel,
                        'headerFile': rel.replace('.C', '.H'),
                    }

    return registry

def main():
    ap = ArgumentParser()
    ap.add_argument('--src', required=True, help='Path to OpenFOAM-13 source root')
    ap.add_argument('--out', default='data/01_scheme_registry.json')
    args = ap.parse_args()

    src = Path(args.src)
    if not src.exists():
        print(f'ERROR: source path {src} does not exist', file=sys.stderr)
        sys.exit(1)

    print(f'Scanning {src} ...', file=sys.stderr)
    registry = discover(src)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(registry, indent=2))

    total = sum(len(v['members']) for v in registry['categories'].values())
    print(f'Found {total} members across {len(registry["categories"])} categories → {out}')

if __name__ == '__main__':
    main()
