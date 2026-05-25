#!/usr/bin/env python3
"""
Script 05: Extract linear solvers, smoothers, preconditioners, and algorithm
keywords (SIMPLE/PIMPLE/PISO) from fvSolution-related source files.

Usage:
    python3 scripts/05_parse_fvSolution.py \
        --src /path/to/OpenFOAM-13 --out data/05_fvSolution.json
"""

import re, json
from pathlib import Path
from argparse import ArgumentParser

SOLVER_DIRS = [
    'src/OpenFOAM/matrices/lduMatrix/solvers',
    'src/OpenFOAM/matrices/lduMatrix/smoothers',
    'src/OpenFOAM/matrices/lduMatrix/preconditioners',
]
ALGO_DIRS = ['src/finiteVolume/cfdTools']

LOOKUP_RE = re.compile(
    r'dict\s*\.\s*(?:lookup|lookupOrDefault|readIfPresent|found)\s*\(\s*"([^"]+)"'
)
RRTS_RE = re.compile(r'addToRunTimeSelectionTable\s*\(\s*\w+\s*,\s*(\w+)\s*,')

KNOWN_ALGORITHMS = {
    'SIMPLE': {
        'keywords': {
            'nNonOrthogonalCorrectors': {'type': 'integer', 'default': 0},
            'consistent': {'type': 'boolean', 'default': False},
            'residualControl': {'type': 'dict', 'description': 'Per-field convergence criteria'},
        }
    },
    'PIMPLE': {
        'keywords': {
            'nOuterCorrectors': {'type': 'integer', 'required': True},
            'nCorrectors': {'type': 'integer', 'required': True},
            'nNonOrthogonalCorrectors': {'type': 'integer', 'default': 0},
            'turbOnFinalIterOnly': {'type': 'boolean', 'default': True},
            'residualControl': {'type': 'dict'},
        }
    },
    'PISO': {
        'keywords': {
            'nCorrectors': {'type': 'integer', 'required': True},
            'nNonOrthogonalCorrectors': {'type': 'integer', 'default': 0},
        }
    },
    'FLUID': {
        'keywords': {
            'nOuterCorrectors': {'type': 'integer', 'required': True},
            'residualControl': {'type': 'dict'},
        }
    },
}

def parse_solvers(src_root: Path) -> dict:
    solvers: dict = {}
    for d in SOLVER_DIRS:
        base = src_root / d
        if not base.exists():
            continue
        for c in base.rglob('*.C'):
            try:
                text = c.read_text(errors='ignore')
            except Exception:
                continue
            tm = RRTS_RE.search(text)
            if not tm:
                continue
            class_name = tm.group(1)
            keywords = {m.group(1): {'required': True} for m in LOOKUP_RE.finditer(text)}
            solvers[class_name] = {'keywords': keywords}

    return solvers

def main():
    ap = ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--out', default='data/05_fvSolution.json')
    args = ap.parse_args()

    src = Path(args.src)
    solvers = parse_solvers(src)

    out_data = {'linearSolvers': solvers, 'algorithms': KNOWN_ALGORITHMS}
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(out_data, indent=2))
    print(f'Written {args.out}')

if __name__ == '__main__':
    main()
