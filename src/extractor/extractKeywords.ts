import * as fs from 'fs';
import * as path from 'path';

/**
 * Keyword extractor for OpenFOAM source code.
 * 
 * This script walks the OpenFOAM source tree and extracts:
 * - Dictionary keywords from C++ source files
 * - Function/command names and their parameters
 * - Documentation from comments (Doxygen-style and inline)
 * 
 * TODO: Enhance with proper C++ AST parsing for better accuracy
 * TODO: Add support for parsing OpenFOAM dictionary files directly
 */

interface KeywordInfo {
  name: string;
  description: string;
  parameters?: ParameterInfo[];
  examples?: string[];
  sourceFile?: string;
  category: 'control' | 'solver' | 'scheme' | 'boundary' | 'function' | 'property' | 'utility' | 'other';
}

interface ParameterInfo {
  name: string;
  type?: string;
  required: boolean;
  description?: string;
  defaultValue?: string;
}

class KeywordExtractor {
  private keywords: Map<string, KeywordInfo> = new Map();
  private sourceRoot: string;

  constructor(sourceRoot: string) {
    this.sourceRoot = sourceRoot;
  }

  /**
   * Main extraction entry point
   */
  async extract(): Promise<Map<string, KeywordInfo>> {
    console.log('Starting keyword extraction from OpenFOAM source...');
    
    // Add hardcoded essential keywords first
    this.addEssentialKeywords();
    
    // Extract from source directories
    await this.extractFromDirectory(path.join(this.sourceRoot, 'src'));
    await this.extractFromDirectory(path.join(this.sourceRoot, 'applications'));
    await this.extractFromDirectory(path.join(this.sourceRoot, 'etc', 'caseDicts'));
    
    console.log(`Extracted ${this.keywords.size} keywords`);
    return this.keywords;
  }

