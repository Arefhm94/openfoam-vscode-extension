#!/usr/bin/env python3
"""
Script 06: Extract turbulence model coefficients from OpenFOAM source.

Usage:
    python3 scripts/06_parse_turbulence_models.py \
        --src /path/to/OpenFOAM-13 --out data/06_turbulence_models.json
"""

import re, json
from pathlib import Path
from argparse import ArgumentParser

TURB_DIRS = {
    'RAS': 'src/MomentumTransportModels/momentumTransportModels/RAS',
    'LES': 'src/MomentumTransportModels/momentumTransportModels/LES',
}

COEFF_RE  = re.compile(
    r'coeffDict_\s*\.\s*lookupOrDefault\s*\(\s*"([^"]+)"\s*,\s*([^)]+)\)'
)
LOOKUP_RE = re.compile(
    r'coeffDict_\s*\.\s*lookup\s*\(\s*"([^"]+)"\s*\)'
)
BRIEF_RE  = re.compile(r'(?://!|/\*[!*])\s*(.+?)(?:\*/|$)', re.DOTALL)
RRTS_RE   = re.compile(r'addToRunTimeSelectionTable\s*\(\s*\w+\s*,\s*(\w+)\s*,')
FIELD_RE  = re.compile(r'lookupField\s*<[^>]+>\s*\(\s*"([^"]+)"\s*\)')

def guess_type(default_str: str) -> str:
    d = default_str.strip()
    if d in ('true','false','on','off','yes','no'):
        return 'boolean'
    try:
        float(d); return 'scalar'
    except ValueError:
        pass
    try:
        int(d); return 'integer'
    except ValueError:
        pass
    return 'word'

def parse_model(c_file: Path) -> dict:
    try:
        text = c_file.read_text(errors='ignore')
    except Exception:
        return {}

    coeffs: dict = {}
    for m in COEFF_RE.finditer(text):
        name, default_str = m.group(1), m.group(2).strip().rstrip(')')
        coeffs[name] = {'type': guess_type(default_str), 'default': default_str}
    for m in LOOKUP_RE.finditer(text):
        name = m.group(1)
        if name not in coeffs:
            coeffs[name] = {'type': 'scalar', 'required': True}

    required_fields = list({m.group(1) for m in FIELD_RE.finditer(text)})

    h_file = c_file.with_suffix('.H')
    brief = ''
    if h_file.exists():
        try:
            ht = h_file.read_text(errors='ignore')
            bm = BRIEF_RE.search(ht)
            if bm:
                brief = ' '.join(bm.group(1).split()[:20])
        except Exception:
            pass

    return {'brief': brief, 'requiredFields': required_fields, 'coefficients': coeffs}

def main():
    ap = ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--out', default='data/06_turbulence_models.json')
    args = ap.parse_args()

    src = Path(args.src)
    result: dict = {}

    for regime, rel_dir in TURB_DIRS.items():
        result[regime] = {}
        base = src / rel_dir
        if not base.exists():
            # Try alternative locations
            for alt in ['src/TurbulenceModels', 'src/transportModels']:
                alt_path = src / alt
                if alt_path.exists():
                    base = alt_path
                    break

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
            model_name = tm.group(1)
            # Strip common suffixes
            for suffix in ['RAS', 'LES', 'Model']:
                if model_name.endswith(suffix) and len(model_name) > len(suffix):
                    pass
            data = parse_model(c)
            if data:
                result[regime][model_name] = data

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2))
    print(f'Written {args.out}')

if __name__ == '__main__':
    main()
