#!/usr/bin/env python3
"""
Script 04: Extract all boundary condition (patch field) types from OpenFOAM source.

Usage:
    python3 scripts/04_parse_boundary_conditions.py \
        --src /path/to/OpenFOAM-13 --out data/04_boundary_conditions.json
"""

import re, json
from pathlib import Path
from argparse import ArgumentParser

PATCH_DIRS = [
    'src/finiteVolume/fields/fvPatchFields',
    'src/finiteVolume/fields/fvsPatchFields',
    'src/finiteVolume/fields/pointPatchFields',
]

LOOKUP_RE = re.compile(
    r'dict\s*\.\s*(lookup|lookupOrDefault|found|readIfPresent)\s*\(\s*"([^"]+)"'
)
TYPE_RE   = re.compile(r'addToRunTimeSelectionTable\s*\(\s*\w+\s*,\s*(\w+)\s*,')
BRIEF_RE  = re.compile(r'(?://!|/\*!)\s*(.+?)(?:\*/|$)', re.DOTALL)

FIELD_TYPES = {
    'scalar': re.compile(r'<scalar>|<Scalar>|volScalarField|fvPatchScalarField'),
    'vector': re.compile(r'<vector>|<Vector>|volVectorField|fvPatchVectorField'),
    'tensor': re.compile(r'<tensor>|<Tensor>|volTensorField|fvPatchTensorField'),
    'symmTensor': re.compile(r'<symmTensor>|volSymmTensorField'),
}

def parse_bc_from_files(src_root: Path, dir_rel: str) -> dict:
    result: dict = {}
    base = src_root / dir_rel
    if not base.exists():
        return result

    for c_file in base.rglob('*.C'):
        try:
            text = c_file.read_text(errors='ignore')
        except Exception:
            continue

        tm = TYPE_RE.search(text)
        if not tm:
            continue
        bc_name = tm.group(1)

        # Remove common suffixes to get the user-facing name
        for suffix in ['FvPatchField', 'FvsPatchField', 'fvPatchField', 'PatchField']:
            if bc_name.endswith(suffix):
                bc_name = bc_name[:-len(suffix)]
                bc_name = bc_name[0].lower() + bc_name[1:]
                break

        applies_to = [ft for ft, pat in FIELD_TYPES.items() if pat.search(text)]

        keywords: dict = {}
        for m in LOOKUP_RE.finditer(text):
            method, key = m.group(1), m.group(2)
            keywords[key] = {
                'required': method == 'lookup',
                'description': '',
            }

        h_file = c_file.with_suffix('.H')
        brief = ''
        if h_file.exists():
            try:
                h_text = h_file.read_text(errors='ignore')
                bm = BRIEF_RE.search(h_text)
                if bm:
                    brief = ' '.join(bm.group(1).split())
            except Exception:
                pass

        result[bc_name] = {
            'brief': brief,
            'appliesTo': applies_to or ['scalar', 'vector'],
            'keywords': keywords,
        }

    return result

def main():
    ap = ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--out', default='data/04_boundary_conditions.json')
    args = ap.parse_args()

    src = Path(args.src)
    all_bcs: dict = {}
    for d in PATCH_DIRS:
        all_bcs.update(parse_bc_from_files(src, d))

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(all_bcs, indent=2))
    print(f'Written {len(all_bcs)} boundary conditions → {args.out}')

if __name__ == '__main__':
    main()