  /**
   * Add essential OpenFOAM keywords with descriptions
   */
  private addEssentialKeywords(): void {
    // FoamFile header keywords
    this.addKeyword({
      name: 'FoamFile',
      description: 'OpenFOAM file header dictionary containing file metadata',
      category: 'control',
      parameters: [
        { name: 'version', type: 'float', required: true, description: 'OpenFOAM version number (e.g., 2.0)' },
        { name: 'format', type: 'string', required: true, description: 'File format: ascii or binary' },
        { name: 'class', type: 'string', required: true, description: 'OpenFOAM class type (e.g., dictionary, volScalarField)' },
        { name: 'location', type: 'string', required: false, description: 'File location within case directory' },
        { name: 'object', type: 'string', required: true, description: 'Object name (e.g., controlDict, U, p)' }
      ],
      examples: [
        'FoamFile\n{\n    version     2.0;\n    format      ascii;\n    class       dictionary;\n    object      controlDict;\n}'
      ]
    });

    // controlDict keywords
    this.addKeyword({
      name: 'application',
      description: 'Solver application name to use for the simulation',
      category: 'control',
      examples: ['application     simpleFoam;', 'application     interFoam;']
    });

    this.addKeyword({
      name: 'startFrom',
      description: 'Controls the start time of the simulation',
      category: 'control',
      parameters: [
        { name: 'value', type: 'string', required: true, description: 'firstTime, startTime, or latestTime' }
      ],
      examples: ['startFrom       startTime;', 'startFrom       latestTime;']
    });

    this.addKeyword({
      name: 'startTime',
      description: 'Start time for the simulation (seconds)',
      category: 'control',
      parameters: [
        { name: 'value', type: 'scalar', required: true, description: 'Time value in seconds', defaultValue: '0' }
      ],
      examples: ['startTime       0;', 'startTime       100;']
    });

    this.addKeyword({
      name: 'stopAt',
      description: 'Condition for stopping the simulation',
      category: 'control',
      parameters: [
        { name: 'value', type: 'string', required: true, description: 'endTime, writeNow, noWriteNow, or nextWrite' }
      ],
      examples: ['stopAt          endTime;']
    });

    this.addKeyword({
      name: 'endTime',
      description: 'End time for the simulation (seconds)',
      category: 'control',
      parameters: [
        { name: 'value', type: 'scalar', required: true, description: 'End time in seconds' }
      ],
      examples: ['endTime         1000;', 'endTime         0.5;']
    });

    this.addKeyword({
      name: 'deltaT',
      description: 'Time step size (seconds)',
      category: 'control',
      parameters: [
        { name: 'value', type: 'scalar', required: true, description: 'Time step in seconds' }
      ],
      examples: ['deltaT          0.001;', 'deltaT          1e-05;']
    });

    this.addKeyword({
      name: 'writeControl',
      description: 'Controls when results are written to disk',
      category: 'control',
      parameters: [
        { name: 'value', type: 'string', required: true, description: 'timeStep, runTime, adjustableRunTime, cpuTime, or clockTime' }
      ],
      examples: ['writeControl    timeStep;', 'writeControl    runTime;']
    });

    this.addKeyword({
      name: 'writeInterval',
      description: 'Interval for writing results (depends on writeControl)',
      category: 'control',
      parameters: [
        { name: 'value', type: 'scalar', required: true, description: 'Interval value' }
      ],
      examples: ['writeInterval   100;', 'writeInterval   0.1;']
    });

    this.addKeyword({
      name: 'purgeWrite',
      description: 'Number of time directories to retain (0 = keep all)',
      category: 'control',
      parameters: [
        { name: 'value', type: 'integer', required: true, description: 'Number of directories to keep', defaultValue: '0' }
      ],
      examples: ['purgeWrite      0;', 'purgeWrite      2;']
    });

    this.addKeyword({
      name: 'writeFormat',
      description: 'Format for writing results',
      category: 'control',
      parameters: [
        { name: 'value', type: 'string', required: true, description: 'ascii or binary' }
      ],
      examples: ['writeFormat     ascii;', 'writeFormat     binary;']
    });

    this.addKeyword({
      name: 'writePrecision',
      description: 'Number of significant figures for ASCII output',
      category: 'control',
      parameters: [
        { name: 'value', type: 'integer', required: true, description: 'Number of significant figures', defaultValue: '6' }
      ],
      examples: ['writePrecision  6;', 'writePrecision  10;']
    });

    this.addKeyword({
      name: 'writeCompression',
      description: 'Enable compression for output files',
      category: 'control',
      parameters: [
        { name: 'value', type: 'boolean', required: true, description: 'true or false' }
      ],
      examples: ['writeCompression off;', 'writeCompression on;']
    });

    this.addKeyword({
      name: 'timeFormat',
      description: 'Format for time directory names',
      category: 'control',
      parameters: [
        { name: 'value', type: 'string', required: true, description: 'general, fixed, or scientific' }
      ],
      examples: ['timeFormat      general;']
    });

    this.addKeyword({
      name: 'timePrecision',
      description: 'Number of significant figures for time directory names',
      category: 'control',
      parameters: [
        { name: 'value', type: 'integer', required: true, description: 'Number of significant figures', defaultValue: '6' }
      ],
      examples: ['timePrecision   6;']
    });

    this.addKeyword({
      name: 'runTimeModifiable',
      description: 'Enable runtime modification of dictionaries',
      category: 'control',
      parameters: [
        { name: 'value', type: 'boolean', required: true, description: 'true or false' }
      ],
      examples: ['runTimeModifiable yes;', 'runTimeModifiable no;']
    });

    this.addKeyword({
      name: 'adjustTimeStep',
      description: 'Enable automatic time step adjustment based on Courant number',
      category: 'control',
      parameters: [
        { name: 'value', type: 'boolean', required: true, description: 'true or false' }
      ],
      examples: ['adjustTimeStep  yes;', 'adjustTimeStep  no;']
    });

    this.addKeyword({
      name: 'maxCo',
      description: 'Maximum Courant number for automatic time step adjustment',
      category: 'control',
      parameters: [
        { name: 'value', type: 'scalar', required: true, description: 'Maximum Courant number', defaultValue: '1' }
      ],
      examples: ['maxCo           1;', 'maxCo           0.5;']
    });

    this.addKeyword({
      name: 'maxAlphaCo',
      description: 'Maximum interface Courant number for multiphase flows',
      category: 'control',
      parameters: [
        { name: 'value', type: 'scalar', required: true, description: 'Maximum interface Courant number' }
      ],
      examples: ['maxAlphaCo      1;']
    });

    this.addKeyword({
      name: 'maxDeltaT',
      description: 'Maximum allowed time step (seconds)',
      category: 'control',
      parameters: [
        { name: 'value', type: 'scalar', required: true, description: 'Maximum time step in seconds' }
      ],
      examples: ['maxDeltaT       0.01;']
    });

    // fvSolution keywords
    this.addKeyword({
      name: 'solver',
      description: 'Linear solver algorithm for equation system',
      category: 'solver',
      parameters: [
        { name: 'type', type: 'string', required: true, description: 'PCG, PBiCG, PBiCGStab, smoothSolver, GAMG, diagonal' }
      ],
      examples: ['solver          PCG;', 'solver          GAMG;', 'solver          PBiCGStab;']
    });

    this.addKeyword({
      name: 'preconditioner',
      description: 'Preconditioner for iterative linear solver',
      category: 'solver',
      parameters: [
        { name: 'type', type: 'string', required: true, description: 'DIC, DILU, FDIC, diagonal, none' }
      ],
      examples: ['preconditioner  DIC;', 'preconditioner  DILU;']
    });

    this.addKeyword({
      name: 'tolerance',
      description: 'Absolute convergence tolerance for linear solver',
      category: 'solver',
      parameters: [
        { name: 'value', type: 'scalar', required: true, description: 'Absolute tolerance (e.g., 1e-06)' }
      ],
      examples: ['tolerance       1e-06;', 'tolerance       1e-08;']
    });

    this.addKeyword({
      name: 'relTol',
      description: 'Relative convergence tolerance for linear solver',
      category: 'solver',
      parameters: [
        { name: 'value', type: 'scalar', required: true, description: 'Relative tolerance (e.g., 0.1)', defaultValue: '0' }
      ],
      examples: ['relTol          0.1;', 'relTol          0.01;', 'relTol          0;']
    });

    this.addKeyword({
      name: 'minIter',
      description: 'Minimum number of solver iterations',
      category: 'solver',
      parameters: [
        { name: 'value', type: 'integer', required: false, description: 'Minimum iterations', defaultValue: '0' }
      ],
      examples: ['minIter         0;', 'minIter         1;']
    });

    this.addKeyword({
      name: 'maxIter',
      description: 'Maximum number of solver iterations',
      category: 'solver',
      parameters: [
        { name: 'value', type: 'integer', required: true, description: 'Maximum iterations' }
      ],
      examples: ['maxIter         1000;', 'maxIter         100;']
    });

    this.addKeyword({
      name: 'smoother',
      description: 'Smoother algorithm for GAMG or smoothSolver',
      category: 'solver',
      parameters: [
        { name: 'type', type: 'string', required: true, description: 'GaussSeidel, symGaussSeidel, DIC, DILU' }
      ],
      examples: ['smoother        GaussSeidel;', 'smoother        symGaussSeidel;']
    });

    this.addKeyword({
      name: 'nSweeps',
      description: 'Number of smoother sweeps',
      category: 'solver',
      parameters: [
        { name: 'value', type: 'integer', required: true, description: 'Number of sweeps', defaultValue: '1' }
      ],
      examples: ['nSweeps         1;', 'nSweeps         2;']
    });

    this.addKeyword({
      name: 'cacheAgglomeration',
      description: 'Cache the agglomeration for GAMG solver (faster but uses more memory)',
      category: 'solver',
      parameters: [
        { name: 'value', type: 'boolean', required: true, description: 'true or false' }
      ],
      examples: ['cacheAgglomeration true;']
    });

    this.addKeyword({
      name: 'nCellsInCoarsestLevel',
      description: 'Target number of cells in coarsest agglomeration level for GAMG',
      category: 'solver',
      parameters: [
        { name: 'value', type: 'integer', required: true, description: 'Number of cells', defaultValue: '10' }
      ],
      examples: ['nCellsInCoarsestLevel 10;', 'nCellsInCoarsestLevel 50;']
    });

    this.addKeyword({
      name: 'agglomerator',
      description: 'Agglomeration method for GAMG solver',
      category: 'solver',
      parameters: [
        { name: 'type', type: 'string', required: true, description: 'faceAreaPair, pairPatchAgglomeration' }
      ],
      examples: ['agglomerator    faceAreaPair;']
    });

    this.addKeyword({
      name: 'mergeLevels',
      description: 'Number of levels to merge in GAMG agglomeration',
      category: 'solver',
      parameters: [
        { name: 'value', type: 'integer', required: true, description: 'Merge levels', defaultValue: '1' }
      ],
      examples: ['mergeLevels     1;']
    });

    // fvSchemes keywords
    this.addKeyword({
      name: 'ddtSchemes',
      description: 'Time derivative discretization schemes',
      category: 'scheme',
      examples: [
        'ddtSchemes\n{\n    default         Euler;\n}',
        'ddtSchemes\n{\n    default         backward;\n}'
      ]
    });

    this.addKeyword({
      name: 'gradSchemes',
      description: 'Gradient discretization schemes',
      category: 'scheme',
      examples: [
        'gradSchemes\n{\n    default         Gauss linear;\n}',
        'gradSchemes\n{\n    default         cellLimited Gauss linear 1;\n}'
      ]
    });

    this.addKeyword({
      name: 'divSchemes',
      description: 'Divergence discretization schemes',
      category: 'scheme',
      examples: [
        'divSchemes\n{\n    default         none;\n    div(phi,U)      Gauss linearUpwind grad(U);\n}'
      ]
    });

    this.addKeyword({
      name: 'laplacianSchemes',
      description: 'Laplacian discretization schemes',
      category: 'scheme',
      examples: [
        'laplacianSchemes\n{\n    default         Gauss linear corrected;\n}'
      ]
    });

    this.addKeyword({
      name: 'interpolationSchemes',
      description: 'Interpolation schemes for face values',
      category: 'scheme',
      examples: [
        'interpolationSchemes\n{\n    default         linear;\n}'
      ]
    });

    this.addKeyword({
      name: 'snGradSchemes',
      description: 'Surface normal gradient schemes',
      category: 'scheme',
      examples: [
        'snGradSchemes\n{\n    default         corrected;\n}',
        'snGradSchemes\n{\n    default         limited corrected 0.5;\n}'
      ]
    });

    // Scheme types
    this.addKeyword({
      name: 'Euler',
      description: 'First-order implicit Euler time scheme (bounded, stable)',
      category: 'scheme',
      examples: ['default         Euler;']
    });

    this.addKeyword({
      name: 'backward',
      description: 'Second-order implicit backward time scheme (more accurate than Euler)',
      category: 'scheme',
      examples: ['default         backward;']
    });

    this.addKeyword({
      name: 'CrankNicolson',
      description: 'Second-order Crank-Nicolson time scheme with blending factor (0-1)',
      category: 'scheme',
      parameters: [
        { name: 'psi', type: 'scalar', required: true, description: 'Blending factor (0=Euler, 1=pure CN)' }
      ],
      examples: ['default         CrankNicolson 0.9;']
    });

    this.addKeyword({
      name: 'steadyState',
      description: 'Steady-state (removes time derivative term)',
      category: 'scheme',
      examples: ['default         steadyState;']
    });

    this.addKeyword({
      name: 'Gauss',
      description: 'Gauss integration scheme (requires interpolation scheme)',
      category: 'scheme',
      parameters: [
        { name: 'interpolation', type: 'string', required: true, description: 'Interpolation scheme (linear, upwind, etc.)' }
      ],
      examples: ['default         Gauss linear;', 'div(phi,U)      Gauss linearUpwind grad(U);']
    });

    // Note: Scheme keywords (linear, upwind, linearUpwind, etc.) are defined  
    // later with enhanced documentation from CFD Direct

    this.addKeyword({
      name: 'LUST',
      description: 'Linear-upwind stabilized transport scheme (blend of linear and linearUpwind)',
      category: 'scheme',
      parameters: [
        { name: 'gradScheme', type: 'string', required: true, description: 'Gradient scheme' }
      ],
      examples: ['div(phi,U)      Gauss LUST grad(U);']
    });

    this.addKeyword({
      name: 'corrected',
      description: 'Explicit non-orthogonal correction (most accurate for orthogonal meshes)',
      category: 'scheme',
      examples: ['default         corrected;']
    });

    this.addKeyword({
      name: 'limited',
      description: 'Limited non-orthogonal correction with coefficient (0-1)',
      category: 'scheme',
      parameters: [
        { name: 'coefficient', type: 'scalar', required: true, description: 'Limiting coefficient (1=corrected, 0=uncorrected)' }
      ],
      examples: ['default         limited corrected 0.5;']
    });

    this.addKeyword({
      name: 'uncorrected',
      description: 'No non-orthogonal correction (for highly non-orthogonal meshes)',
      category: 'scheme',
      examples: ['default         uncorrected;']
    });

    // Boundary condition keywords
    this.addKeyword({
      name: 'type',
      description: 'Boundary condition type or patch type',
      category: 'boundary',
      examples: ['type            fixedValue;', 'type            zeroGradient;', 'type            wall;']
    });

    this.addKeyword({
      name: 'value',
      description: 'Value specification for boundary condition or initial field',
      category: 'boundary',
      examples: ['value           uniform 0;', 'value           uniform (0 0 0);']
    });

    this.addKeyword({
      name: 'internalField',
      description: 'Internal field initialization',
      category: 'boundary',
      examples: ['internalField   uniform 0;', 'internalField   uniform (0 0 0);']
    });

    this.addKeyword({
      name: 'boundaryField',
      description: 'Boundary field specifications dictionary',
      category: 'boundary',
      examples: ['boundaryField\n{\n    inlet\n    {\n        type            fixedValue;\n        value           uniform (1 0 0);\n    }\n}']
    });

    // Note: Basic boundary conditions (fixedValue, zeroGradient, etc.) are defined
    // later with enhanced documentation from CFD Direct and OpenFOAM API

    this.addKeyword({
      name: 'slip',
      description: 'Slip boundary condition (zero normal gradient)',
      category: 'boundary',
      examples: ['type            slip;']
    });

    this.addKeyword({
      name: 'noSlip',
      description: 'No-slip boundary condition for velocity (fixed to zero)',
      category: 'boundary',
      examples: ['type            noSlip;']
    });

    this.addKeyword({
      name: 'symmetry',
      description: 'Symmetry plane boundary condition',
      category: 'boundary',
      examples: ['type            symmetry;']
    });

    this.addKeyword({
      name: 'empty',
      description: 'Empty boundary for 2D cases (no solving in this direction)',
      category: 'boundary',
      examples: ['type            empty;']
    });

    this.addKeyword({
      name: 'wedge',
      description: 'Wedge boundary for axisymmetric cases',
      category: 'boundary',
      examples: ['type            wedge;']
    });

    this.addKeyword({
      name: 'cyclic',
      description: 'Cyclic (periodic) boundary condition',
      category: 'boundary',
      examples: ['type            cyclic;']
    });

    this.addKeyword({
      name: 'processor',
      description: 'Processor boundary for parallel decomposition',
      category: 'boundary',
      examples: ['type            processor;']
    });

    this.addKeyword({
      name: 'wall',
      description: 'Wall patch type',
      category: 'boundary',
      examples: ['type            wall;']
    });

    this.addKeyword({
      name: 'patch',
      description: 'Generic patch type',
      category: 'boundary',
      examples: ['type            patch;']
    });

    // Field and value keywords
    this.addKeyword({
      name: 'uniform',
      description: 'Uniform field value (same everywhere)',
      category: 'property',
      parameters: [
        { name: 'value', type: 'scalar or vector', required: true, description: 'Uniform value' }
      ],
      examples: ['internalField   uniform 0;', 'value           uniform (1 0 0);']
    });

    this.addKeyword({
      name: 'nonuniform',
      description: 'Non-uniform field value (list of values)',
      category: 'property',
      examples: ['internalField   nonuniform List<scalar>\n10\n(\n    1\n    2\n    3\n    ...\n);']
    });

    this.addKeyword({
      name: 'dimensions',
      description: 'Physical dimensions [kg m s K mol A cd]',
      category: 'property',
      parameters: [
        { name: 'dims', type: 'vector', required: true, description: '7-element vector of dimension exponents' }
      ],
      examples: [
        'dimensions      [0 2 -2 0 0 0 0];  // m^2/s^2',
        'dimensions      [1 -3 0 0 0 0 0];  // kg/m^3'
      ]
    });

    // ============================================================================
    // ADDITIONAL BOUNDARY CONDITIONS - From User Guide and Source Code
    // ============================================================================

    this.addKeyword({
      name: 'mixed',
      description: 'Base class for mixed-type boundary conditions that blend fixed value and normal gradient: x_p = w*refValue + (1-w)*(x_c + ∇_⊥x/Δ). Weight field valueFraction (0-1) controls contribution. w=1 gives fixedValue, w=0 gives fixedGradient. Not usually applied directly - use derived conditions like inletOutlet.',
      category: 'boundary',
      parameters: [
        { name: 'refValue', type: 'field', required: true, description: 'Reference fixed value component' },
        { name: 'refGradient', type: 'field', required: true, description: 'Reference normal gradient component' },
        { name: 'valueFraction', type: 'scalar', required: true, description: 'Weight field (0-1): 0=gradient, 1=fixed value' }
      ],
      examples: ['type            mixed;\nrefValue        uniform 0;\nrefGradient     uniform 0;\nvalueFraction   uniform 1;']
    });

    // ============================================================================
    // ADDITIONAL NUMERICAL SCHEMES - From User Guide
    // ============================================================================

    // Time schemes
    this.addKeyword({
      name: 'd2dt2Schemes',
      description: 'Second time derivative (∂²ϕ/∂t²) discretization schemes sub-dictionary. Only Euler scheme is available. Used rarely for acceleration terms in solid mechanics.',
      category: 'scheme',
      examples: ['d2dt2Schemes\n{\n    default         Euler;\n}']
    });

    // Gradient schemes
    this.addKeyword({
      name: 'leastSquares',
      description: 'Second-order least squares gradient calculation using all neighbor cells. More accurate than Gauss linear on irregular meshes. Evaluates gradient by minimizing error at all neighbors. Computationally more expensive than Gauss.',
      category: 'scheme',
      examples: ['grad(U)         leastSquares;']
    });

    this.addKeyword({
      name: 'cellLimited',
      description: 'Limited gradient scheme ensuring extrapolated face values remain within bounds of surrounding cell values. Coefficient (0-1): 1 = full limiting (guaranteed boundedness), 0 = no limiting. Essential for stability with poor quality meshes. Commonly used: cellLimited Gauss linear 1.',
      category: 'scheme',
      parameters: [
        { name: 'scheme', type: 'word', required: true, description: 'Underlying gradient scheme (typically Gauss linear)' },
        { name: 'coefficient', type: 'scalar', required: true, description: 'Limiting coefficient (0-1), usually 1' }
      ],
      examples: [
        'grad(U)         cellLimited Gauss linear 1;',
        'grad(k)         cellLimited Gauss linear 1;',
        'grad(epsilon)   cellLimited Gauss linear 1;'
      ]
    });

    this.addKeyword({
      name: 'cubic',
      description: 'Third-order gradient or interpolation scheme using cubic polynomial. Higher accuracy than linear but requires high mesh quality. Appears in solidDisplacement and dnsFoam examples. More expensive computationally.',
      category: 'scheme',
      examples: ['default         Gauss cubic;']
    });

    // Advanced divergence schemes
    this.addKeyword({
      name: 'limitedLinearV',
      description: 'Limited linear scheme specialized for vector fields. Calculates single limiter based on direction of most rapidly changing gradient, applies to all vector components. Stronger limiting than limitedLinear but more stable. Coefficient (0-1): 1 = strongest limiting.',
      category: 'scheme',
      parameters: [
        { name: 'coefficient', type: 'scalar', required: true, description: 'Limiter coefficient (typically 1)' }
      ],
      examples: ['div(phi,U)      Gauss limitedLinearV 1;']
    });

    this.addKeyword({
      name: 'linearUpwindV',
      description: 'Second-order upwind scheme specialized for vector fields. Single limiter calculated for all components based on most rapidly changing gradient. More stable than standard linearUpwind. Requires gradient scheme specification.',
      category: 'scheme',
      parameters: [
        { name: 'gradScheme', type: 'word', required: true, description: 'Gradient scheme (e.g., grad(U))' }
      ],
      examples: ['div(phi,U)      Gauss linearUpwindV grad(U);']
    });

    this.addKeyword({
      name: 'bounded',
      description: 'Bounded variant of Gauss scheme that includes material time derivative term: Dϕ/Dt = ∂ϕ/∂t + ∇·(Uϕ) - (∇·U)ϕ. Third term helps maintain boundedness before convergence (∇·U=0). Used in steady-state cases to improve stability and convergence. Syntax: bounded Gauss <scheme>.',
      category: 'scheme',
      examples: [
        'div(phi,U)      bounded Gauss limitedLinearV 1;',
        'div(phi,U)      bounded Gauss linearUpwindV grad(U);'
      ]
    });

    this.addKeyword({
      name: 'vanAlbada',
      description: 'Van Albada flux limiter scheme. Smooth TVD (Total Variation Diminishing) limiter with good compromise between accuracy and stability. Less compressive than SuperBee, less diffusive than Van Leer. Used for scalar transport.',
      category: 'scheme',
      examples: ['div(phi,e)      Gauss vanAlbada;']
    });

    this.addKeyword({
      name: 'limitedLinear01',
      description: 'Specialized limited linear scheme for scalar fields bounded between 0 and 1 (e.g., volume fraction α, flame regress variable b). Stronger limiting than standard limitedLinear to enforce 0-1 bounds. Coefficient typically 1.',
      category: 'scheme',
      parameters: [
        { name: 'coefficient', type: 'scalar', required: true, description: 'Limiter coefficient (typically 1)' }
      ],
      examples: [
        'div(phiSt,b)    Gauss limitedLinear01 1;',
        'div(phi,alpha)  Gauss limitedLinear01 1;'
      ]
    });

    this.addKeyword({
      name: 'multivariateSelection',
      description: 'Groups multiple equation terms and applies single strongest limiter calculated across all terms. Ensures consistency when solving coupled equations (e.g., species transport + enthalpy). Calculates limiter once, applies to all fields.',
      category: 'scheme',
      examples: [
        'div(phi,Yi_h)   Gauss multivariateSelection\n{\n    O2  limitedLinear01 1;\n    CH4 limitedLinear01 1;\n    N2  limitedLinear01 1;\n    H2O limitedLinear01 1;\n    CO2 limitedLinear01 1;\n    h   limitedLinear 1;\n}'
      ]
    });

    // Surface normal gradient schemes
    this.addKeyword({
      name: 'orthogonal',
      description: 'Basic orthogonal surface normal gradient: (ϕ_neighbor - ϕ_owner)/d. Second-order accurate only when cell-cell vector is perpendicular to face. Recommended only for highly orthogonal meshes (max non-orthogonality < 5°). No non-orthogonal correction applied.',
      category: 'scheme',
      examples: ['default         orthogonal;']
    });

    this.addKeyword({
      name: 'limited corrected',
      description: 'Limited non-orthogonal correction for surface normal gradient. Applies partial correction: ψ controls limiting strength. ψ=0: uncorrected, ψ=0.33: correction ≤ 0.5×orthogonal part (stable), ψ=0.5: correction ≤ orthogonal part (accurate), ψ=1: full corrected. Use for max non-orthogonality 75-85°.',
      category: 'scheme',
      parameters: [
        { name: 'coefficient', type: 'scalar', required: true, description: 'Limiting coefficient: 0.33 (stable) or 0.5 (accurate)' }
      ],
      examples: [
        'default         limited corrected 0.33;',
        'default         limited corrected 0.5;'
      ]
    });

    // Advanced interpolation schemes
    this.addKeyword({
      name: 'pointLinear',
      description: 'Linear interpolation using point (vertex) values rather than cell values. Inverse-distance weighting from cells to vertices, then interpolates to faces. Reduces skewness error on tetrahedral and highly skewed meshes. More expensive than standard linear.',
      category: 'scheme',
      examples: ['interpolationSchemes\n{\n    default         pointLinear;\n}']
    });

    // ============================================================================
    // LINEAR SOLVER SETTINGS - From fvSolution User Guide
    // ============================================================================

    this.addKeyword({
      name: 'PCG',
      description: 'Preconditioned Conjugate Gradient solver for SYMMETRIC matrices. Iterative method with preconditioning (DIC, DILU, FDIC, diagonal, none). Efficient for Laplacian-dominated equations. Set preconditioner, tolerance, relTol, maxIter.',
      category: 'solver',
      parameters: [
        { name: 'preconditioner', type: 'word', required: true, description: 'DIC, DILU, FDIC, diagonal, or none' },
        { name: 'tolerance', type: 'scalar', required: true, description: 'Absolute convergence tolerance (e.g., 1e-7)' },
        { name: 'relTol', type: 'scalar', required: true, description: 'Relative tolerance (0 for transient)' },
        { name: 'maxIter', type: 'integer', required: false, description: 'Maximum iterations (default 1000)' }
      ],
      examples: [
        'solver          PCG;\npreconditioner  DIC;\ntolerance       1e-07;\nrelTol          0.01;'
      ]
    });

    this.addKeyword({
      name: 'PBiCG',
      description: 'Preconditioned Bi-Conjugate Gradient solver for ASYMMETRIC matrices. Used when matrix includes advection terms. Less stable than PBiCGStab. Preconditioner options: DILU, diagonal, none.',
      category: 'solver',
      parameters: [
        { name: 'preconditioner', type: 'word', required: true, description: 'DILU, diagonal, or none' },
        { name: 'tolerance', type: 'scalar', required: true, description: 'Absolute convergence tolerance' },
        { name: 'relTol', type: 'scalar', required: true, description: 'Relative tolerance' }
      ],
      examples: [
        'solver          PBiCG;\npreconditioner  DILU;\ntolerance       1e-05;\nrelTol          0.1;'
      ]
    });

    this.addKeyword({
      name: 'PBiCGStab',
      description: 'Stabilized Preconditioned Bi-Conjugate Gradient solver for ASYMMETRIC matrices. More stable than PBiCG, recommended for advection-dominated problems. Preconditioner: DILU, diagonal, or none. Commonly used for velocity, turbulence fields.',
      category: 'solver',
      parameters: [
        { name: 'preconditioner', type: 'word', required: true, description: 'DILU, diagonal, or none' },
        { name: 'tolerance', type: 'scalar', required: true, description: 'Absolute tolerance' },
        { name: 'relTol', type: 'scalar', required: true, description: 'Relative tolerance' }
      ],
      examples: [
        'solver          PBiCGStab;\npreconditioner  DILU;\ntolerance       1e-05;\nrelTol          0;'
      ]
    });

    this.addKeyword({
      name: 'smoothSolver',
      description: 'Solver using iterative smoother (GaussSeidel, symGaussSeidel, DIC, DILU, DICGaussSeidel). Specify smoother type and optional nSweeps (default 1). Good for moderately stiff problems.',
      category: 'solver',
      parameters: [
        { name: 'smoother', type: 'word', required: true, description: 'GaussSeidel, symGaussSeidel, DIC, DILU, or DICGaussSeidel' },
        { name: 'nSweeps', type: 'integer', required: false, description: 'Number of sweeps (default 1)' },
        { name: 'tolerance', type: 'scalar', required: true, description: 'Convergence tolerance' },
        { name: 'relTol', type: 'scalar', required: true, description: 'Relative tolerance' }
      ],
      examples: [
        'solver          smoothSolver;\nsmoother        symGaussSeidel;\ntolerance       1e-05;\nrelTol          0.1;'
      ]
    });

    this.addKeyword({
      name: 'GAMG',
      description: 'Geometric-Algebraic Multi-Grid solver. Solves on progressively coarser meshes, maps solution to finer mesh. Fast for large systems when coarsening cost < solving cost. Requires: smoother, nCellsInCoarsestLevel (default 10), agglomerator (faceAreaPair), cacheAgglomeration (true), nPreSweeps, nPostSweeps, nFinestSweeps, mergeLevels.',
      category: 'solver',
      parameters: [
        { name: 'smoother', type: 'word', required: true, description: 'GaussSeidel, DICGaussSeidel, etc.' },
        { name: 'tolerance', type: 'scalar', required: true, description: 'Convergence tolerance' },
        { name: 'relTol', type: 'scalar', required: true, description: 'Relative tolerance' },
        { name: 'nCellsInCoarsestLevel', type: 'integer', required: false, description: 'Target coarse mesh size (default 10)' },
        { name: 'agglomerator', type: 'word', required: false, description: 'Agglomeration method (default faceAreaPair)' },
        { name: 'cacheAgglomeration', type: 'boolean', required: false, description: 'Cache strategy (default true)' },
        { name: 'mergeLevels', type: 'integer', required: false, description: 'Coarsening speed: 1 (safe) or 2 (fast, simple meshes)' }
      ],
      examples: [
        'solver           GAMG;\nsmoother         DICGaussSeidel;\ntolerance        1e-07;\nrelTol           0.01;\nnCellsInCoarsestLevel 10;'
      ]
    });

    // Preconditioner and smoother keywords
    this.addKeyword({
      name: 'DIC',
      description: 'Diagonal Incomplete-Cholesky preconditioner for SYMMETRIC matrices. Efficient, commonly used with PCG solver. Better convergence than diagonal, more stable than FDIC.',
      category: 'solver',
      examples: ['preconditioner  DIC;']
    });

    this.addKeyword({
      name: 'DILU',
      description: 'Diagonal Incomplete-LU preconditioner for ASYMMETRIC matrices. Standard choice for PBiCG/PBiCGStab solvers. Balances performance and stability.',
      category: 'solver',
      examples: ['preconditioner  DILU;']
    });

    this.addKeyword({
      name: 'FDIC',
      description: 'Fast Diagonal Incomplete-Cholesky preconditioner (DIC with caching) for SYMMETRIC matrices. Slightly faster than DIC. Use with PCG.',
      category: 'solver',
      examples: ['preconditioner  FDIC;']
    });

    this.addKeyword({
      name: 'GaussSeidel',
      description: 'Gauss-Seidel smoother for smoothSolver or GAMG. Sequential cell-by-cell relaxation. Good general-purpose smoother.',
      category: 'solver',
      examples: ['smoother        GaussSeidel;']
    });

    this.addKeyword({
      name: 'symGaussSeidel',
      description: 'Symmetric Gauss-Seidel smoother (forward + backward sweep) for smoothSolver or GAMG. More stable than GaussSeidel. Preferred in OpenFOAM tutorials.',
      category: 'solver',
      examples: ['smoother        symGaussSeidel;']
    });

    this.addKeyword({
      name: 'DICGaussSeidel',
      description: 'Combined DIC/DILU preconditioner with Gauss-Seidel smoother. Used in GAMG solver. Balances accuracy and cost.',
      category: 'solver',
      examples: ['smoother        DICGaussSeidel;']
    });

    // Solution control parameters
    this.addKeyword({
      name: 'cacheAgglomeration',
      description: 'Switch for GAMG solver: cache agglomeration strategy. true = faster but more memory, false = recompute each time. Default true in tutorials.',
      category: 'solver',
      parameters: [
        { name: 'value', type: 'boolean', required: true, description: 'true (cache, faster) or false (recompute)' }
      ],
      examples: ['cacheAgglomeration true;']
    });

    this.addKeyword({
      name: 'nCellsInCoarsestLevel',
      description: 'Target number of cells at coarsest GAMG level. Controls how much coarsening occurs. Default 10. Lower = more coarsening (faster but less accurate), higher = less coarsening (slower but more accurate). Typical range: 10-50.',
      category: 'solver',
      parameters: [
        { name: 'value', type: 'integer', required: true, description: 'Number of cells at coarsest level (default 10)' }
      ],
      examples: ['nCellsInCoarsestLevel 10;', 'nCellsInCoarsestLevel 50;']
    });

    this.addKeyword({
      name: 'agglomerator',
      description: 'Agglomeration method for GAMG cell coarsening. faceAreaPair (default): merges cells based on face areas. Determines how cells are combined at coarser levels.',
      category: 'solver',
      parameters: [
        { name: 'type', type: 'word', required: true, description: 'faceAreaPair or pairPatchAgglomeration' }
      ],
      examples: ['agglomerator    faceAreaPair;']
    });

    this.addKeyword({
      name: 'mergeLevels',
      description: 'Controls GAMG coarsening/refinement speed. 1 (default, safe): single level at a time. 2 (faster): skip levels, suitable for simple meshes. Higher values more aggressive but may reduce robustness.',
      category: 'solver',
      parameters: [
        { name: 'value', type: 'integer', required: true, description: 'Merge levels: 1 (safe) or 2 (fast)' }
      ],
      examples: ['mergeLevels     1;', 'mergeLevels     2;']
    });

    this.addKeyword({
      name: 'nPreSweeps',
      description: 'Number of GAMG smoother sweeps during coarsening phase. Default 0. Controls smoothing as algorithm moves to coarser meshes.',
      category: 'solver',
      parameters: [
        { name: 'value', type: 'integer', required: true, description: 'Sweeps count (default 0)' }
      ],
      examples: ['nPreSweeps      0;']
    });

    this.addKeyword({
      name: 'nPostSweeps',
      description: 'Number of GAMG smoother sweeps during refinement phase. Default 2. Controls smoothing as algorithm returns to finer meshes. Typically 2-4.',
      category: 'solver',
      parameters: [
        { name: 'value', type: 'integer', required: true, description: 'Sweeps count (default 2)' }
      ],
      examples: ['nPostSweeps     2;']
    });

    this.addKeyword({
      name: 'nFinestSweeps',
      description: 'Number of GAMG smoother sweeps at finest (original) mesh level. Default 2. Final smoothing pass for accuracy.',
      category: 'solver',
      parameters: [
        { name: 'value', type: 'integer', required: true, description: 'Sweeps count at finest level (default 2)' }
      ],
      examples: ['nFinestSweeps   2;']
    });

    this.addKeyword({
      name: 'fields',
      description: 'Sub-dictionary within relaxationFactors for field-level under-relaxation. Modifies field after solving: ϕ_new = α*ϕ_computed + (1-α)*ϕ_old. Used in steady-state SIMPLE algorithm. Typical: p=0.3, other fields via equations.',
      category: 'solver',
      examples: [
        'fields\n{\n    p               0.3;\n}'
      ]
    });

    this.addKeyword({
      name: 'equations',
      description: 'Sub-dictionary within relaxationFactors for equation-level under-relaxation. Manipulates matrix coefficients before solving. Used in steady-state SIMPLE. Typical: U=0.7, turbulence fields=0.7. Higher α = faster convergence but less stable.',
      category: 'solver',
      examples: [
        'equations\n{\n    U               0.7;\n    "(k|epsilon|omega)" 0.7;\n}'
      ]
    });

    this.addKeyword({
      name: 'pRefCell',
      description: 'Reference cell index for pressure in closed incompressible systems. Sets absolute pressure level (pressure is relative). Typically cell 0. Used in SIMPLE/PIMPLE dictionaries.',
      category: 'solver',
      parameters: [
        { name: 'value', type: 'integer', required: true, description: 'Cell index (typically 0)' }
      ],
      examples: ['pRefCell        0;']
    });

    this.addKeyword({
      name: 'pRefValue',
      description: 'Reference pressure value (Pa) at pRefCell in closed incompressible systems. Sets datum for relative pressure field. Typically 0 or atmospheric pressure.',
      category: 'solver',
      parameters: [
        { name: 'value', type: 'scalar', required: true, description: 'Pressure value (Pa)' }
      ],
      examples: ['pRefValue       0;', 'pRefValue       1e5;']
    });

    // Function objects
    this.addKeyword({
      name: 'functions',
      description: 'Dictionary of function objects for post-processing and monitoring',
      category: 'function',
      examples: [
        'functions\n{\n    forces\n    {\n        type            forces;\n        libs            ("libforces.so");\n        patches         (wall);\n        ...\n    }\n}'
      ]
    });

    this.addKeyword({
      name: 'libs',
      description: 'List of shared libraries to load',
      category: 'function',
      examples: ['libs            ("libforces.so");', 'libs            ("libfieldFunctionObjects.so");']
    });

    // Common utilities
    this.addKeyword({
      name: 'castellatedMesh',
      description: 'Enable castellated mesh generation in snappyHexMesh',
      category: 'utility',
      parameters: [
        { name: 'value', type: 'boolean', required: true, description: 'true or false' }
      ],
      examples: ['castellatedMesh true;']
    });

    this.addKeyword({
      name: 'snap',
      description: 'Enable snapping to surface in snappyHexMesh',
      category: 'utility',
      parameters: [
        { name: 'value', type: 'boolean', required: true, description: 'true or false' }
      ],
      examples: ['snap            true;']
    });

    this.addKeyword({
      name: 'addLayers',
      description: 'Enable layer addition in snappyHexMesh',
      category: 'utility',
      parameters: [
        { name: 'value', type: 'boolean', required: true, description: 'true or false' }
      ],
      examples: ['addLayers       true;']
    });

    // ============================================================================
    // SNAPPYHEXMESH UTILITY - Comprehensive mesh generation keywords
    // ============================================================================

    this.addKeyword({
      name: 'snappyHexMesh',
      description: 'Automatic split hex mesher. Refines hexahedral background mesh, snaps to surface geometry, and adds boundary layers. Three main phases: castellatedMesh (refinement), snap (surface fitting), addLayers (boundary layers). Configure in system/snappyHexMeshDict.',
      category: 'utility',
      examples: ['snappyHexMesh']
    });

    this.addKeyword({
      name: 'snappyHexMeshDict',
      description: 'Configuration dictionary for snappyHexMesh in system/ directory. Contains: geometry (surfaces), castellatedMeshControls (refinement), snapControls (snapping), addLayersControls (layers), meshQualityControls (quality checks).',
      category: 'utility',
      examples: ['#includeEtc "caseDicts/mesh/generation/snappyHexMeshDict.cfg"']
    });

    this.addKeyword({
      name: 'geometry',
      description: 'Sub-dictionary in snappyHexMeshDict defining surface geometries for mesh generation. Supported types: closedTriSurface, distributedTriSurface, searchableBox, searchableCylinder, searchableSphere, searchablePlate. Geometries used for refinement, snapping, and region definition.',
      category: 'utility',
      examples: [
        'geometry\n{\n    wing\n    {\n        type triSurfaceMesh;\n        file "wing.obj";\n    }\n}'
      ]
    });

    this.addKeyword({
      name: 'castellatedMeshControls',
      description: 'Sub-dictionary controlling castellated mesh refinement phase in snappyHexMesh. Defines: features (edge refinement), refinementSurfaces (surface refinement levels), refinementRegions (volumetric refinement), locationInMesh (inside point), maxLocalCells, maxGlobalCells.',
      category: 'utility',
      examples: [
        'castellatedMeshControls\n{\n    maxLocalCells 1000000;\n    maxGlobalCells 2000000;\n    minRefinementCells 10;\n    nCellsBetweenLevels 3;\n    ...\n}'
      ]
    });

    this.addKeyword({
      name: 'refinementSurfaces',
      description: 'Dictionary within castellatedMeshControls specifying refinement levels for each surface: level (min max) for cells near/intersecting surface. Higher level = finer mesh (level N divides cells 2^N times). Can specify patchInfo (boundary type).',
      category: 'utility',
      parameters: [
        { name: 'level', type: 'tuple', required: true, description: '(minLevel maxLevel) refinement' },
        { name: 'patchInfo', type: 'dictionary', required: false, description: 'Patch type specification' }
      ],
      examples: [
        'refinementSurfaces\n{\n    wing\n    {\n        level (2 3);\n        patchInfo { type wall; }\n    }\n}'
      ]
    });

    this.addKeyword({
      name: 'refinementRegions',
      description: 'Dictionary within castellatedMeshControls for volumetric refinement. Refines cells inside/outside/near regions defined by geometry. Modes: inside, outside, distance. Levels specified as (level) or distance table.',
      category: 'utility',
      examples: [
        'refinementRegions\n{\n    boxRegion\n    {\n        mode inside;\n        level (3);\n    }\n}'
      ]
    });

    this.addKeyword({
      name: 'snapControls',
      description: 'Sub-dictionary controlling snap-to-surface phase in snappyHexMesh. Moves mesh vertices to lie on surface geometry. Parameters: nSmoothPatch (smoothing iterations), tolerance (attraction distance), nSolveIter (displacement iterations), nRelaxIter (relaxation iterations), nFeatureSnapIter (feature edge snapping).',
      category: 'utility',
      examples: [
        'snapControls\n{\n    nSmoothPatch 3;\n    tolerance 3.0;\n    nSolveIter 30;\n    nRelaxIter 5;\n    nFeatureSnapIter 10;\n}'
      ]
    });

    this.addKeyword({
      name: 'addLayersControls',
      description: 'Sub-dictionary controlling boundary layer addition in snappyHexMesh. Grows layers of cells from surfaces. Parameters: relativeSizes (thickness relative to local size), expansionRatio (growth rate), finalLayerThickness, minThickness, nGrow, nBufferCellsNoExtrude, nRelaxIter, nSmoothSurfaceNormals.',
      category: 'utility',
      examples: [
        'addLayersControls\n{\n    relativeSizes true;\n    layers\n    {\n        "(wall.*)" { nSurfaceLayers 3; }\n    }\n    expansionRatio 1.2;\n    finalLayerThickness 0.3;\n    minThickness 0.1;\n}'
      ]
    });

    this.addKeyword({
      name: 'meshQualityControls',
      description: 'Sub-dictionary in snappyHexMeshDict defining mesh quality criteria. Checks: maxNonOrtho (non-orthogonality), maxBoundarySkewness, maxInternalSkewness, maxConcave, minVol, minTetQuality, minArea, minTwist, minDeterminant, minFaceWeight, minVolRatio, minTriangleTwist. Violations cause cell splitting or layer reduction.',
      category: 'utility',
      examples: [
        'meshQualityControls\n{\n    maxNonOrtho 65;\n    maxBoundarySkewness 20;\n    maxInternalSkewness 4;\n    maxConcave 80;\n    minVol 1e-13;\n    minTetQuality 1e-15;\n}'
      ]
    });

    this.addKeyword({
      name: 'locationInMesh',
      description: 'Point coordinate in snappyHexMesh castellatedMeshControls specifying which region to keep. Point must lie inside desired mesh region (not in refinement geometry cells). Cells not reachable from this point are removed. Also called insidePoint.',
      category: 'utility',
      parameters: [
        { name: 'point', type: 'vector', required: true, description: '(x y z) coordinates' }
      ],
      examples: ['locationInMesh (1e-5 1e-5 1e-5);', 'insidePoint (0.001 0.001 0.001);']
    });

    this.addKeyword({
      name: 'features',
      description: 'List within castellatedMeshControls specifying edge feature files (.eMesh) for refined snapping. Features are sharp edges extracted from geometry using surfaceFeatureExtract. Each entry specifies file and refinement levels.',
      category: 'utility',
      examples: [
        'features\n(\n    {\n        file "wing.eMesh";\n        level 3;\n    }\n);'
      ]
    });

    // ============================================================================
    // ADDITIONAL BOUNDARY CONDITIONS - Wave, atmosphere, specialized inlet/outlet
    // ============================================================================

    this.addKeyword({
      name: 'waveVelocity',
      description: 'Wave velocity boundary condition for free surface flows. Sets velocity from superposition of wave models (Airy, Stokes, etc.) defined in waveSuperposition class. Used at wave generation boundaries. Requires libwaves.so library. Automatically handles inlet/outlet switching.',
      category: 'boundary',
      parameters: [
        { name: 'phi', type: 'word', required: false, description: 'Flux field name (default: phi)' },
        { name: 'libs', type: 'list', required: true, description: 'Must include "libwaves.so"' }
      ],
      examples: [
        'type            waveVelocity;\nlibs            ("libwaves.so");'
      ]
    });

    this.addKeyword({
      name: 'waveSurfacePressure',
      description: 'Pressure boundary condition at free surface for wave simulations. Calculates pressure from wave elevation and acceleration. Coupled with waveVelocity and waveAlpha conditions. Requires wave superposition to be defined.',
      category: 'boundary',
      parameters: [
        { name: 'libs', type: 'list', required: true, description: 'Must include "libwaves.so"' }
      ],
      examples: [
        'type            waveSurfacePressure;\nlibs            ("libwaves.so");'
      ]
    });

    this.addKeyword({
      name: 'waveAlpha',
      description: 'Volume fraction (alpha) boundary condition for wave simulations. Sets phase indicator field consistent with wave profile from waveSuperposition. Used in multiphase VOF solvers with free surface waves.',
      category: 'boundary',
      parameters: [
        { name: 'libs', type: 'list', required: true, description: 'Must include "libwaves.so"' }
      ],
      examples: [
        'type            waveAlpha;\nlibs            ("libwaves.so");'
      ]
    });

    this.addKeyword({
      name: 'uniformFixedValue',
      description: 'Fixed value boundary condition with time-varying uniform value. Uses Function1 to specify value that can change in time: constant, table, polynomial, sine, square, etc. More flexible than fixedValue for transient conditions.',
      category: 'boundary',
      parameters: [
        { name: 'uniformValue', type: 'Function1', required: true, description: 'Time-varying value specification (constant, table, etc.)' }
      ],
      examples: [
        'type            uniformFixedValue;\nuniformValue    constant 0.2;',
        'type            uniformFixedValue;\nuniformValue    table\n(\n    (0 0)\n    (1 1)\n    (2 0.5)\n);'
      ]
    });

    this.addKeyword({
      name: 'prghTotalHydrostaticPressure',
      description: 'Total hydrostatic pressure boundary condition for p_rgh = p - ρgh field. Used in buoyancy-driven flows with variable density. Specifies total pressure p0 = p_rgh + ρgh, solver computes p_rgh. Essential for incompressibleVoF and buoyantFoam solvers.',
      category: 'boundary',
      parameters: [
        { name: 'p0', type: 'scalar', required: true, description: 'Total pressure value (Pa)' },
        { name: 'rho', type: 'word', required: false, description: 'Density field name (default: rho)' }
      ],
      examples: [
        'type            prghTotalHydrostaticPressure;\np0              uniform 1e5;'
      ]
    });

    this.addKeyword({
      name: 'prghTotalPressure',
      description: 'Total pressure for p_rgh field: p0 = p_rgh + 0.5*ρ*|U|² + ρgh. Combines dynamic and hydrostatic pressure. Used at inlets/outlets in buoyancy-driven flows. Like totalPressure but for p_rgh instead of p.',
      category: 'boundary',
      parameters: [
        { name: 'p0', type: 'scalar', required: true, description: 'Total pressure (Pa)' },
        { name: 'U', type: 'word', required: false, description: 'Velocity field (default: U)' },
        { name: 'phi', type: 'word', required: false, description: 'Flux field (default: phi)' }
      ],
      examples: [
        'type            prghTotalPressure;\np0              uniform 1e5;\nU               U;\nphi             phi;'
      ]
    });

    this.addKeyword({
      name: 'prghPressure',
      description: 'Static pressure for p_rgh field with adjustments for gravity: p_rgh = p_static - ρgh. Adjusts reference pressure for hydrostatic effects. Used at outlets in buoyancy-driven incompressible flows.',
      category: 'boundary',
      parameters: [
        { name: 'p', type: 'scalar', required: true, description: 'Static pressure value (Pa)' }
      ],
      examples: [
        'type            prghPressure;\np               uniform 0;'
      ]
    });

    this.addKeyword({
      name: 'noSlip',
      description: 'No-slip wall boundary condition for velocity. Sets velocity to zero at wall surface: U = 0. Standard condition for viscous wall boundaries. Equivalent to fixedValue uniform (0 0 0) but more explicit.',
      category: 'boundary',
      examples: [
        'type            noSlip;'
      ]
    });

    this.addKeyword({
      name: 'partialSlip',
      description: 'Partial slip wall boundary condition with slip fraction. Blends no-slip and free-slip: U_parallel = (1-f)*U_adjacent, where f is valueFraction (0=free slip, 1=no slip). Used for rough walls or porous boundaries.',
      category: 'boundary',
      parameters: [
        { name: 'valueFraction', type: 'scalar', required: true, description: 'Slip fraction (0-1): 0=free slip, 1=no slip' }
      ],
      examples: [
        'type            partialSlip;\nvalueFraction   uniform 0.5;'
      ]
    });

    this.addKeyword({
      name: 'movingWallVelocity',
      description: 'Moving wall velocity condition with specified wall velocity. Sets velocity equal to prescribed wall motion. Used for moving boundaries, sliding meshes, piston walls. Velocity can be uniform or spatially varying.',
      category: 'boundary',
      parameters: [
        { name: 'value', type: 'vector', required: true, description: 'Wall velocity' }
      ],
      examples: [
        'type            movingWallVelocity;\nvalue           uniform (1 0 0);'
      ]
    });

    this.addKeyword({
      name: 'rotatingWallVelocity',
      description: 'Rotating wall velocity for rotating reference frames. Calculates velocity from angular velocity ω and position: U = ω × r. Used for impeller blades, turbine rotors, rotating cylinders. Specify origin, axis, and rpm or omega.',
      category: 'boundary',
      parameters: [
        { name: 'origin', type: 'vector', required: true, description: 'Rotation axis origin' },
        { name: 'axis', type: 'vector', required: true, description: 'Rotation axis direction' },
        { name: 'omega', type: 'scalar', required: false, description: 'Angular velocity (rad/s) or rpm' }
      ],
      examples: [
        'type            rotatingWallVelocity;\norigin          (0 0 0);\naxis            (0 0 1);\nomega           10;'
      ]
    });

    this.addKeyword({
      name: 'surfaceNormalFixedValue',
      description: 'Fixed value in surface normal direction only. Specifies magnitude of velocity component normal to surface: U·n = refValue. Tangential components zero gradient. Used for uniform inflow perpendicular to curved surfaces.',
      category: 'boundary',
      parameters: [
        { name: 'refValue', type: 'scalar', required: true, description: 'Normal component magnitude' }
      ],
      examples: [
        'type            surfaceNormalFixedValue;\nrefValue        uniform -10;'
      ]
    });

    this.addKeyword({
      name: 'pressureDirectedInletOutletVelocity',
      description: 'Inlet/outlet velocity condition with flow direction specified by inletDirection vector. Magnitude calculated from pressure. Used when flow direction known but velocity magnitude varies with pressure. Common for fan inlets with known flow angle.',
      category: 'boundary',
      parameters: [
        { name: 'inletDirection', type: 'vector', required: true, description: 'Flow direction (normalized internally)' },
        { name: 'phi', type: 'word', required: false, description: 'Flux field (default: phi)' }
      ],
      examples: [
        'type            pressureDirectedInletOutletVelocity;\ninletDirection  uniform (1 0 0);\nvalue           uniform (0 0 0);'
      ]
    });

    this.addKeyword({
      name: 'outletMappedUniformInlet',
      description: 'Inlet condition using uniform value mapped from outlet patch. Calculates average (or weighted average) at specified outlet, applies uniformly at inlet. Maintains mass balance for recirculation or periodic boundaries.',
      category: 'boundary',
      parameters: [
        { name: 'outletPatch', type: 'word', required: true, description: 'Name of outlet patch to sample' },
        { name: 'phi', type: 'word', required: false, description: 'Flux field for weighting' }
      ],
      examples: [
        'type            outletMappedUniformInlet;\noutletPatch     outlet;\nphi             phi;'
      ]
    });

    this.addKeyword({
      name: 'variableHeightFlowRate',
      description: 'Velocity inlet maintaining specified volumetric flow rate with variable liquid height. Used in VOF simulations with partially filled inlets. Adjusts velocity based on liquid fraction to maintain constant Q = U*A*α.',
      category: 'boundary',
      parameters: [
        { name: 'flowRate', type: 'scalar', required: true, description: 'Target volumetric flow rate (m³/s)' },
        { name: 'alpha', type: 'word', required: true, description: 'Phase fraction field name' }
      ],
      examples: [
        'type            variableHeightFlowRate;\nflowRate        0.1;\nalpha           alpha.water;'
      ]
    });

    this.addKeyword({
      name: 'interstitialInletVelocity',
      description: 'Inlet velocity for porous media flows. Converts superficial velocity (based on total area) to interstitial velocity (based on void area): U_interstitial = U_superficial / porosity. Used in packed bed, porous media simulations.',
      category: 'boundary',
      parameters: [
        { name: 'inletVelocity', type: 'vector', required: true, description: 'Superficial velocity' },
        { name: 'alpha', type: 'word', required: true, description: 'Porosity field name' }
      ],
      examples: [
        'type            interstitialInletVelocity;\ninletVelocity   uniform (1 0 0);\nalpha           alpha;'
      ]
    });

    this.addKeyword({
      name: 'matchedFlowRateOutletVelocity',
      description: 'Outlet velocity condition matching mass flow rate from inlet patch. Ensures global mass conservation by adjusting outlet velocity uniformly to match inlet flow. Used when outlet velocity unknown but mass balance required.',
      category: 'boundary',
      parameters: [
        { name: 'inletPatch', type: 'word', required: true, description: 'Inlet patch name to match flow rate' }
      ],
      examples: [
        'type            matchedFlowRateOutletVelocity;\ninletPatch      inlet;'
      ]
    });

    this.addKeyword({
      name: 'outletPhaseMeanVelocity',
      description: 'Outlet velocity for multiphase flows maintaining specified mean velocity in one phase. Calculates phase-weighted average velocity: U_mean = Σ(α*U*A) / Σ(α*A). Used in VOF to control liquid discharge rate.',
      category: 'boundary',
      parameters: [
        { name: 'Umean', type: 'scalar', required: true, description: 'Target mean velocity' },
        { name: 'alpha', type: 'word', required: true, description: 'Phase indicator field' }
      ],
      examples: [
        'type            outletPhaseMeanVelocity;\nUmean           1.5;\nalpha           alpha.water;'
      ]
    });

    this.addKeyword({
      name: 'fixedNormalSlip',
      description: 'Slip condition with fixed normal component and zero tangential gradient. Normal component: U·n = fixedValue, tangential: ∂U_t/∂n = 0. Used for symmetry planes with known normal flow, permeable walls.',
      category: 'boundary',
      parameters: [
        { name: 'fixedValue', type: 'vector', required: true, description: 'Fixed normal component value' }
      ],
      examples: [
        'type            fixedNormalSlip;\nfixedValue      uniform (0 0 0);'
      ]
    });

    this.addKeyword({
      name: 'MRFnoSlip',
      description: 'No-slip condition for walls in Multiple Reference Frame (MRF) zones. Accounts for rotating reference frame velocity when setting wall boundary. Used on stationary walls in MRF regions (e.g., casing around rotating impeller).',
      category: 'boundary',
      examples: [
        'type            MRFnoSlip;'
      ]
    });

    this.addKeyword({
      name: 'MRFslip',
      description: 'Slip condition for walls in rotating MRF zones. Used on rotating walls or symmetry planes within MRF region. Accounts for frame rotation when applying slip condition.',
      category: 'boundary',
      examples: [
        'type            MRFslip;'
      ]
    });

    this.addKeyword({
      name: 'movingMappedWallVelocity',
      description: 'Moving wall velocity mapped from another patch or region. Used for conjugate heat transfer with moving boundaries, FSI problems. Velocity obtained by sampling from specified patch.',
      category: 'boundary',
      examples: [
        'type            movingMappedWallVelocity;'
      ]
    });

    this.addKeyword({
      name: 'fixedPressureCompressibleDensity',
      description: 'Density boundary condition for compressible flows with fixed pressure. Calculates density from equation of state given pressure and temperature. Used at pressure inlets/outlets in compressible solvers.',
      category: 'boundary',
      parameters: [
        { name: 'p', type: 'word', required: true, description: 'Pressure field name' }
      ],
      examples: [
        'type            fixedPressureCompressibleDensity;\np               p;'
      ]
    });

    // Common utilities
    // BOUNDARY CONDITIONS - Enhanced with CFD Direct and OpenFOAM API documentation
    // ============================================================================

    // Basic boundary conditions
    this.addKeyword({
      name: 'fixedValue',
      description: 'Boundary condition that supplies a fixed value constraint. This is the base class for many other boundary conditions. The value is directly set and remains constant in time unless modified. Used at inlets with known values, walls with specified temperature, etc.',
      category: 'boundary',
      parameters: [
        { name: 'value', type: 'field', required: true, description: 'Patch face values (uniform or non-uniform)' }
      ],
      examples: [
        'type            fixedValue;\nvalue           uniform 0;  // Scalar field',
        'type            fixedValue;\nvalue           uniform (1 0 0);  // Vector field'
      ]
    });

    this.addKeyword({
      name: 'zeroGradient',
      description: 'Applies a zero-gradient condition from the patch internal field onto the patch faces. The normal gradient at the boundary is zero: ∂ϕ/∂n = 0. Commonly used at outlets, symmetry planes, and walls for pressure. The patch value equals the adjacent cell value.',
      category: 'boundary',
      examples: ['type            zeroGradient;']
    });

    this.addKeyword({
      name: 'fixedGradient',
      description: 'Boundary condition that sets a fixed gradient constraint: ∂ϕ/∂n = constant. The patch value is calculated from the gradient and adjacent cell values. Used for heat flux, velocity gradients, and other gradient-specified conditions.',
      category: 'boundary',
      parameters: [
        { name: 'gradient', type: 'field', required: true, description: 'Normal gradient value at the boundary' }
      ],
      examples: [
        'type            fixedGradient;\ngradient        uniform 0;'
      ]
    });

    this.addKeyword({
      name: 'calculated',
      description: 'Boundary condition where values are calculated from other fields. Typically used for derived quantities like turbulent viscosity, where the boundary value is computed internally by the solver rather than being prescribed.',
      category: 'boundary',
      examples: ['type            calculated;']
    });

    this.addKeyword({
      name: 'inletOutlet',
      description: 'Generic inlet-outlet boundary condition. Applies zeroGradient for outflow (ϕ·n < 0) and fixedValue for inflow (ϕ·n ≥ 0). Prevents backflow issues at outlets while allowing reverse flow with specified inletValue. Commonly used for scalars at pressure outlets.',
      category: 'boundary',
      parameters: [
        { name: 'inletValue', type: 'field', required: true, description: 'Value for inflow' },
        { name: 'phi', type: 'word', required: false, description: 'Flux field name (default: phi)' }
      ],
      examples: ['type            inletOutlet;\ninletValue      uniform 300;\nvalue           uniform 300;']
    });

    this.addKeyword({
      name: 'pressureInletOutletVelocity',
      description: 'Velocity boundary condition for pressure-driven flows. At outflow (ϕ·n < 0): applies zeroGradient. At inflow (ϕ·n ≥ 0): applies fixedValue. Typically paired with totalPressure for the pressure field. Ensures velocity correctly responds to pressure-specified boundaries.',
      category: 'boundary',
      parameters: [
        { name: 'value', type: 'vector', required: true, description: 'Initial velocity value' },
        { name: 'phi', type: 'word', required: false, description: 'Flux field name' }
      ],
      examples: ['type            pressureInletOutletVelocity;\nvalue           uniform (0 0 0);']
    });

    this.addKeyword({
      name: 'totalPressure',
      description: 'Boundary condition specifying total (stagnation) pressure: p_total = p_static + 0.5*ρ*|U|². Used at inlets/outlets where total pressure is known. The static pressure is calculated from total pressure minus dynamic pressure. Essential for compressible flows and fan boundaries.',
      category: 'boundary',
      parameters: [
        { name: 'p0', type: 'scalar', required: true, description: 'Total pressure value (Pa)' },
        { name: 'U', type: 'word', required: false, description: 'Velocity field name (default: U)' },
        { name: 'phi', type: 'word', required: false, description: 'Flux field name (default: phi)' },
        { name: 'rho', type: 'word', required: false, description: 'Density field (for compressible)' },
        { name: 'psi', type: 'word', required: false, description: 'Compressibility field' },
        { name: 'gamma', type: 'scalar', required: false, description: 'Ratio of specific heats' }
      ],
      examples: [
        'type            totalPressure;\np0              uniform 1e5;\nU               U;\nphi             phi;\nvalue           uniform 1e5;'
      ]
    });

    this.addKeyword({
      name: 'freestreamPressure',
      description: 'Freestream pressure boundary condition for external aerodynamics. Automatically adapts between zeroGradient (subsonic outflow) and fixedValue (inflow) based on flow direction. Paired with freestream velocity condition. Used in wind tunnel simulations.',
      category: 'boundary',
      parameters: [
        { name: 'freestreamValue', type: 'scalar', required: true, description: 'Freestream pressure value' }
      ],
      examples: ['type            freestreamPressure;\nfreestreamValue uniform 101325;']
    });

    this.addKeyword({
      name: 'outletInlet',
      description: 'Inverse of inletOutlet: applies fixedValue for outflow and zeroGradient for inflow. Used when you want to specify values leaving the domain but allow natural conditions for reverse flow. Common for recirculation zones.',
      category: 'boundary',
      parameters: [
        { name: 'outletValue', type: 'field', required: true, description: 'Value for outflow (ϕ·n < 0)' },
        { name: 'phi', type: 'word', required: false, description: 'Flux field name' }
      ],
      examples: ['type            outletInlet;\noutletValue     uniform 0;\nvalue           uniform 0;']
    });

    this.addKeyword({
      name: 'flowRateInletVelocity',
      description: 'Velocity boundary condition that adjusts to match a specified mass or volumetric flow rate. The velocity profile is determined by the area-weighted average. Useful when total flow rate is known but velocity distribution can vary. Automatically handles non-uniform mesh face distributions.',
      category: 'boundary',
      parameters: [
        { name: 'massFlowRate', type: 'scalar', required: false, description: 'Target mass flow rate (kg/s)' },
        { name: 'volumetricFlowRate', type: 'scalar', required: false, description: 'Target volumetric flow rate (m³/s)' },
        { name: 'rho', type: 'word', required: false, description: 'Density field for compressible flows' },
        { name: 'profile', type: 'word', required: false, description: 'Velocity profile type (uniform/parabolic)' }
      ],
      examples: [
        'type            flowRateInletVelocity;\nvolumetricFlowRate 0.01;\nvalue           uniform (0 0 0);'
      ]
    });

    // Turbulence-related boundary conditions
    this.addKeyword({
      name: 'turbulentIntensityKineticEnergyInlet',
      description: 'Calculates turbulent kinetic energy (k) from turbulence intensity and mean velocity: k = 1.5*(I*|U|)², where I is intensity (typically 0.01-0.1). Simplifies turbulence specification at inlets when intensity is known from experiments or empirical data.',
      category: 'boundary',
      parameters: [
        { name: 'intensity', type: 'scalar', required: true, description: 'Turbulent intensity as fraction (e.g., 0.05 = 5%)' },
        { name: 'U', type: 'word', required: false, description: 'Velocity field name (default: U)' },
        { name: 'phi', type: 'word', required: false, description: 'Flux field name' }
      ],
      examples: ['type            turbulentIntensityKineticEnergyInlet;\nintensity       0.05;\nvalue           uniform 0.375;']
    });

    this.addKeyword({
      name: 'turbulentMixingLengthDissipationRateInlet',
      description: 'Calculates turbulent dissipation rate (ε) from mixing length: ε = C_μ^(3/4) * k^(3/2) / l_m. The mixing length typically scales with geometry (e.g., 0.07*hydraulic_diameter). Used with turbulentIntensityKineticEnergyInlet for complete turbulence inlet specification.',
      category: 'boundary',
      parameters: [
        { name: 'mixingLength', type: 'scalar', required: true, description: 'Turbulent mixing length (m)' },
        { name: 'k', type: 'word', required: false, description: 'TKE field name (default: k)' },
        { name: 'phi', type: 'word', required: false, description: 'Flux field name' }
      ],
      examples: ['type            turbulentMixingLengthDissipationRateInlet;\nmixingLength    0.005;\nvalue           uniform 14.855;']
    });

    // Wall functions
    this.addKeyword({
      name: 'kqRWallFunction',
      description: 'Wall function for turbulent kinetic energy (k), turbulence stress invariant (q), and Reynolds stress (R) fields. Provides appropriate near-wall treatment for k-ε and Reynolds stress models. Sets k to small non-zero value, enforces realizability for R.',
      category: 'boundary',
      examples: ['type            kqRWallFunction;\nvalue           uniform 0;']
    });

    this.addKeyword({
      name: 'epsilonWallFunction',
      description: 'Wall function for turbulent dissipation rate (ε). Calculates near-wall ε using law-of-the-wall: ε_w = C_μ^(3/4) * k^(3/2) / (κ*y), where y is wall distance. Used with k-ε turbulence models. Ensures proper dissipation in the boundary layer.',
      category: 'boundary',
      parameters: [
        { name: 'Cmu', type: 'scalar', required: false, description: 'Turbulence model constant (default: 0.09)' },
        { name: 'kappa', type: 'scalar', required: false, description: 'von Kármán constant (default: 0.41)' },
        { name: 'E', type: 'scalar', required: false, description: 'Wall function constant (default: 9.8)' }
      ],
      examples: ['type            epsilonWallFunction;\nvalue           uniform 0;']
    });

    this.addKeyword({
      name: 'omegaWallFunction',
      description: 'Wall function for specific dissipation rate (ω = ε/k). Used with k-ω and SST turbulence models. Provides accurate near-wall behavior: ω_w = sqrt(k)/(C_μ^(1/4)*κ*y). More robust than ε near walls, making k-ω suitable for adverse pressure gradients.',
      category: 'boundary',
      parameters: [
        { name: 'beta1', type: 'scalar', required: false, description: 'Model coefficient (default: 0.075)' },
        { name: 'blended', type: 'boolean', required: false, description: 'Use blended wall function' }
      ],
      examples: ['type            omegaWallFunction;\nvalue           uniform 0;']
    });

    this.addKeyword({
      name: 'nutkWallFunction',
      description: 'Wall function for turbulent kinematic viscosity (ν_t). Calculates near-wall turbulent viscosity using law-of-the-wall velocity profile. Ensures smooth transition between viscous sublayer (ν_t ≈ 0) and log layer (ν_t = κ*y*u_τ). Used at all wall boundaries in turbulent flows.',
      category: 'boundary',
      parameters: [
        { name: 'Cmu', type: 'scalar', required: false, description: 'Turbulence constant' },
        { name: 'kappa', type: 'scalar', required: false, description: 'von Kármán constant' },
        { name: 'E', type: 'scalar', required: false, description: 'Wall roughness parameter' }
      ],
      examples: ['type            nutkWallFunction;\nvalue           uniform 0;']
    });

    this.addKeyword({
      name: 'alphatJayatillekeWallFunction',
      description: 'Thermal diffusivity (α_t) wall function using Jayatilleke\'s correlation. Accounts for varying turbulent Prandtl number near walls: α_t = ν_t/Pr_t, where Pr_t varies with y⁺. More accurate than constant Pr_t for heat transfer. Used for conjugate heat transfer and thermal boundary layers.',
      category: 'boundary',
      parameters: [
        { name: 'Prt', type: 'scalar', required: true, description: 'Turbulent Prandtl number (typically 0.85-0.9)' },
        { name: 'Cmu', type: 'scalar', required: false, description: 'Turbulence constant' },
        { name: 'kappa', type: 'scalar', required: false, description: 'von Kármán constant' },
        { name: 'E', type: 'scalar', required: false, description: 'Wall function parameter' }
      ],
      examples: ['type            alphatJayatillekeWallFunction;\nPrt             0.85;\nvalue           uniform 0;']
    });

    this.addKeyword({
      name: 'codedFixedValue',
      description: 'Dynamic boundary condition where values are computed on-the-fly using user-specified C++ code. The code is compiled at runtime. Useful for complex time-varying or spatially-varying boundary conditions that cannot be expressed with standard options.',
      category: 'boundary',
      parameters: [
        { name: 'name', type: 'string', required: true, description: 'Unique identifier for this coded BC' },
        { name: 'code', type: 'string', required: true, description: 'C++ code to compute field values' },
        { name: 'codeInclude', type: 'string', required: false, description: 'Additional #include statements' },
        { name: 'codeOptions', type: 'string', required: false, description: 'Compiler options' }
      ],
      examples: ['type            codedFixedValue;\nvalue           uniform 0;\nname            myBC;\ncode\n#{\n    operator==(vector(sin(this->db().time().value()), 0, 0));\n#};']
    });

    this.addKeyword({
      name: 'externalWallHeatFluxTemperature',
      description: 'Temperature boundary condition for external wall heat transfer. Supports three modes: (1) flux - specified heat flux, (2) power - specified power, (3) coefficient - convective heat transfer with h and T_ambient. Used for conjugate heat transfer and thermal simulations.',
      category: 'boundary',
      parameters: [
        { name: 'mode', type: 'word', required: true, description: 'Heat transfer mode: flux | power | coefficient' },
        { name: 'q', type: 'scalar', required: false, description: 'Heat flux [W/m²] for flux mode' },
        { name: 'Q', type: 'scalar', required: false, description: 'Power [W] for power mode' },
        { name: 'h', type: 'scalar', required: false, description: 'Heat transfer coefficient [W/m²·K] for coefficient mode' },
        { name: 'Ta', type: 'scalar', required: false, description: 'Ambient temperature [K] for coefficient mode' },
        { name: 'kappa', type: 'word', required: false, description: 'Thermal conductivity field name' }
      ],
      examples: [
        'type            externalWallHeatFluxTemperature;\nmode            flux;\nq               uniform 1000;\nvalue           uniform 300;',
        'type            externalWallHeatFluxTemperature;\nmode            coefficient;\nh               uniform 10;\nTa              uniform 300;'
      ]
    });

    this.addKeyword({
      name: 'fan',
      description: 'Cyclic boundary condition modeling a fan with pressure jump. The pressure jump is interpolated from a supplied fan curve (flow rate vs. pressure). Used to simulate fans, pumps, and other rotating machinery without explicitly meshing the fan blades.',
      category: 'boundary',
      parameters: [
        { name: 'file', type: 'string', required: true, description: 'Fan curve data file (flow rate, pressure rise)' },
        { name: 'outOfBounds', type: 'word', required: false, description: 'Extrapolation behavior (clamp/warn/error)' }
      ],
      examples: ['type            fan;\nfile            "fanCurve";\njump            uniform 0;\nvalue           uniform 0;']
    });

    // ============================================================================
    // DISCRETIZATION SCHEMES - Enhanced with CFD Direct documentation
    // ============================================================================

    // Advection/divergence schemes
    this.addKeyword({
      name: 'linear',
      description: 'Second-order central differencing scheme. Linear interpolation between cell centers: ϕ_f = w*ϕ_P + (1-w)*ϕ_N, where w is based on distance. Non-diffusive and accurate but unbounded - can produce oscillations/overshoots. Use with caution for convection-dominated flows.',
      category: 'scheme',
      examples: [
        'div(phi,U)      Gauss linear;',
        'laplacian(nu,U) Gauss linear corrected;',
        'grad(p)         Gauss linear;'
      ]
    });

    this.addKeyword({
      name: 'upwind',
      description: 'First-order upwind scheme. Uses upwind cell value: ϕ_f = ϕ_upwind. Guarantees boundedness but highly diffusive. Suitable for initial simulations or highly convection-dominated flows. Taylor series shows it adds artificial diffusion proportional to u*Δx/2, smearing sharp gradients.',
      category: 'scheme',
      examples: ['div(phi,U)      Gauss upwind;']
    });

    this.addKeyword({
      name: 'linearUpwind',
      description: 'Second-order upwind scheme reducing diffusion of pure upwind. Uses upwind cell gradient: ϕ_f = ϕ_U + ∇ϕ_U·d. More accurate than first-order upwind while maintaining stability. Popular for momentum advection. Naturally includes skewness correction.',
      category: 'scheme',
      parameters: [
        { name: 'gradScheme', type: 'word', required: true, description: 'Gradient scheme for extrapolation' }
      ],
      examples: ['div(phi,U)      Gauss linearUpwind grad(U);']
    });

    this.addKeyword({
      name: 'filteredLinear',
      description: 'Filtered linear central differencing scheme. Applies filtering to linear scheme: ϕ_f = linear + filter*(upwind - linear). Filter coefficient k (0-1) blends between linear (k=0) and upwind (k=1). Reduces oscillations while maintaining second-order accuracy.',
      category: 'scheme',
      parameters: [
        { name: 'coefficient', type: 'scalar', required: true, description: 'Filter coefficient k (0=pure linear, 1=upwind)' }
      ],
      examples: ['div(phi,U)      Gauss filteredLinear 1;']
    });

    this.addKeyword({
      name: 'MUSCL',
      description: 'Monotone Upstream-centered Scheme for Conservation Laws. Third-order TVD (Total Variation Diminishing) scheme with slope limiting. Achieves high accuracy with minimal oscillations. Uses van Albada limiter. Excellent for shock capturing and compressible flows.',
      category: 'scheme',
      examples: ['div(phi,U)      Gauss MUSCL;']
    });

    this.addKeyword({
      name: 'QUICK',
      description: 'Quadratic Upstream Interpolation for Convective Kinematics. Third-order scheme using quadratic interpolation with two upwind and one downwind cell. More accurate than linearUpwind but can produce oscillations. Requires high mesh quality. Popular for structured meshes.',
      category: 'scheme',
      examples: ['div(phi,U)      Gauss QUICK;']
    });

    this.addKeyword({
      name: 'SFCD',
      description: 'Self-Filtered Central Differencing. Applies filtering directly in the convection term to prevent oscillations. More stable than pure linear central differencing. Suitable for LES and unsteady flows where artificial diffusion must be minimized.',
      category: 'scheme',
      examples: ['div(phi,U)      Gauss SFCD;']
    });

    this.addKeyword({
      name: 'SuperBee',
      description: 'SuperBee TVD (Total Variation Diminishing) flux limiter. Very sharp limiter producing minimal diffusion and steep gradients. Can capture discontinuities well but may cause slight overshoots. Used in compressible flow simulations and shock-capturing.',
      category: 'scheme',
      examples: ['div(phi,U)      Gauss SuperBee;']
    });

    this.addKeyword({
      name: 'limitedCubic',
      description: 'Limited cubic interpolation scheme. Uses cubic polynomial with van Leer or Sweby limiting to prevent oscillations. Parameter (0-1) controls limiting severity. Higher order than linear but bounded. Good balance of accuracy and stability.',
      category: 'scheme',
      parameters: [
        { name: 'coefficient', type: 'scalar', required: true, description: 'Limiter coefficient k (typically 1)' }
      ],
      examples: ['div(phi,U)      Gauss limitedCubic 1;']
    });

    this.addKeyword({
      name: 'limitedLinear',
      description: 'Limited linear scheme. Applies limiting to second-order linear interpolation to ensure boundedness. The limiter coefficient (0-2) controls the amount of limiting. k=1 gives standard Van Leer limiter. Prevents over/undershoots while maintaining second-order accuracy.',
      category: 'scheme',
      parameters: [
        { name: 'coefficient', type: 'scalar', required: true, description: 'Limiter coefficient (0-2, typically 1)' }
      ],
      examples: ['div(phi,U)      Gauss limitedLinear 1;']
    });

    this.addKeyword({
      name: 'vanLeer',
      description: 'Van Leer TVD limiter scheme. Classic flux limiter providing smooth limiting without oscillations. Less compressive than SuperBee but more robust. Excellent general-purpose scheme for convection. Works well for scalar transport.',
      category: 'scheme',
      examples: ['div(phi,U)      Gauss vanLeer;']
    });

    this.addKeyword({
      name: 'localBlended',
      description: 'Local cell-by-cell blending between two schemes using a blending factor field. Blending = scheme1*α + scheme2*(1-α), where α varies spatially. Enables adaptive schemes - e.g., upwind in shock regions, linear elsewhere. Requires creating blending factor field.',
      category: 'scheme',
      parameters: [
        { name: 'scheme1', type: 'word', required: true, description: 'First scheme (typically higher order)' },
        { name: 'scheme2', type: 'word', required: true, description: 'Second scheme (typically more stable)' }
      ],
      examples: ['div(phi,U)      Gauss localBlended linear upwind;']
    });

    this.addKeyword({
      name: 'cellCoBlended',
      description: 'Cell Courant number based blending scheme. Automatically blends between two schemes based on local Courant number. High Co regions use stable scheme (upwind), low Co regions use accurate scheme (linear). Improves stability while maintaining accuracy.',
      category: 'scheme',
      parameters: [
        { name: 'scheme1', type: 'word', required: true, description: 'Scheme for low Co (typically linear)' },
        { name: 'scheme2', type: 'word', required: true, description: 'Scheme for high Co (typically upwind)' }
      ],
      examples: ['div(phi,U)      Gauss cellCoBlended linear upwind;']
    });

    // Time schemes
    this.addKeyword({
      name: 'localEuler',
      description: 'Local time-stepping scheme for steady-state acceleration. Each cell advances with local time step based on local CFL: Δt_local = Co*Δx/|u|. Dramatically speeds steady-state convergence by 10-100x. Only for steady flows - not physical time-accurate.',
      category: 'scheme',
      examples: ['ddtSchemes\n{\n    default         localEuler;\n}']
    });

    this.addKeyword({
      name: 'CoEuler',
      description: 'Courant number based automatic time-stepping. Adjusts global time step to maintain specified maximum Courant number. Time step varies to keep Co ≤ Co_max. Useful for unsteady flows with varying velocity scales. Maintains stability while maximizing efficiency.',
      category: 'scheme',
      examples: ['ddtSchemes\n{\n    default         CoEuler;\n}']
    });

    this.addKeyword({
      name: 'pointLinear',
      description: 'Linear interpolation using point (vertex) values rather than cell values. Employs inverse-distance weighting from adjacent cells to vertices, then interpolates to face. Reduces skewness error on tetrahedral and highly skewed meshes. More expensive than standard linear.',
      category: 'scheme',
      examples: ['interpolationSchemes\n{\n    default         pointLinear;\n}']
    });

    this.addKeyword({
      name: 'skewLinear',
      description: 'Linear scheme with skewness correction',
      category: 'scheme',
      examples: ['div(phi,U)      Gauss skewLinear;']
    });

    this.addKeyword({
      name: 'cellCoBlended',
      description: 'Cell Courant number based automatic blending. Evaluates Co in each cell and blends schemes accordingly. More stable than localBlended for transient flows. Commonly: cellCoBlended linear upwind for robust transient simulations.',
      category: 'scheme',
      parameters: [
        { name: 'scheme1', type: 'word', required: true, description: 'Scheme for low Co' },
        { name: 'scheme2', type: 'word', required: true, description: 'Scheme for high Co' }
      ],
      examples: ['div(phi,U)      Gauss cellCoBlended linear upwind;']
    });

    // ============================================================================
    // SOLVER CONTROL - PISO, PIMPLE, SIMPLE algorithms (fvSolution)
    // ============================================================================

    this.addKeyword({
      name: 'PISO',
      description: 'Pressure Implicit with Splitting of Operators algorithm for transient flows. Iterates pressure-velocity coupling within each time step: momentum predictor → pressure solution → velocity correction (repeat nCorrectors times). Suitable for transient incompressible flows with small time steps. More efficient than PIMPLE for time-accurate simulations.',
      category: 'solver',
      parameters: [
        { name: 'nCorrectors', type: 'integer', required: true, description: 'Number of PISO pressure-velocity corrections per time step (typically 2-3)' },
        { name: 'nNonOrthogonalCorrectors', type: 'integer', required: false, description: 'Laplacian corrections for non-orthogonal meshes (0-3)' },
        { name: 'pRefCell', type: 'integer', required: false, description: 'Reference cell for pressure (if no fixedValue BC)' },
        { name: 'pRefValue', type: 'scalar', required: false, description: 'Reference pressure value' }
      ],
      examples: [
        'PISO\n{\n    nCorrectors     2;\n    nNonOrthogonalCorrectors 1;\n}'
      ]
    });

    this.addKeyword({
      name: 'PIMPLE',
      description: 'Combined PISO-SIMPLE algorithm (pressure implicit splitting with semi-implicit method for pressure-linked equations). Outer iterations (nOuterCorrectors) achieve within-time-step convergence like SIMPLE, while inner PISO corrections (nCorrectors) handle pressure-velocity coupling. Enables larger time steps than pure PISO. Set nOuterCorrectors=1 for PISO mode, >1 for iterative convergence.',
      category: 'solver',
      parameters: [
        { name: 'nOuterCorrectors', type: 'integer', required: true, description: 'Outer SIMPLE-like iterations per time step (1=PISO, >1=iterative)' },
        { name: 'nCorrectors', type: 'integer', required: true, description: 'Inner PISO pressure-velocity corrections (typically 1-2)' },
        { name: 'nNonOrthogonalCorrectors', type: 'integer', required: false, description: 'Non-orthogonal mesh corrections (0-2)' },
        { name: 'residualControl', type: 'dictionary', required: false, description: 'Per-field convergence tolerance for outer iterations' },
        { name: 'consistent', type: 'boolean', required: false, description: 'Use consistent PIMPLE formulation (improves stability)' },
        { name: 'momentumPredictor', type: 'boolean', required: false, description: 'Solve momentum predictor (yes for most cases)' },
        { name: 'turbOnFinalIterOnly', type: 'boolean', required: false, description: 'Update turbulence only on final outer iteration' }
      ],
      examples: [
        'PIMPLE\n{\n    nOuterCorrectors 1;  // PISO mode\n    nCorrectors     2;\n    nNonOrthogonalCorrectors 0;\n}',
        'PIMPLE\n{\n    nOuterCorrectors 50;  // Iterative mode\n    nCorrectors     1;\n    residualControl\n    {\n        p               1e-4;\n        U               1e-4;\n    }\n}'
      ]
    });

    this.addKeyword({
      name: 'SIMPLE',
      description: 'Semi-Implicit Method for Pressure-Linked Equations. Iterative steady-state algorithm: solve momentum → solve pressure → correct velocity → repeat until convergence. Requires under-relaxation for stability. Standard algorithm for steady incompressible flows. More robust than PISO for steady-state.',
      category: 'solver',
      parameters: [
        { name: 'nNonOrthogonalCorrectors', type: 'integer', required: false, description: 'Non-orthogonal corrections (0-2)' },
        { name: 'consistent', type: 'boolean', required: false, description: 'Consistent SIMPLE formulation (SIMPLEC)' },
        { name: 'residualControl', type: 'dictionary', required: false, description: 'Convergence criteria per field' }
      ],
      examples: [
        'SIMPLE\n{\n    nNonOrthogonalCorrectors 0;\n    consistent      yes;  // SIMPLEC\n    residualControl\n    {\n        p               1e-4;\n        U               1e-4;\n    }\n}'
      ]
    });

    this.addKeyword({
      name: 'residualControl',
      description: 'Convergence criteria for iterative solvers (SIMPLE/PIMPLE outer loops). When all field residuals drop below specified tolerances, outer iterations stop. Prevents unnecessary iterations and ensures solution quality. Supports regex patterns for multiple fields.',
      category: 'solver',
      parameters: [
        { name: 'fieldName', type: 'scalar', required: true, description: 'Tolerance for field (e.g., p 1e-4)' }
      ],
      examples: [
        'residualControl\n{\n    p               1e-4;\n    U               1e-4;\n    "(k|epsilon|omega)" 1e-4;\n}'
      ]
    });

    this.addKeyword({
      name: 'relaxationFactors',
      description: 'Under-relaxation factors for stabilizing SIMPLE algorithm. Fields are updated: ϕ_new = α*ϕ_computed + (1-α)*ϕ_old, where α ∈ (0,1]. Lower values (0.3-0.7) improve stability but slow convergence. Equations relaxation applies to matrix coefficients. Essential for steady-state SIMPLE solvers.',
      category: 'solver',
      parameters: [
        { name: 'fields', type: 'dictionary', required: false, description: 'Field relaxation factors' },
        { name: 'equations', type: 'dictionary', required: false, description: 'Equation relaxation factors' }
      ],
      examples: [
        'relaxationFactors\n{\n    fields\n    {\n        p               0.3;  // Pressure typically 0.3\n    }\n    equations\n    {\n        U               0.7;  // Momentum typically 0.7\n        k               0.7;\n        epsilon         0.7;\n    }\n}'
      ]
    });

    this.addKeyword({
      name: 'consistent',
      description: 'Enable consistent formulation (SIMPLEC for SIMPLE, consistent PIMPLE). Modifies pressure equation to improve coupling with momentum. Allows higher relaxation factors and faster convergence. Recommended for most SIMPLE simulations. Set to "yes" or "true".',
      category: 'solver',
      parameters: [
        { name: 'value', type: 'boolean', required: true, description: 'yes/no or true/false' }
      ],
      examples: [
        'SIMPLE\n{\n    consistent      yes;\n}',
        'PIMPLE\n{\n    consistent      yes;\n}'
      ]
    });

    this.addKeyword({
      name: 'nCorrectors',
      description: 'Number of PISO pressure-velocity corrector iterations per outer loop. Each corrector solves pressure equation and updates velocity. Higher values improve accuracy but increase cost. Typically 2-3 for PISO, 1-2 for PIMPLE. Must be ≥1.',
      category: 'solver',
      parameters: [
        { name: 'value', type: 'integer', required: true, description: 'Number of correctors (typically 1-3)' }
      ],
      examples: ['nCorrectors     2;']
    });

    this.addKeyword({
      name: 'nNonOrthogonalCorrectors',
      description: 'Number of non-orthogonal mesh corrections for Laplacian terms. Each correction improves accuracy on skewed/non-orthogonal meshes. 0 = no correction (orthogonal mesh), 1-2 typical for moderately non-orthogonal, 3+ for highly skewed. Increases cost but improves solution on poor meshes.',
      category: 'solver',
      parameters: [
        { name: 'value', type: 'integer', required: true, description: 'Number of corrections (0-3, typically 0-1)' }
      ],
      examples: ['nNonOrthogonalCorrectors 0;']
    });

    this.addKeyword({
      name: 'nOuterCorrectors',
      description: 'Number of outer corrector loops in PIMPLE algorithm. Controls how many times pressure-velocity system is iterated within each time step. 1 = PISO behavior (no outer iterations), >1 = iterative convergence like SIMPLE. Higher values allow larger time steps but increase computational cost.',
      category: 'solver',
      parameters: [
        { name: 'value', type: 'integer', required: true, description: 'Outer loops: 1 for PISO mode, 10-50 for iterative convergence' }
      ],
      examples: ['nOuterCorrectors 1;  // PISO mode', 'nOuterCorrectors 50;  // Iterative mode']
    });

    this.addKeyword({
      name: 'momentumPredictor',
      description: 'Enable momentum predictor step in PISO/PIMPLE. When yes, solves momentum equation before pressure correction. Improves stability and convergence for most flows. Set to no only for very simple/low-Re flows or debugging.',
      category: 'solver',
      parameters: [
        { name: 'value', type: 'boolean', required: true, description: 'yes (default, recommended) or no' }
      ],
      examples: ['momentumPredictor yes;']
    });

    this.addKeyword({
      name: 'turbOnFinalIterOnly',
      description: 'Solve turbulence equations only on final outer corrector iteration. Reduces computational cost by skipping turbulence updates in intermediate iterations. Useful when turbulence changes slowly. May impact convergence for strongly coupled turbulent flows.',
      category: 'solver',
      parameters: [
        { name: 'value', type: 'boolean', required: true, description: 'yes (faster) or no (more coupled)' }
      ],
      examples: ['turbOnFinalIterOnly yes;']
    });

    // ============================================================================
    // PHYSICAL PROPERTIES - Transport and thermophysical properties
    // ============================================================================

    this.addKeyword({
      name: 'nu',
      description: 'Kinematic viscosity (ν = μ/ρ) for incompressible flows. Dimensions [m²/s]. Viscosity of water ≈ 1e-6, air ≈ 1.5e-5 at 20°C. Higher values increase viscous dissipation and damping. Key parameter affecting Reynolds number Re = UL/ν.',
      category: 'property',
      parameters: [
        { name: 'value', type: 'scalar', required: true, description: 'Kinematic viscosity [m²/s]' },
        { name: 'dimensions', type: 'dimensionSet', required: false, description: '[0 2 -1 0 0 0 0]' }
      ],
      examples: [
        'nu              [0 2 -1 0 0 0 0] 1e-05;  // Air',
        'nu              [0 2 -1 0 0 0 0] 1e-06;  // Water'
      ]
    });

    this.addKeyword({
      name: 'Pr',
      description: 'Molecular Prandtl number (Pr = ν/α = momentum diffusivity / thermal diffusivity). Dimensionless ratio characterizing relative importance of momentum and heat transport. Air ≈ 0.7, water ≈ 7. Affects thermal boundary layer thickness relative to velocity boundary layer.',
      category: 'property',
      parameters: [
        { name: 'value', type: 'scalar', required: true, description: 'Prandtl number (dimensionless)' }
      ],
      examples: ['Pr              0.7;']
    });

    this.addKeyword({
      name: 'Prt',
      description: 'Turbulent Prandtl number',
      category: 'property',
      parameters: [
        { name: 'value', type: 'scalar', required: true, description: 'Turbulent Prandtl number' }
      ],
      examples: ['Prt             0.85;']
    });

    this.addKeyword({
      name: 'transportModel',
      description: 'Transport/viscosity model selection',
      category: 'property',
      parameters: [
        { name: 'model', type: 'string', required: true, description: 'Newtonian, BirdCarreau, CrossPowerLaw, etc.' }
      ],
      examples: ['transportModel  Newtonian;', 'transportModel  BirdCarreau;']
    });

    this.addKeyword({
      name: 'simulationType',
      description: 'Turbulence simulation type',
      category: 'property',
      parameters: [
        { name: 'type', type: 'string', required: true, description: 'laminar, RAS, or LES' }
      ],
      examples: ['simulationType  RAS;', 'simulationType  laminar;', 'simulationType  LES;']
    });

    this.addKeyword({
      name: 'RAS',
      description: 'Reynolds-Averaged Simulation model settings',
      category: 'property',
      parameters: [
        { name: 'model', type: 'string', required: true, description: 'kEpsilon, kOmegaSST, etc.' },
        { name: 'turbulence', type: 'boolean', required: true, description: 'on or off' }
      ],
      examples: ['RAS\n{\n    model           kEpsilon;\n    turbulence      on;\n    printCoeffs     on;\n}']
    });

    this.addKeyword({
      name: 'LES',
      description: 'Large Eddy Simulation model settings',
      category: 'property',
      parameters: [
        { name: 'model', type: 'string', required: true, description: 'Smagorinsky, kEqn, etc.' }
      ],
      examples: ['LES\n{\n    model           Smagorinsky;\n    turbulence      on;\n    printCoeffs     on;\n}']
    });

    this.addKeyword({
      name: 'printCoeffs',
      description: 'Print model coefficients to terminal',
      category: 'property',
      parameters: [
        { name: 'value', type: 'boolean', required: true, description: 'on or off' }
      ],
      examples: ['printCoeffs     on;']
    });

    console.log(`Added ${this.keywords.size} essential keywords`);
  }

