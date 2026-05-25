# OpenFOAM VSCode Extension — Full Implementation Specification

## Vision
Improve the VSCode extension to provide Python-level intelligence for OpenFOAM 
case dictionary files. Every keyword the user can type must be known to the 
extension: what values it accepts, in what format, with what constraints — and 
violations are caught with red squiggles and hover explanations, exactly like 
a typed language.

## Source of Truth
Clone OpenFOAM v13 source locally. All intelligence is derived from it.
```bash
git clone https://github.com/OpenFOAM/OpenFOAM-13
```
Do NOT scrape the live website. The source is the ground truth.

---

# PART 1: DATA PIPELINE
## `scripts/` — Python scripts that extract structured knowledge from source

---

## Script 1: `scripts/01_discover_schemes.py`

### Purpose
Discover every runtime-selectable keyword across the entire codebase,
grouped by their base class (scheme category).

### Method
Walk all `.C` and `.H` files. Extract these macro patterns:

```
addToRunTimeSelectionTable(BaseClass, ConcreteClass, dictionary)
addToRunTimeSelectionTable(BaseClass, ConcreteClass, word)
addNamedToRunTimeSelectionTable(BaseClass, ConcreteClass, word, keyword)
makeInterpolationScheme(SchemeName)
makeFvWallDistanceMethod(MethodName)
makeSnGradScheme(SchemeName)
makeLimitedSurfaceInterpolationScheme(SchemeName)
```

### Output: `data/01_scheme_registry.json`
```json
{
  "version": "13",
  "categories": {
    "gradScheme": {
      "baseClass": "Foam::fv::gradScheme",
      "headerPattern": "finiteVolume/finiteVolume/gradSchemes/",
      "members": {
        "Gauss": {
          "concreteClass": "Foam::fv::gaussGrad",
          "sourceFile": "src/finiteVolume/finiteVolume/gradSchemes/Gauss/gaussGrad.C",
          "headerFile": "src/finiteVolume/finiteVolume/gradSchemes/Gauss/gaussGrad.H"
        },
        "leastSquares": { ... },
        "cellLimited": { ... },
        "faceLimited": { ... }
      }
    },
    "divScheme": { ... },
    "laplacianScheme": { ... },
    "interpolationScheme": { ... },
    "snGradScheme": { ... },
    "ddtScheme": { ... },
    "d2dt2Scheme": { ... },
    "fluxScheme": { ... },
    "RASModel": { ... },
    "LESModel": { ... },
    "wallModel": { ... },
    "fvOption": { ... },
    "functionObject": { ... },
    "thermoTransportModel": { ... },
    "equationOfState": { ... },
    "specie": { ... },
    "fvConstraint": { ... },
    "decompositionMethod": { ... },
    "patchType": { ... },
    "wallDistMethod": { ... }
  }
}
```

---

## Script 2: `scripts/02_parse_constructors.py`

### Purpose
For each scheme discovered in step 1, parse its `Istream&` constructor
to determine the exact token sequence it reads — this defines the format
the user must type in the dictionary.

### Method
For each concrete class in `01_scheme_registry.json`:
1. Open its `.C` file
2. Find the constructor with signature: `ClassName(const fvMesh&, Istream& is)`
   or `ClassName(const fvMesh&, Istream& schemeData)`
3. Parse the constructor body for `Istream` read calls:

   | C++ pattern in constructor | Meaning |
   |---|---|
   | `readScalar(is)` | Next token is a scalar number |
   | `readLabel(is)` | Next token is an integer |
   | `is.peek() != EOF` / `is.good()` | Optional argument follows |
   | `word w(is)` | Next token is a bare word |
   | `InterpolationScheme<Type>::New(mesh, is)` | Next token(s) are another scheme |
   | `Switch(is)` | Next token is boolean (on/off/yes/no/true/false) |
   | `is >> someWord` | Next token is a word |
   | `gradScheme<Type>::New(mesh, is)` | Next token(s) are a gradScheme |

4. For each argument found, record:
   - type: scalar | integer | word | boolean | scheme
   - if type is scheme: which schemeCategory it belongs to
   - required: true if always read, false if inside `if (is.good())`
   - range: if scalar and range comment exists near the read call

