#!/usr/bin/env python3
"""Script 12: Extract controlDict keywords."""
import json
from pathlib import Path
from argparse import ArgumentParser

KNOWN = {
    'application':      {'type': 'word',    'required': True,  'description': 'Solver name'},
    'startFrom':        {'type': 'word',    'required': True,  'options': ['firstTime','startTime','latestTime']},
    'startTime':        {'type': 'scalar',  'default': 0},
    'stopAt':           {'type': 'word',    'required': True,  'options': ['endTime','noWriteNow','writeNow','nextWrite']},
    'endTime':          {'type': 'scalar',  'required': True},
    'deltaT':           {'type': 'scalar',  'required': True,  'description': 'Time step'},
    'writeControl':     {'type': 'word',    'required': True,
                         'options': ['timeStep','runTime','adjustableRunTime','cpuTime','clockTime']},
    'writeInterval':    {'type': 'scalar',  'required': True},
    'purgeWrite':       {'type': 'integer', 'default': 0,      'description': '0 = keep all time dirs'},
    'writeFormat':      {'type': 'word',    'default': 'ascii', 'options': ['ascii','binary']},
    'writePrecision':   {'type': 'integer', 'default': 6},
    'writeCompression': {'type': 'boolean', 'default': False},
    'timeFormat':       {'type': 'word',    'default': 'general','options': ['fixed','scientific','general']},
    'timePrecision':    {'type': 'integer', 'default': 6},
    'runTimeModifiable': {'type': 'boolean','default': True},
    'adjustTimeStep':   {'type': 'boolean', 'default': False},
    'maxCo':            {'type': 'scalar',  'required': False,  'description': 'Maximum Courant number'},
    'maxDeltaT':        {'type': 'scalar',  'required': False},
    'libs':             {'type': 'list',    'required': False,  'description': 'Additional shared libraries to load'},
    'functions':        {'type': 'dict',    'required': False,  'description': 'Function objects sub-dictionary'},
}

def main():
    ap = ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--out', default='data/12_controlDict.json')
    args = ap.parse_args()

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(KNOWN, indent=2))
    print(f'Written {args.out}')

if __name__ == '__main__':
    main()
