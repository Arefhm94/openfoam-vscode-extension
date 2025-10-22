# Solver IntelliSense Examples

## What You'll See in VS Code

### 1. Autocomplete Suggestions

When typing in a `controlDict` file:

```openfoam
FoamFile
{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      controlDict;
}

application     inter█  // Press Ctrl+Space here
```

**IntelliSense popup will show:**
```
┌─────────────────────────────────────────────────────────┐
│ interFoam                                          [⚙]  │
│   Solver for two incompressible, isothermal           │
│   immiscible fluids using VOF                          │
│                                                         │
│ interIsoFoam                                      [⚙]  │
│   Solver for two incompressible fluids using          │
│   isoAdvector phase-fraction method                    │
│                                                         │
│ interPhaseChangeFoam                              [⚙]  │
│   Solver for two incompressible fluids with           │
│   phase change (evaporation/condensation)              │
└─────────────────────────────────────────────────────────┘
```

### 2. Hover Tooltips

When hovering over a solver name:

```openfoam
application     interFoam;
                ^^^^^^^^^ [Hover here]
```

**Hover tooltip shows:**
```
╔═══════════════════════════════════════════════════════╗
║ interFoam (solver)                                    ║
╠═══════════════════════════════════════════════════════╣
║ Solver for two incompressible, isothermal            ║
║ immiscible fluids using a VOF phase-fraction method   ║
║                                                       ║
║ Purpose: Two-phase free surface flow                 ║
║                                                       ║
║ Example:                                             ║
║ ```openfoam                                          ║
║ application     interFoam;                           ║
║                                                      ║
║ // Applications: Sloshing, Wave breaking,           ║
║ // Dam break, Filling processes                     ║
║ ```                                                  ║
║                                                      ║
║ Source: OpenFOAM C++ Documentation                  ║
╚═══════════════════════════════════════════════════════╝
```

### 3. Complete Solver List in Autocomplete

All 49 solvers available:

#### Flow Type Categories

**Incompressible Flow:**
- `simpleFoam` - Steady-state SIMPLE
- `pimpleFoam` - Transient PIMPLE
- `pisoFoam` - Transient PISO (DNS/LES)
- `icoFoam` - Laminar flow
- `nonNewtonianIcoFoam` - Non-Newtonian
- `SRFSimpleFoam` - Single rotating frame (steady)
- `SRFPimpleFoam` - Single rotating frame (transient)
- `MRFSimpleFoam` - Multiple reference frames (steady)
- `MRFPimpleFoam` - Multiple reference frames (transient)
- `pimpleDyMFoam` - Dynamic mesh

**Multiphase:**
- `interFoam` - Two-phase VOF
- `interIsoFoam` - Sharp interface
- `multiphaseInterFoam` - Multi-phase
- `compressibleInterFoam` - Compressible two-phase
- `twoPhaseEulerFoam` - Eulerian
- `multiphaseEulerFoam` - Multi-phase Eulerian
- `driftFluxFoam` - Drift-flux
- `interPhaseChangeFoam` - Phase change

**Compressible:**
- `rhoPimpleFoam` - Transient
- `rhoSimpleFoam` - Steady-state
- `sonicFoam` - Supersonic
- `rhoCentralFoam` - High-speed

**Heat Transfer:**
- `buoyantSimpleFoam` - Steady buoyancy
- `buoyantPimpleFoam` - Transient buoyancy
- `chtMultiRegionFoam` - Conjugate heat transfer
- `thermoFoam` - Pure thermal

**Combustion:**
- `reactingFoam` - General combustion
- `coldEngineFoam` - IC engine cold
- `engineFoam` - IC engine combustion
- `sprayFoam` - Spray combustion
- `coalChemistryFoam` - Coal
- `XiFoam` - Premixed
- `PDRFoam` - Explosions

**Particles:**
- `DPMFoam` - Discrete particle
- `MPPICFoam` - Dense particles
- `reactingParcelFoam` - Reacting particles

**Specialized:**
- `potentialFoam` - Potential flow
- `laplacianFoam` - Laplace equation
- `scalarTransportFoam` - Passive scalar
- `dnsFoam` - DNS
- `shallowWaterFoam` - Shallow water
- `electrostaticFoam` - Electrostatics
- `magneticFoam` - Electromagnetics
- `solidDisplacementFoam` - Solid mechanics
- `solidEquilibriumDisplacementFoam` - Equilibrium structural
- `overPimpleDyMFoam` - Overset
- `overInterDyMFoam` - Overset two-phase
- `cavitatingFoam` - Cavitation
- `dsmcFoam` - Rarefied gas

## Usage Scenarios

### Scenario 1: Starting a New Case
```openfoam
// User creates a new controlDict
application     █
// Types 'sim' and gets: simpleFoam, rhoSimpleFoam, buoyantSimpleFoam
```

### Scenario 2: Learning About Solvers
```openfoam
// User hovers over unknown solver
application     coalChemistryFoam;
                ^^^^^^^^^^^^^^^^^ [Shows: "Coal combustion with solid particles"]
```

### Scenario 3: Finding the Right Solver
```openfoam
// User needs two-phase flow solver
application     inter█
// Shows: interFoam, interIsoFoam, interPhaseChangeFoam, compressibleInterFoam
// Each with clear description of differences
```

## IntelliSense Features

### ✅ Available Features
- **Autocomplete**: Type-ahead suggestions with filtering
- **Hover Information**: Detailed descriptions on hover
- **Examples**: Code snippets showing usage
- **Categories**: Solvers grouped by type (via description)
- **Applications**: Real-world use cases listed
- **Purpose**: Clear statement of what each solver does

### 🎯 Smart Filtering
- Type `application comp` → Shows all compressible solvers
- Type `application multi` → Shows multiphase solvers
- Type `application Foam` → Shows all solvers (most end in Foam)

### 📚 Rich Information
Each solver entry provides:
1. **Name**: Official solver executable name
2. **Description**: What the solver does
3. **Purpose**: Primary use case
4. **Applications**: Real-world examples
5. **Category**: Marked as 'solver' for filtering
6. **Source**: Links back to documentation

## Comparison with Manual Documentation

### Before (Manual Lookup):
1. Open browser
2. Navigate to cpp.openfoam.org
3. Search for solver
4. Read documentation
5. Return to VS Code
6. Type solver name

### After (With IntelliSense):
1. Type first few letters
2. See suggestions immediately
3. Select solver
4. Done! ✨

**Time saved**: ~2-5 minutes per lookup

## JSON Structure Example

```json
{
  "name": "simpleFoam",
  "description": "Steady-state solver for incompressible, turbulent flows using the SIMPLE algorithm\n\nPurpose: Steady-state incompressible turbulent flow",
  "category": "solver",
  "sourceFile": "OpenFOAM C++ Documentation",
  "examples": [
    "application     simpleFoam;\n\n// Applications: External aerodynamics, HVAC, Industrial flows"
  ]
}
```

## Benefits Summary

| Feature | Benefit |
|---------|---------|
| **49 Solvers** | Comprehensive coverage of OpenFOAM |
| **Rich Descriptions** | Understand solver purpose instantly |
| **Application Examples** | Know when to use each solver |
| **Fast Lookup** | No context switching |
| **Versioned** | Matches your OpenFOAM version |
| **Offline** | Works without internet |
| **Integrated** | Part of existing IntelliSense |

## Try It Now!

1. Open or create `system/controlDict`
2. Type: `application     `
3. Press `Ctrl+Space`
4. Browse through the 49 available solvers!

Happy coding! 🚀