### Output: `data/02_constructor_signatures.json`
```json
{
  "gradScheme": {
    "Gauss": {
      "format": "Gauss <interpolationScheme>",
      "arguments": [
        {
          "position": 0,
          "name": "interpolationScheme",
          "type": "scheme",
          "schemeCategory": "interpolationScheme",
          "required": true
        }
      ]
    },
    "cellLimited": {
      "format": "cellLimited <gradScheme> <coefficient:0-1>",
      "arguments": [
        {
          "position": 0,
          "name": "gradScheme",
          "type": "scheme",
          "schemeCategory": "gradScheme",
          "required": true
        },
        {
          "position": 1,
          "name": "coefficient",
          "type": "scalar",
          "range": [0, 1],
          "required": true
        }
      ]
    },
    "leastSquares": {
      "format": "leastSquares",
      "arguments": []
    },
    "fourth": {
      "format": "fourth",
      "arguments": [],
      "warnings": [
        "Only valid on uniform structured meshes"
      ]
    }
  },
  "interpolationScheme": {
    "linear": { "format": "linear", "arguments": [] },
    "limitedLinear": {
      "format": "limitedLinear <coefficient:0-1>",
      "arguments": [
        {
          "position": 0,
          "name": "coefficient",
          "type": "scalar",
          "range": [0, 1],
          "required": true
        }
      ]
    },
    "vanLeer": { "format": "vanLeer", "arguments": [] },
    "MUSCL": { "format": "MUSCL", "arguments": [] }
  },
  "divScheme": {
    "Gauss": {
      "format": "Gauss <interpolationScheme> [snGradScheme]",
      "arguments": [
        {
          "position": 0,
          "name": "interpolationScheme",
          "type": "scheme",
          "schemeCategory": "interpolationScheme",
          "required": true
        },
        {
          "position": 1,
          "name": "snGradScheme",
          "type": "scheme",
          "schemeCategory": "snGradScheme",
          "required": false
        }
      ]
    }
  },
  "laplacianScheme": {
    "Gauss": {
      "format": "Gauss <interpolationScheme> <snGradScheme>",
      "arguments": [
        {
          "position": 0,
          "name": "interpolationScheme",
          "type": "scheme",
          "schemeCategory": "interpolationScheme",
          "required": true
        },
        {
          "position": 1,
          "name": "snGradScheme",
          "type": "scheme",
          "schemeCategory": "snGradScheme",
          "required": true
        }
      ]
    }
  },
  "ddtScheme": {
    "Euler": { "format": "Euler", "arguments": [] },
    "backward": { "format": "backward", "arguments": [] },
    "CrankNicolson": {
      "format": "CrankNicolson <coefficient:0-1>",
      "arguments": [
        {
          "position": 0,
          "name": "offCentre",
          "type": "scalar",
          "range": [0, 1],
          "required": true,
          "description": "0 = fully Euler, 1 = fully Crank-Nicolson"
        }
      ]
    },
    "steadyState": { "format": "steadyState", "arguments": [] }
  }
}
```

---

## Script 3: `scripts/03_extract_descriptions.py`

### Purpose
For every class discovered in step 1, extract human-readable documentation
from the Doxygen comment block at the top of its `.H` file.

### Method
For each `.H` file:
1. Find the first `/*!` or `//!` or `/** ` block before the class declaration
2. Extract: brief description (first sentence), detailed description (rest),
   any `\note`, `\warning`, `\see` tags
3. Also extract the class template parameters if present

### Output: `data/03_descriptions.json`
```json
{
  "gradScheme": {
    "Gauss": {
      "brief": "Gauss-theorem gradient scheme.",
      "detail": "Computes the gradient using Gauss's theorem by interpolating 
                 cell-centre values to faces using the specified interpolation 
                 scheme, then summing face-area-weighted values.",
      "notes": [],
      "warnings": [],
      "see": ["gaussGrad.H"]
    },
    "cellLimited": {
      "brief": "Cell-limited gradient scheme.",
      "detail": "Applies a cell-based limiter to any gradient scheme to prevent 
                 overshoots. The limiter coefficient controls the blend between 
                 unlimited (0) and fully limited (1).",
      "notes": ["A coefficient of 1 is recommended for robustness"],
      "warnings": [],
      "see": []
    },
    "fourth": {
      "brief": "Fourth-order gradient scheme.",
      "detail": "Uses a fourth-order accurate stencil. Only valid on uniform 
                 Cartesian meshes.",
      "notes": [],
      "warnings": ["Not suitable for unstructured or polyhedral meshes"],
      "see": []
    }
  }
}
```

---

## Script 4: `scripts/04_parse_boundary_conditions.py`

### Purpose
Extract all boundary condition (patch field) types, what field types
they apply to (scalar, vector, tensor), and what sub-dictionary
keywords each one reads.

### Method
1. Walk `src/finiteVolume/fields/fvPatchFields/`
   and `src/finiteVolume/fields/fvsPatchFields/`
