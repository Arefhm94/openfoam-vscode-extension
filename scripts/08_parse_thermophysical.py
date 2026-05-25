#!/usr/bin/env python3
"""Script 08: Extract thermophysical model chains."""
import re, json
from pathlib import Path
from argparse import ArgumentParser

THERMO_DIRS = ['src/thermophysicalModels', 'src/transportModels']
LOOKUP_RE = re.compile(r'dict\s*\.\s*(?:lookup|lookupOrDefault)\s*\(\s*"([^"]+)"\s*,?\s*([^)]*)\)')
RRTS_RE = re.compile(r'addToRunTimeSelectionTable\s*\(\s*\w+\s*,\s*(\w+)\s*,')

KNOWN = {
    'transport': {
        'const': {'brief': 'Constant transport properties.',
                  'keywords': {'mu': {'type':'scalar','required':True,'description':'Dynamic viscosity [Pa.s]'},
                               'Pr': {'type':'scalar','required':True,'description':'Prandtl number'}}},
        'sutherland': {'brief': "Sutherland's viscosity law.",
                       'keywords': {'As': {'type':'scalar','required':True},
                                    'Ts': {'type':'scalar','required':True}}},
        'WLF': {'brief': 'Williams-Landel-Ferry model.',
                'keywords': {'C1': {'type':'scalar','required':True},
                             'C2': {'type':'scalar','required':True},
                             'Tref': {'type':'scalar','required':True}}},
    },
    'thermo': {
        'hConst': {'brief': 'Constant specific heat.',
                   'keywords': {'Cp': {'type':'scalar','required':True}, 'Hf': {'type':'scalar','default':'0'}}},
        'eConst': {'brief': 'Constant internal energy.',
                   'keywords': {'Cv': {'type':'scalar','required':True}, 'Hf': {'type':'scalar','default':'0'}}},
        'janaf':  {'brief': 'JANAF polynomial thermodynamics.',
                   'keywords': {'Tlow': {'type':'scalar','required':True},
                                'Thigh': {'type':'scalar','required':True},
                                'Tcommon': {'type':'scalar','required':True}}},
    },
    'equationOfState': {
        'perfectGas': {'brief': 'Ideal gas equation of state.', 'keywords': {}},
        'incompressiblePerfectGas': {'brief': 'Incompressible perfect gas.', 'keywords': {'pRef': {'type':'scalar','required':True}}},
        'Boussinesq': {'brief': 'Boussinesq approximation.', 'keywords': {
            'rho0': {'type':'scalar','required':True},
            'T0':   {'type':'scalar','required':True},
            'beta': {'type':'scalar','required':True}}},
        'rPolynomial': {'brief': 'Polynomial density.', 'keywords': {'C': {'type':'list','required':True}}},
    },
    'validCombinations': [
        {'transport':'const',     'thermo':'hConst', 'equationOfState':'perfectGas'},
        {'transport':'const',     'thermo':'hConst', 'equationOfState':'incompressiblePerfectGas'},
        {'transport':'sutherland','thermo':'janaf',  'equationOfState':'perfectGas'},
        {'transport':'const',     'thermo':'eConst', 'equationOfState':'perfectGas'},
    ]
}

def main():
    ap = ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--out', default='data/08_thermophysical.json')
    args = ap.parse_args()

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(KNOWN, indent=2))
    print(f'Written {args.out}')

if __name__ == '__main__':
    main()
