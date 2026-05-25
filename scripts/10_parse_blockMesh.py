#!/usr/bin/env python3
"""Script 10: Extract blockMesh dictionary keywords."""
import json
from pathlib import Path
from argparse import ArgumentParser

KNOWN_BLOCKMESH = {
    'scale':         {'type': 'scalar',  'required': False, 'default': 1.0, 'description': 'Global coordinate scaling factor'},
    'vertices':      {'type': 'list',    'required': True,  'description': 'List of vertex coordinates (x y z)'},
    'blocks':        {'type': 'list',    'required': True,  'description': 'List of hex blocks: hex (v0..v7) (nx ny nz) simpleGrading (gx gy gz)'},
    'edges':         {'type': 'list',    'required': False, 'description': 'Curved edge definitions'},
    'boundary':      {'type': 'list',    'required': True,  'description': 'Patch definitions with type and faces'},
    'mergePatchPairs': {'type': 'list', 'required': False,  'description': 'Pairs of patches to merge'},
    'geometry':      {'type': 'dict',    'required': False,  'description': 'STL/triSurface geometry for snapping'},
    'defaultPatch':  {'type': 'dict',    'required': False,
                      'keywords': {'name': {'type': 'word'}, 'type': {'type': 'word'}}},
}

GRADING_TYPES = ['simpleGrading', 'edgeGrading']
EDGE_TYPES    = ['arc', 'spline', 'polyLine', 'BSpline', 'line', 'project', 'projectCurve']
PATCH_TYPES   = ['patch', 'wall', 'symmetryPlane', 'symmetry', 'empty', 'wedge', 'cyclic', 'processor']

def main():
    ap = ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--out', default='data/10_blockMesh.json')
    args = ap.parse_args()

    out_data = {
        'keywords': KNOWN_BLOCKMESH,
        'gradingTypes': GRADING_TYPES,
        'edgeTypes': EDGE_TYPES,
        'patchTypes': PATCH_TYPES,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(out_data, indent=2))
    print(f'Written {args.out}')

if __name__ == '__main__':
    main()