2. For each patch field class:
   a. Determine field type from template parameter (scalar/vector/tensor/symmTensor)
   b. Find the `read(const dictionary&)` method
   c. Extract all `dict.lookup(...)`, `dict.lookupOrDefault(...)`,
      `dict.found(...)`, `dict.readIfPresent(...)` calls
   d. For each lookup: record the keyword string and the type being read

### Output: `data/04_boundary_conditions.json`
```json
{
  "fixedValue": {
    "brief": "Fixed value boundary condition.",
    "detail": "Applies a user-specified fixed value at the boundary.",
    "appliesTo": ["scalar", "vector", "tensor", "symmTensor"],
    "keywords": {
      "value": {
        "type": "Field",
        "required": true,
        "format": "uniform <value> | nonuniform List<...>",
        "description": "The fixed value to apply"
      }
    },
    "format": "type fixedValue;\nvalue uniform <value>;"
  },
  "inletOutlet": {
    "brief": "Inlet/outlet boundary condition.",
    "detail": "Switches between fixedValue (inlet) and zeroGradient (outlet) 
               based on the flux direction.",
    "appliesTo": ["scalar", "vector"],
    "keywords": {
      "inletValue": {
        "type": "Field",
        "required": true,
        "description": "Value to apply when flux is into the domain"
      },
      "value": {
        "type": "Field",
        "required": true,
        "description": "Initial value"
      }
    }
  },
  "timeVaryingMappedFixedValue": {
    "keywords": {
      "mapMethod": {
        "type": "word",
        "options": ["nearestCell", "planarInterpolation"],
        "required": false,
        "default": "planarInterpolation"
      },
      "offset": {
        "type": "Field",
        "required": false,
        "description": "Optional offset to add to mapped values"
      }
    }
  }
}
```

---

## Script 5: `scripts/05_parse_fvSolution.py`

### Purpose
Extract all linear solver types, their keyword parameters, smoother
types, preconditioner types, and what fields/matrices they apply to.

### Method
Walk `src/OpenFOAM/matrices/lduMatrix/solvers/`
and `src/OpenFOAM/matrices/lduMatrix/smoothers/`
and `src/OpenFOAM/matrices/lduMatrix/preconditioners/`

For each solver/smoother/preconditioner class, find `read(const dictionary&)`
and extract all `dict.lookup(...)` calls.

Also extract algorithm block keywords for SIMPLE, PIMPLE, PISO, FLUID
from `src/finiteVolume/cfdTools/`.

### Output: `data/05_fvSolution.json`
```json
{
  "linearSolvers": {
    "PCG": {
      "brief": "Preconditioned Conjugate Gradient solver for symmetric matrices.",
      "appliesTo": "symmetric",
      "keywords": {
        "preconditioner": {
          "type": "word",
          "options": ["DIC", "FDIC", "diagonal", "none"],
          "required": true
        },
        "tolerance": {
          "type": "scalar",
          "required": true,
          "description": "Absolute convergence tolerance"
        },
        "relTol": {
          "type": "scalar",
          "required": true,
          "description": "Relative convergence tolerance"
        },
        "maxIter": {
          "type": "integer",
          "required": false,
          "default": 1000
        }
      }
    },
    "PBiCGStab": {
      "brief": "Preconditioned Bi-Conjugate Gradient Stabilised for asymmetric.",
      "appliesTo": "asymmetric",
      "keywords": {
        "preconditioner": {
          "type": "word",
          "options": ["DILU", "diagonal", "none"],
          "required": true
        },
        "tolerance": { "type": "scalar", "required": true },
        "relTol": { "type": "scalar", "required": true }
      }
    },
    "GAMG": {
      "brief": "Geometric-Algebraic Multi-Grid solver.",
      "appliesTo": "both",
      "keywords": {
        "smoother": {
          "type": "word",
          "options": ["GaussSeidel", "symGaussSeidel", "DICGaussSeidel", "DIC"],
          "required": true
        },
        "agglomerator": {
          "type": "word",
          "options": ["faceAreaPair", "algebraicPair"],
          "required": false,
          "default": "faceAreaPair"
        },
        "nCellsInCoarsestLevel": {
          "type": "integer",
          "required": false,
          "default": 10
        },
        "tolerance": { "type": "scalar", "required": true },
        "relTol": { "type": "scalar", "required": true }
      }
    }
  },
  "algorithms": {
    "SIMPLE": {
      "keywords": {
        "nNonOrthogonalCorrectors": { "type": "integer", "default": 0 },
        "consistent": { "type": "boolean", "default": false },
        "residualControl": {
          "type": "dict",
          "description": "Per-field convergence criteria",
          "keyFormat": "<fieldName>",
          "valueFormat": { "tolerance": "scalar", "relTol": "scalar" }
        }
      }
    },
    "PIMPLE": {
      "keywords": {
        "nOuterCorrectors": { "type": "integer", "required": true },
        "nCorrectors": { "type": "integer", "required": true },
        "nNonOrthogonalCorrectors": { "type": "integer", "default": 0 },
        "turbOnFinalIterOnly": { "type": "boolean", "default": true },
        "residualControl": { "type": "dict" }
      }
    },
    "PISO": {
      "keywords": {
        "nCorrectors": { "type": "integer", "required": true },
        "nNonOrthogonalCorrectors": { "type": "integer", "default": 0 }
      }
    }
  }
}
```