  /**
   * Extract keywords from a directory recursively
   */
  private async extractFromDirectory(dirPath: string): Promise<void> {
    if (!fs.existsSync(dirPath)) {
      console.log(`Directory not found: ${dirPath}`);
      return;
    }

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        // Skip certain directories
        if (!['lnInclude', 'Make', 'wmake'].includes(entry.name)) {
          await this.extractFromDirectory(fullPath);
        }
      } else if (entry.isFile()) {
        // Process C++ header and source files
        if (entry.name.endsWith('.H') || entry.name.endsWith('.C')) {
          await this.extractFromCppFile(fullPath);
        }
        // Process OpenFOAM dictionary files
        else if (this.isOpenFOAMDict(entry.name)) {
          await this.extractFromDictFile(fullPath);
        }
      }
    }
  }

  /**
   * Check if file is an OpenFOAM dictionary
   */
  private isOpenFOAMDict(filename: string): boolean {
    const dictFiles = [
      'controlDict', 'fvSchemes', 'fvSolution', 'blockMeshDict',
      'snappyHexMeshDict', 'decomposeParDict', 'surfaceFeatureExtractDict'
    ];
    return dictFiles.includes(filename) || filename.endsWith('Properties') || filename.endsWith('Dict');
  }

  /**
   * Extract keywords from C++ source file
   * 
   * TODO: Replace regex-based extraction with proper C++ AST parsing
   * TODO: Handle nested class definitions and namespaces better
   */
  private async extractFromCppFile(filePath: string): Promise<void> {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const relativePath = path.relative(this.sourceRoot, filePath);

      // Extract lookup/lookupOrDefault patterns (common in OpenFOAM for reading dict keys)
      const lookupPattern = /(?:dict|subDict)\.lookup(?:OrDefault)?<[^>]+>\s*\(\s*"([^"]+)"/g;
      let match;

      while ((match = lookupPattern.exec(content)) !== null) {
        const keywordName = match[1];
        
        // Try to find associated documentation
        const lineNum = content.substring(0, match.index).split('\n').length;
        const description = this.extractDocNearLine(content, lineNum);

        if (!this.keywords.has(keywordName)) {
          this.addKeyword({
            name: keywordName,
            description: description || `OpenFOAM dictionary keyword (found in source)`,
            category: this.categorizeKeyword(keywordName),
            sourceFile: relativePath
          });
        }
      }

      // Extract dictionary key strings from IOdictionary and dict access
      const keyPattern = /"([a-zA-Z][a-zA-Z0-9_]*)"\s*,/g;
      while ((match = keyPattern.exec(content)) !== null) {
        const keywordName = match[1];
        
        if (keywordName.length > 2 && !this.keywords.has(keywordName)) {
          const lineNum = content.substring(0, match.index).split('\n').length;
          const description = this.extractDocNearLine(content, lineNum);

          this.addKeyword({
            name: keywordName,
            description: description || `Dictionary keyword from ${path.basename(filePath)}`,
            category: this.categorizeKeyword(keywordName),
            sourceFile: relativePath
          });
        }
      }

    } catch (error) {
      // Silently skip files that can't be read
    }
  }

  /**
   * Extract documentation from comments near a specific line
   */
  private extractDocNearLine(content: string, lineNum: number): string {
    const lines = content.split('\n');
    const searchStart = Math.max(0, lineNum - 10);
    const searchEnd = Math.min(lines.length, lineNum);

    // Look backwards for documentation comments
    for (let i = searchEnd - 1; i >= searchStart; i--) {
      const line = lines[i].trim();
      
      // Doxygen-style comments
      if (line.startsWith('//!') || line.startsWith('///')) {
        return line.replace(/^\/\/[!/]\s*/, '').trim();
      }
      
      // Block comments
      if (line.includes('*/')) {
        let docBlock = '';
        for (let j = i; j >= searchStart; j--) {
          const blockLine = lines[j].trim();
          docBlock = blockLine + ' ' + docBlock;
          if (blockLine.includes('/*')) {
            return docBlock
              .replace(/\/\*+|\*+\//g, '')
              .replace(/^\s*\*\s*/gm, '')
              .trim();
          }
        }
      }
      
      // Stop at non-comment lines
      if (line && !line.startsWith('//') && !line.startsWith('*')) {
        break;
      }
    }

    return '';
  }

  /**
   * Extract keywords from OpenFOAM dictionary file
   */
  private async extractFromDictFile(filePath: string): Promise<void> {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const relativePath = path.relative(this.sourceRoot, filePath);

      // Extract top-level keywords (word followed by value or {)
      const keyPattern = /^(\s*)([a-zA-Z][a-zA-Z0-9_]*)\s+(?:[^;{}\n]+[;]|{)/gm;
      let match;

      while ((match = keyPattern.exec(content)) !== null) {
        const keywordName = match[2];
        
        if (!this.keywords.has(keywordName)) {
          this.addKeyword({
            name: keywordName,
            description: `Keyword from ${path.basename(filePath)}`,
            category: this.categorizeKeyword(keywordName),
            sourceFile: relativePath
          });
        }
      }
    } catch (error) {
      // Silently skip files that can't be read
    }
  }

  /**
   * Categorize a keyword based on its name
   */
  private categorizeKeyword(name: string): KeywordInfo['category'] {
    const lower = name.toLowerCase();
    
    if (lower.includes('time') || lower.includes('write') || lower.includes('read') || 
        ['application', 'startfrom', 'stopat', 'purgewrite'].includes(lower)) {
      return 'control';
    }
    
    if (lower.includes('solver') || lower.includes('tolerance') || lower.includes('relax') ||
        lower.includes('preconditioner') || lower.includes('smoother')) {
      return 'solver';
    }
    
    if (lower.includes('scheme') || lower.includes('ddt') || lower.includes('grad') ||
        lower.includes('div') || lower.includes('laplacian') || lower.includes('interpolation')) {
      return 'scheme';
    }
    
    if (lower.includes('bound') || lower === 'type' || lower === 'value' ||
        lower.includes('inlet') || lower.includes('outlet') || lower.includes('wall')) {
      return 'boundary';
    }
    
    if (lower.includes('function') || lower === 'libs' || lower.includes('output')) {
      return 'function';
    }
    
    if (lower.includes('dimension') || lower.includes('uniform') || lower.includes('internal')) {
      return 'property';
    }
    
    if (lower.includes('mesh') || lower.includes('decompose') || lower.includes('refine')) {
      return 'utility';
    }
    
    return 'other';
  }

  /**
   * Add a keyword to the database
   */
  private addKeyword(keyword: KeywordInfo): void {
    if (!this.keywords.has(keyword.name)) {
      this.keywords.set(keyword.name, keyword);
    }
  }

  /**
   * Save keywords to JSON file
   */
  saveToFile(outputPath: string): void {
    const keywordArray = Array.from(this.keywords.values()).sort((a, b) => 
      a.name.localeCompare(b.name)
    );

    const output = {
      version: '1.0.0',
      generatedAt: new Date().toISOString(),
      sourceRoot: this.sourceRoot,
      keywordCount: keywordArray.length,
      keywords: keywordArray
    };

    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(`Saved ${keywordArray.length} keywords to ${outputPath}`);
  }
}

// Main execution
async function main() {
  const sourceRoot = process.argv[2] || path.join(__dirname, '..', '..');
  const outputPath = process.argv[3] || path.join(__dirname, '..', 'data', 'openfoam-keywords.json');

  console.log('OpenFOAM Keyword Extractor');
  console.log('==========================');
  console.log(`Source root: ${sourceRoot}`);
  console.log(`Output file: ${outputPath}`);
  console.log('');

  const extractor = new KeywordExtractor(sourceRoot);
  await extractor.extract();
  
  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  extractor.saveToFile(outputPath);
  
  console.log('');
  console.log('Extraction complete!');
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { KeywordExtractor, KeywordInfo, ParameterInfo };
