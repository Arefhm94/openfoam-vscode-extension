#!/usr/bin/env python3
"""Script 09: Extract snappyHexMesh dictionary keywords."""
import re, json
from pathlib import Path
from argparse import ArgumentParser

KNOWN_SNAPPY = {
    'castellatedMeshControls': {
        'maxLocalCells':         {'type': 'integer', 'default': 100000},
        'maxGlobalCells':        {'type': 'integer', 'default': 2000000},
        'minRefinementCells':    {'type': 'integer', 'default': 0},
        'maxLoadUnbalance':      {'type': 'scalar',  'default': 0.1},
        'nCellsBetweenLevels':   {'type': 'integer', 'default': 3},
        'features':              {'type': 'list',    'required': False},
        'refinementSurfaces':    {'type': 'dict',    'required': True},
        'resolveFeatureAngle':   {'type': 'scalar',  'default': 30},
        'refinementRegions':     {'type': 'dict',    'required': False},
        'locationInMesh':        {'type': 'vector',  'required': True},
        'allowFreeStandingZoneFaces': {'type': 'boolean', 'default': True},
    },
    'snapControls': {
        'nSmoothPatch':          {'type': 'integer', 'default': 3},
        'tolerance':             {'type': 'scalar',  'default': 2.0},
        'nSolveIter':            {'type': 'integer', 'default': 30},
        'nRelaxIter':            {'type': 'integer', 'default': 5},
        'nFeatureSnapIter':      {'type': 'integer', 'default': 10},
        'implicitFeatureSnap':   {'type': 'boolean', 'default': False},
        'explicitFeatureSnap':   {'type': 'boolean', 'default': True},
        'multiRegionFeatureSnap': {'type': 'boolean', 'default': True},
    },
    'addLayersControls': {
        'relativeSizes':         {'type': 'boolean', 'default': True},
        'layers':                {'type': 'dict',    'required': True},
        'expansionRatio':        {'type': 'scalar',  'default': 1.0},
        'finalLayerThickness':   {'type': 'scalar',  'default': 0.3},
        'minThickness':          {'type': 'scalar',  'default': 0.1},
        'nGrow':                 {'type': 'integer', 'default': 0},
        'featureAngle':          {'type': 'scalar',  'default': 110},
        'nRelaxIter':            {'type': 'integer', 'default': 3},
        'nSmoothSurfaceNormals': {'type': 'integer', 'default': 1},
        'nSmoothNormals':        {'type': 'integer', 'default': 3},
        'nSmoothThickness':      {'type': 'integer', 'default': 10},
        'maxFaceThicknessRatio': {'type': 'scalar',  'default': 0.5},
        'maxThicknessToMedialRatio': {'type': 'scalar', 'default': 0.3},
        'minMedialAxisAngle':    {'type': 'scalar',  'default': 90},
        'nBufferCellsNoExtrude': {'type': 'integer', 'default': 0},
        'nLayerIter':            {'type': 'integer', 'default': 50},
    },
    'meshQualityControls': {
        'maxNonOrtho':           {'type': 'scalar',  'default': 65},
        'maxBoundarySkewness':   {'type': 'scalar',  'default': 20},
        'maxInternalSkewness':   {'type': 'scalar',  'default': 4},
        'maxConcave':            {'type': 'scalar',  'default': 80},
        'minFlatness':           {'type': 'scalar',  'default': 0.5},
        'minVol':                {'type': 'scalar',  'default': 1e-13},
        'minTetQuality':         {'type': 'scalar',  'default': 1e-15},
        'minArea':               {'type': 'scalar',  'default': -1},
        'minTwist':              {'type': 'scalar',  'default': 0.02},
        'minDeterminant':        {'type': 'scalar',  'default': 0.001},
        'minFaceWeight':         {'type': 'scalar',  'default': 0.02},
        'minVolRatio':           {'type': 'scalar',  'default': 0.01},
        'minTriangleTwist':      {'type': 'scalar',  'default': -1},
        'nSmoothScale':          {'type': 'integer', 'default': 4},
        'errorReduction':        {'type': 'scalar',  'default': 0.75},
    },
}

def main():
    ap = ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--out', default='data/09_snappyHexMesh.json')
    args = ap.parse_args()

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(KNOWN_SNAPPY, indent=2))
    print(f'Written {args.out}')

if __name__ == '__main__':
    main()