---

## Script 6: `scripts/06_parse_turbulence_models.py`

### Purpose
For every RAS and LES model, extract the model's coefficient dictionary —
every tunable coefficient with its default value and description.

### Method
For each turbulence model class:
1. Find the `correctNut()` or `read()` method
2. Find all `coeffDict_.lookupOrDefault(...)` calls
3. Record: coefficient name, type, default value
4. Extract from the `.H` file: brief description, applicable flow regimes,
   field requirements (what fields the model requires: k, omega, epsilon, etc.)

### Output: `data/06_turbulence_models.json`
```json
{
  "RAS": {
    "kOmegaSST": {
      "brief": "k-omega SST two-equation turbulence model.",
      "detail": "Menter's k-omega Shear Stress Transport model. Blends k-omega 
                 near walls with k-epsilon in freestream. Recommended for 
                 external aerodynamics and flows with adverse pressure gradients.",
      "requiredFields": ["k", "omega"],
      "generatedFields": ["nut"],
      "coefficients": {
        "alphaK1":  { "type": "scalar", "default": 0.85 },
        "alphaK2":  { "type": "scalar", "default": 1.0 },
        "alphaOmega1": { "type": "scalar", "default": 0.5 },
        "alphaOmega2": { "type": "scalar", "default": 0.856 },
        "beta1":    { "type": "scalar", "default": 0.075 },
        "beta2":    { "type": "scalar", "default": 0.0828 },
        "betaStar": { "type": "scalar", "default": 0.09 },
        "gamma1":   { "type": "scalar", "default": 0.5532 },
        "gamma2":   { "type": "scalar", "default": 0.4403 },
        "a1":       { "type": "scalar", "default": 0.31 },
        "b1":       { "type": "scalar", "default": 1.0 },
        "c1":       { "type": "scalar", "default": 10.0 }
      },
      "turbulencePropertiesFormat": 
        "simulationType  RAS;\nRAS\n{\n    RASModel    kOmegaSST;\n    turbulence  on;\n    printCoeffs on;\n}"
    },
    "kEpsilon": {
      "brief": "Standard k-epsilon two-equation turbulence model.",
      "requiredFields": ["k", "epsilon"],
      "generatedFields": ["nut"],
      "coefficients": {
        "Cmu":    { "type": "scalar", "default": 0.09 },
        "C1":     { "type": "scalar", "default": 1.44 },
        "C2":     { "type": "scalar", "default": 1.92 },
        "C3":     { "type": "scalar", "default": 0.0 },
        "sigmak": { "type": "scalar", "default": 1.0 },
        "sigmaEps": { "type": "scalar", "default": 1.3 }
      }
    }
  },
  "LES": {
    "Smagorinsky": {
      "brief": "Smagorinsky SGS model.",
      "coefficients": {
        "Ck": { "type": "scalar", "default": 0.094 },
        "Ce": { "type": "scalar", "default": 1.048 }
      }
    },
    "WALE": { ... },
    "dynamicKEqn": { ... }
  }
}
```

---

## Script 7: `scripts/07_parse_function_objects.py`

### Purpose
Extract every functionObject available, what keywords its dictionary
block accepts, and what fields/operations it performs.

### Method
Walk `src/functionObjects/` recursively.
For each functionObject class, parse the `read(const dictionary&)` method.

