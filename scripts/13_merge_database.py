#!/usr/bin/env python3
"""
Script 13: Merge all data/0N_*.json files into data/keyword-db.json
optimized for LSP consumption.

Usage:
    python3 scripts/13_merge_database.py --out data/keyword-db.json
"""

import json, re
from datetime import datetime, timezone
from pathlib import Path
from argparse import ArgumentParser

def load(path: str) -> dict:
    p = Path(path)
    if p.exists():
        try:
            return json.loads(p.read_text())
        except Exception:
            return {}
    return {}

def main():
    ap = ArgumentParser()
    ap.add_argument('--out', default='data/keyword-db.json')
    args = ap.parse_args()

    registry   = load('data/01_scheme_registry.json')
    signatures = load('data/02_constructor_signatures.json')
    descs      = load('data/03_descriptions.json')
    bcs        = load('data/04_boundary_conditions.json')
    fvsol      = load('data/05_fvSolution.json')
    turb       = load('data/06_turbulence_models.json')
    fobjs      = load('data/07_function_objects.json')
    thermo     = load('data/08_thermophysical.json')
    snappy     = load('data/09_snappyHexMesh.json')
    blockmesh  = load('data/10_blockMesh.json')
    decomppar  = load('data/11_decomposePar.json')
    cdict      = load('data/12_controlDict.json')

    # Build merged scheme entries: merge signature + description per keyword
    schemes: dict = {}
    for cat, cat_data in registry.get('categories', {}).items():
        schemes[cat] = {}
        for kw in cat_data.get('members', {}):
            sig  = signatures.get(cat, {}).get(kw, {})
            desc = descs.get(cat, {}).get(kw, {})
            schemes[cat][kw] = {
                'format':      sig.get('format', kw),
                'arguments':   sig.get('arguments', []),
                'brief':       desc.get('brief', ''),
                'detail':      desc.get('detail', ''),
                'usage':       desc.get('usage', ''),
                'notes':       desc.get('notes', []),
                'warnings':    desc.get('warnings', []),
                'see':         desc.get('see', []),
            }

    # Context map
    contexts: dict = {
        'fvSchemes.gradSchemes.*':      {'schemes': {'$ref': 'gradScheme'}},
        'fvSchemes.divSchemes.*':        {'schemes': {'$ref': 'divScheme'}},
        'fvSchemes.laplacianSchemes.*':  {'schemes': {'$ref': 'laplacianScheme'}},
        'fvSchemes.interpolationSchemes.*': {'schemes': {'$ref': 'interpolationScheme'}},
        'fvSchemes.snGradSchemes.*':     {'schemes': {'$ref': 'snGradScheme'}},
        'fvSchemes.ddtSchemes.*':        {'schemes': {'$ref': 'ddtScheme'}},
        'fvSchemes.d2dt2Schemes.*':      {'schemes': {'$ref': 'd2dt2Scheme'}},
        'fvSolution.solvers.*':          {'keywords': {'$ref': 'linearSolvers'}},
        'fvSolution.SIMPLE':             {'keywords': {'$ref': 'algorithms.SIMPLE'}},
        'fvSolution.PIMPLE':             {'keywords': {'$ref': 'algorithms.PIMPLE'}},
        'fvSolution.PISO':               {'keywords': {'$ref': 'algorithms.PISO'}},
        'turbulenceProperties.RAS':      {'keywords': {
            'RASModel':  {'type': 'word', 'options': {'$ref': 'turbulenceModels.RAS.keys'}},
            'turbulence': {'type': 'boolean'},
            'printCoeffs': {'type': 'boolean'},
        }},
        'turbulenceProperties.LES':      {'keywords': {
            'LESModel':  {'type': 'word', 'options': {'$ref': 'turbulenceModels.LES.keys'}},
            'turbulence': {'type': 'boolean'},
            'printCoeffs': {'type': 'boolean'},
        }},
        'boundaryField.*.type':          {'options': {'$ref': 'boundaryConditions.keys'}},
        'controlDict':                   {'keywords': {'$ref': 'controlDict.keywords'}},
        'snappyHexMeshDict':             {'keywords': {'$ref': 'snappyHexMesh'}},
        'blockMeshDict':                 {'keywords': {'$ref': 'blockMesh.keywords'}},
        'decomposeParDict':              {'keywords': {'$ref': 'decomposePar'}},
    }

    db = {
        'version': '13',
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'contexts': contexts,
        'schemes': schemes,
        'boundaryConditions': bcs,
        'turbulenceModels': turb,
        'linearSolvers': fvsol.get('linearSolvers', {}),
        'algorithms': fvsol.get('algorithms', {}),
        'functionObjects': fobjs,
        'thermophysical': thermo,
        'snappyHexMesh': snappy,
        'blockMesh': blockmesh,
        'decomposePar': decomppar,
        'controlDict': {'keywords': cdict},
    }

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(db, indent=2))
    total_schemes = sum(len(v) for v in schemes.values())
    print(f'Merged database → {args.out}')
    print(f'  Schemes: {total_schemes} across {len(schemes)} categories')
    print(f'  Boundary conditions: {len(bcs)}')
    print(f'  Function objects: {len(fobjs)}')

if __name__ == '__main__':
    main()
