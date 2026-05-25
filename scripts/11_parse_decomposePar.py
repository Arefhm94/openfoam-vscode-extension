#!/usr/bin/env python3
"""Script 11: Extract decomposeParDict keywords."""
import json
from pathlib import Path
from argparse import ArgumentParser

KNOWN = {
    'numberOfSubdomains': {'type': 'integer', 'required': True},
    'method': {
        'type': 'word',
        'options': ['scotch', 'simple', 'hierarchical', 'metis', 'manual', 'multiLevel', 'structured'],
        'required': True,
    },
    'simpleCoeffs': {
        'type': 'dict',
        'keywords': {
            'n':      {'type': 'vector', 'required': True, 'description': 'Number of subdomains in each direction'},
            'delta':  {'type': 'scalar', 'default': 0.001},
        }
    },
    'hierarchicalCoeffs': {
        'type': 'dict',
        'keywords': {
            'n':      {'type': 'vector', 'required': True},
            'delta':  {'type': 'scalar', 'default': 0.001},
            'order':  {'type': 'word',   'default': 'xyz', 'description': 'Decomposition order: xyz, xzy, yxz, ...'},
        }
    },
    'scotchCoeffs': {
        'type': 'dict',
        'keywords': {
            'processorWeights': {'type': 'list', 'required': False},
            'strategy':         {'type': 'word',   'required': False},
        }
    },
    'manualCoeffs': {
        'type': 'dict',
        'keywords': {
            'dataFile': {'type': 'word', 'required': True},
        }
    },
    'distributed': {'type': 'boolean', 'default': False},
    'roots':       {'type': 'list',    'required': False},
}

def main():
    ap = ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--out', default='data/11_decomposePar.json')
    args = ap.parse_args()

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(KNOWN, indent=2))
    print(f'Written {args.out}')

if __name__ == '__main__':
    main()