### Output: `data/07_function_objects.json`
```json
{
  "fieldAverage": {
    "brief": "Computes time-averaged fields.",
    "keywords": {
      "fields": {
        "type": "list",
        "itemFormat": {
          "mean": { "type": "boolean", "default": true },
          "prime2Mean": { "type": "boolean", "default": false },
          "base": { "type": "word", "options": ["time", "iteration"] }
        },
        "required": true
      },
      "restartOnRestart": { "type": "boolean", "default": false },
      "restartOnOutput": { "type": "boolean", "default": false }
    },
    "format": "fieldAverage\n{\n    type fieldAverage;\n    libs (fieldFunctionObjects);\n    fields\n    (\n        U { mean on; prime2Mean on; base time; }\n        p { mean on; prime2Mean off; base time; }\n    );\n}"
  },
  "forces": {
    "brief": "Computes forces and moments on patches.",
    "keywords": {
      "patches": { "type": "wordList", "required": true },
      "rho": { "type": "word", "required": true, "description": "rhoInf for incompressible" },
      "rhoInf": { "type": "scalar", "required": false },
      "CofR": { "type": "vector", "required": true },
      "log": { "type": "boolean", "default": true }
    }
  }
}
```

---

## Script 8: `scripts/08_parse_thermophysical.py`

### Purpose
Extract the full thermoType chain: transport + thermo + equationOfState
+ specie combinations, and what each component's coefficients are.

### Output: `data/08_thermophysical.json`
```json
{
  "transport": {
    "const": {
      "brief": "Constant transport properties.",
      "keywords": {
        "mu": { "type": "scalar", "required": true, "description": "Dynamic viscosity [Pa.s]" },
        "Pr": { "type": "scalar", "required": true, "description": "Prandtl number" }
      }
    },
    "sutherland": {
      "brief": "Sutherland viscosity law.",
      "keywords": {
        "As": { "type": "scalar", "required": true },
        "Ts": { "type": "scalar", "required": true }
      }
    }
  },
  "thermo": {
    "hConst": { ... },
    "janaf": { ... },
    "eConst": { ... }
  },
  "equationOfState": {
    "perfectGas": { "brief": "Ideal gas EOS.", "keywords": {} },
    "Boussinesq": {
      "keywords": {
        "rho0": { "type": "scalar", "required": true },
        "T0":   { "type": "scalar", "required": true },
        "beta": { "type": "scalar", "required": true }
      }
    }
  },
  "validCombinations": [
    { "transport": "const",     "thermo": "hConst",  "equationOfState": "perfectGas" },
    { "transport": "sutherland","thermo": "janaf",    "equationOfState": "perfectGas" }
  ]
}
```

---

## Script 9: `scripts/09_parse_snappyHexMesh.py`
## Script 10: `scripts/10_parse_blockMesh.py`
## Script 11: `scripts/11_parse_decomposePar.py`
## Script 12: `scripts/12_parse_controlDict.py`

Each follows the same pattern:
- Find the relevant class's `read(const dictionary&)` or source file
- Extract all keywords with types, defaults, constraints
- Output to `data/0N_<name>.json` in the same structure

`controlDict` specifically must cover:
- `application`: valid values from all solver names discovered
- `startFrom`: options [firstTime, startTime, latestTime]
- `stopAt`: options [endTime, noWriteNow, writeNow, nextWrite]
- `writeControl`: options [timeStep, runTime, adjustableRunTime, cpuTime, clockTime]
- `writeFormat`: options [ascii, binary]
- `writePrecision`: integer
- `writeCompression`: boolean
- `timeFormat`: options [fixed, scientific, general]
- `adjustTimeStep`: boolean
- `maxCo`: scalar (Courant number limit)
- `functions {}`: functionObjects sub-dict (ref data/07_function_objects.json)

---

## Script 13: `scripts/13_merge_database.py`

### Purpose
Merge all `data/0N_*.json` files into a single
`server/keyword-db.json` optimized for LSP consumption.

The merged structure maps every possible dictionary context path
to its valid keywords and their full specifications:

```json
{
  "version": "13",
  "generatedAt": "2025-01-01T00:00:00",
  "contexts": {
    "fvSchemes.gradSchemes.*": {
      "description": "Gradient scheme for a field or default",
      "schemes": { "$ref": "gradScheme" }
    },
    "fvSchemes.divSchemes.*": {
      "description": "Divergence scheme for a flux or default",
      "schemes": { "$ref": "divScheme" }
    },
    "fvSolution.solvers.*": {
      "description": "Linear solver settings for a field",
      "keywords": { "$ref": "linearSolvers" }
    },
    "fvSolution.SIMPLE": {
      "keywords": { "$ref": "algorithms.SIMPLE" }
    },
    "turbulenceProperties.RAS": {
      "keywords": {
        "RASModel": {
          "type": "word",
          "options": { "$ref": "turbulenceModels.RAS.keys" }
        },
        "turbulence": { "type": "boolean" },
        "printCoeffs": { "type": "boolean" }
      }
    },
    "boundaryField.*.type": {
      "options": { "$ref": "boundaryConditions.keys" }
    },
    "controlDict": {
      "keywords": { "$ref": "controlDict.keywords" }
    }
  },
  "schemes": { ... },
  "boundaryConditions": { ... },
  "turbulenceModels": { ... },
  "linearSolvers": { ... },
  "algorithms": { ... },
  "functionObjects": { ... },
  "thermophysical": { ... }
}
```

---

# PART 2: TEXTMATE GRAMMAR
## `syntaxes/openfoam.tmLanguage.json`

Cover the following token classes in order of precedence:

1. FoamFile header block — special scope `meta.foamfile.openfoam`
2. Line comments `//` → `comment.line.double-slash.openfoam`
3. Block comments `/* */` → `comment.block.openfoam`
4. Directives `#include #includeIfPresent #calc #codeStream #remove #sinclude`
   → `keyword.control.directive.openfoam`
5. Dimension sets `[ n n n n n n n ]` (7 signed integers in brackets)
   → `constant.numeric.dimension.openfoam`
6. Vector/tensor literals `( n n n )` → `constant.numeric.vector.openfoam`
7. Numeric literals including scientific notation → `constant.numeric.openfoam`
8. Boolean keywords `true false yes no on off` → `constant.language.boolean.openfoam`
9. Special keywords `uniform nonuniform default` → `keyword.other.openfoam`
10. Field type keywords `volScalarField volVectorField surfaceScalarField ...`
    → `support.type.openfoam`
11. String literals `"..."` → `string.quoted.double.openfoam`
12. Block open/close `{ }` → `punctuation.section.block.openfoam`
13. List open/close `( )` → `punctuation.section.list.openfoam`
14. Entry terminator `;` → `punctuation.terminator.openfoam`
15. Keywords from `keyword-db.json` known scheme names
    → `support.function.scheme.openfoam`

File association (in `package.json`):
Match files by name (no extension needed):
  blockMeshDict, fvSchemes, fvSolution, fvOptions, controlDict,
  decomposeParDict, changeDictionaryDict, snappyHexMeshDict,
  surfaceFeatureExtractDict, topoSetDict, refineMeshDict,
  transportProperties, turbulenceProperties, thermophysicalProperties,
  dynamicMeshDict, radiationProperties, chemistryProperties,
  combustionProperties, g, p, U, T, k, omega, epsilon, nut, nuTilda,
  alphat, p_rgh, Phi, pd, alpha.water, alpha.air
Also match files under paths containing /0/, /system/, /constant/
using a custom language detection contribution.

---

# PART 3: LANGUAGE SERVER
## `server/src/` — TypeScript LSP implementation

---

## Module: `server/src/parser.ts`

Implement a recursive-descent parser for OpenFOAM dictionary syntax.

Produce this AST:
```typescript
type NodeType = 'document' | 'dict' | 'entry' | 'list' | 'directive' | 'comment'

interface ASTNode {
  type: NodeType
  key?: string           // for entry nodes
  value?: string         // for scalar entry values
  children?: ASTNode[]   // for dict and list nodes
  range: Range           // LSP Range
  keyRange?: Range       // range of just the key token
  valueRange?: Range     // range of just the value token
}
```

The parser must correctly handle:
- Nested `{ }` blocks of arbitrary depth
- `( )` lists with scalars, vectors, and nested dicts
- Multi-token values: `Gauss linear`, `cellLimited Gauss linear 0.5`
- `#include` and other directives
- `//` and `/* */` comments (preserve in AST for hover on commented-out lines)
- Files with no extension
- The `FoamFile { }` header as a special dict node
- Macro-style entries: `#calc "expr"`, `$variableName`
- Variable expansion: `$:variableName`, `${variableName}`

---

## Module: `server/src/contextDetector.ts`

Given cursor position and the document AST, return a `CursorContext`:

```typescript
interface CursorContext {
  file: OpenFOAMFileType   // 'fvSchemes' | 'fvSolution' | 'boundaryField' | ...
  path: string[]           // e.g. ['fvSchemes', 'gradSchemes', 'grad(U)']
  cursorIn: 'key' | 'value' | 'scheme' | 'schemeArg'
  currentKey?: string      // key of the entry cursor is in
  currentValue?: string    // value tokens typed so far
  schemeTokenIndex?: number // which argument position in a scheme string
}
```

File type detection priority:
1. FoamFile header `class` field: `dictionary`, `volScalarField`, etc.
2. FoamFile header `object` field: `fvSchemes`, `fvSolution`, etc.
3. Filename match against known names
4. Path segment match: presence of `/0/`, `/system/`, `/constant/`

---

## Module: `server/src/completionProvider.ts`

On completion request:
1. Get `CursorContext` from `contextDetector`
2. Look up valid completions in `keyword-db.json` for the context path
3. Return `CompletionItem[]` with:
   - `label`: the keyword or scheme name
   - `kind`: Keyword, Value, or Snippet
   - `detail`: one-line format string e.g. `Gauss <interpolationScheme>`
   - `documentation`: full description from `03_descriptions.json`
   - `insertText`: snippet with placeholders for required arguments

Example snippets:
```
// Typing in gradSchemes block, cursor on value position
"Gauss" → insertText: "Gauss ${1:linear}"
"cellLimited" → insertText: "cellLimited Gauss ${1:linear} ${2:1}"
"leastSquares" → insertText: "leastSquares"
```

For scheme arguments (user typed "Gauss " and is now in arg position):
- Detect token count since scheme start
- Offer valid schemes for that argument position
- e.g. after `Gauss ` → offer all interpolationScheme names

For boundary conditions (cursor inside `boundaryField.patchName`):
- `type` key → offer all bc names valid for the field's type
- After `type fixedValue;` is set → offer `value` keyword with snippet

---

## Module: `server/src/hoverProvider.ts`

On hover:
1. Find token under cursor in AST
2. Determine if it's a scheme name, keyword, or value
3. Build `MarkupContent` in Markdown:

```markdown
### Gauss
*Gradient scheme*

Computes the gradient using Gauss's theorem by interpolating face values
from cell centres using the specified interpolation scheme.

**Format:** `Gauss <interpolationScheme>`

**Arguments:**
- `interpolationScheme` *(required)* — any interpolation scheme name
  Valid values: `linear`, `cubic`, `limitedLinear <coeff>`, `vanLeer`, ...

**Example:**
\`\`\`
gradSchemes
{
    default    Gauss linear;
    grad(p)    Gauss linear;
    grad(U)    cellLimited Gauss linear 1;
}
\`\`\`
```

For turbulence model hover show full coefficient table with defaults.
For boundary condition hover show full keyword table and a minimal example block.

---

## Module: `server/src/diagnosticsProvider.ts`

Run on document open and on change (debounced 300ms).
Return `Diagnostic[]` for all issues found.

### Diagnostic rules organized by file type:

**fvSchemes:**
- Unknown scheme name in any sub-dict → Error
  "'{name}' is not a valid {category} scheme. Valid: {list}"
- Wrong number of arguments for a scheme → Error
  "Scheme '{name}' expects {n} argument(s): {format}"
- Argument value out of range → Warning
  "Coefficient {n} for '{scheme}' should be in [{min}, {max}]"
- Scheme used in wrong context (e.g. ddtScheme name in gradSchemes) → Error
- Missing `default` entry when required → Warning

**fvSolution:**
- Unknown solver name → Error
- Required keyword missing for solver (e.g. PCG missing `preconditioner`) → Error
- Invalid preconditioner for solver type (e.g. DIC with PBiCGStab) → Error
  "DIC is only valid for symmetric matrices. Use DILU for PBiCGStab"
- PIMPLE with nOuterCorrectors missing → Error
- SIMPLE with no residualControl → Info "Consider adding residualControl for convergence"

**turbulenceProperties:**
- simulationType is RAS but no RAS dict → Error
- RASModel name not recognised → Error with list of valid models
- Model requires field (e.g. kOmegaSST needs k and omega) → Warning if field files not detected

**boundaryField (0/ files):**
- `type` not present in a patch entry → Error
- Unknown boundary condition type → Error
- Required keyword missing for bc type → Error
- Dimension set wrong length (not exactly 7) → Error
- Dimension set in wrong field context → Warning

**controlDict:**
- Unknown `application` name → Warning (can't always know all solvers)
- `adjustTimeStep yes` without `maxCo` → Warning
- `writeControl runTime` without `writeInterval` → Error

**All files:**
- FoamFile header missing → Warning
- FoamFile header missing required field (version/format/class/object) → Warning
- Unclosed `{` block → Error
- Mismatched `}` → Error
- Entry missing `;` terminator → Error

---

## Module: `server/src/signatureHelpProvider.ts`

Triggered when user types a space after a scheme name.
Shows the expected argument signature inline:

For `Gauss ` → show:
```
Gauss(interpolationScheme: scheme)
      ^^^^^^^^^^^^^^^^^^^^^^^
      Required: linear | limitedLinear <coeff> | vanLeer | MUSCL | ...
```

For `cellLimited Gauss linear ` → show:
```
cellLimited(gradScheme, coefficient: 0..1)
                        ^^^^^^^^^^^^^^^^
```

---

# PART 4: EXTENSION HOST
## `src/extension.ts`

Responsibilities:
- Activate on language id `openfoam-dict`
- Detect OpenFOAM files by path/name heuristics (see grammar section)
- Start language server child process
- Register commands:
  - `openfoam.rebuildKeywordDb` — re-run scripts 01–13
  - `openfoam.showSchemeDoc` — open scheme docs in panel
  - `openfoam.insertTurbulenceBlock` — snippet insertion for common models
- Status bar item: "OpenFOAM vN" when active
- Configuration settings the user can set in `settings.json`:
  - `openfoam.sourcePath`: path to cloned OpenFOAM source
  - `openfoam.version`: string, default "13"
  - `openfoam.validateOnSave`: boolean, default true
  - `openfoam.showCoefficients`: boolean, show turbulence coefficients on hover

---

# PART 5: PROJECT STRUCTURE

```
vscode-openfoam-intel/
├── package.json
├── tsconfig.json
├── language-configuration.json
├── syntaxes/
│   └── openfoam.tmLanguage.json
├── scripts/
│   ├── 01_discover_schemes.py
│   ├── 02_parse_constructors.py
│   ├── 03_extract_descriptions.py
│   ├── 04_parse_boundary_conditions.py
│   ├── 05_parse_fvSolution.py
│   ├── 06_parse_turbulence_models.py
│   ├── 07_parse_function_objects.py
│   ├── 08_parse_thermophysical.py
│   ├── 09_parse_snappyHexMesh.py
│   ├── 10_parse_blockMesh.py
│   ├── 11_parse_decomposePar.py
│   ├── 12_parse_controlDict.py
│   └── 13_merge_database.py
├── data/
│   ├── 01_scheme_registry.json
│   ├── 02_constructor_signatures.json
│   ├── 03_descriptions.json
│   ├── 04_boundary_conditions.json
│   ├── 05_fvSolution.json
│   ├── 06_turbulence_models.json
│   ├── 07_function_objects.json
│   ├── 08_thermophysical.json
│   ├── 09_snappyHexMesh.json
│   ├── 10_blockMesh.json
│   ├── 11_decomposePar.json
│   └── 12_controlDict.json
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── keyword-db.json           ← generated by script 13
│   └── src/
│       ├── server.ts
│       ├── parser.ts
│       ├── contextDetector.ts
│       ├── completionProvider.ts
│       ├── hoverProvider.ts
│       ├── diagnosticsProvider.ts
│       └── signatureHelpProvider.ts
└── src/
    └── extension.ts
```

---

# IMPLEMENTATION ORDER

Follow this exact order. Do not skip ahead.
After each phase, verify output before proceeding.

**Phase 1 — Data**
Run scripts 01 through 13 in order against the cloned OpenFOAM-13 repo.
After script 01: verify all major scheme categories are present (grad, div, laplacian, ddt, interpolation, snGrad, RAS, LES, bc, functionObject)
After script 02: spot-check kOmegaSST, GAMG, CrankNicolson, cellLimited — verify argument lists match expected format
After script 13: verify the merged keyword-db.json is complete and internally consistent

**Phase 2 — Grammar**
Test the TextMate grammar against these tutorial files:
- tutorials/incompressible/simpleFoam/pitzDaily/system/fvSchemes
- tutorials/incompressible/simpleFoam/pitzDaily/system/fvSolution
- tutorials/multiphase/interFoam/laminar/damBreak/0/alpha.water
Verify all token classes are coloured correctly.

**Phase 3 — Parser**
Write unit tests for parser.ts covering:
- Normal key-value entries
- Multi-token scheme values
- Nested dicts
- Lists with vectors
- #include directives
- Variable references $varName
- Edge cases: missing semicolons, unclosed blocks

**Phase 4 — LSP features**
Implement in this order: contextDetector → completionProvider → hoverProvider → diagnosticsProvider → signatureHelpProvider
Test each against real tutorial cases before adding the next.

**Phase 5 — Extension host**
Wire everything together. Test the full extension by opening a complete OpenFOAM tutorial case (motorBike recommended for complexity).

---

# QUALITY BAR
The extension must meet these standards:
- Hover on any scheme name shows format + description + example
- Typing a scheme name and space triggers signature help showing next expected argument
- Every unknown keyword in fvSchemes produces a diagnostic with the list of valid alternatives
- Every missing required keyword produces a diagnostic
- Completions are context-aware: inside gradSchemes only gradScheme names appear, not divScheme names
- The keyword database covers 100% of schemes discoverable from the source tree
- The pipeline is re-runnable: if the user clones OpenFOAM-14 and updates `openfoam.sourcePath`, running `rebuildKeywordDb` produces a valid updated database