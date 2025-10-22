# Atmospheric Boundary Layer Support

This extension provides comprehensive support for OpenFOAM atmospheric boundary layer (ABL) boundary conditions with syntax highlighting and rich IntelliSense.

## Supported Boundary Conditions

### 1. `atmBoundaryLayerInletVelocity`

Log-law velocity profile for atmospheric flows.

**Formula:** `U = (u*/κ) * ln((z-d+z0)/z0)`

**Parameters:**

- `flowDir` - Flow direction vector (e.g., `(1 0 0)` for wind from west)
- `zDir` - Ground-normal direction (e.g., `(0 0 1)` for z-up)
- `Uref` - Reference wind speed at reference height [m/s]
- `Zref` - Reference height [m]
- `z0` - Aerodynamic roughness length [m]
  - 0.0002 = smooth surfaces (sea, sand)
  - 0.03 = grassland
  - 0.1 = crops
  - 0.5 = forest
  - 1.0 = urban areas
- `d` - Displacement height [m] (relevant for forests/cities)
- `kappa` - von Kármán constant (default: 0.41)
- `Cmu` - Turbulence model constant (default: 0.09)
- `initABL` - Initialize with theoretical profile (default: true)

**Example:**

```openfoam
inlet
{
    type            atmBoundaryLayerInletVelocity;
    flowDir         (1 0 0);
    zDir            (0 0 1);
    Uref            10.0;
    Zref            20.0;
    z0              uniform 0.1;
    d               uniform 0.0;
}
```

### 2. `atmBoundaryLayerInletK`

Turbulent kinetic energy profile for atmospheric flows.

**Formula:** `k = (u*²/√Cμ) * √(C1*ln((z-d+z0)/z0) + C2)`

**Additional Parameters:**

- `C1` - Curve-fitting coefficient for YGCJ profiles (default: 0.0)
- `C2` - Curve-fitting coefficient for YGCJ profiles (default: 1.0)

**Note:** C1=0.0 and C2=1.0 gives Richards-Hoxey expressions

**Example:**

```openfoam
inlet
{
    type            atmBoundaryLayerInletK;
    flowDir         (1 0 0);
    zDir            (0 0 1);
    Uref            10.0;
    Zref            20.0;
    z0              uniform 0.1;
    d               uniform 0.0;
    C1              0.0;
    C2              1.0;
}
```

### 3. `atmBoundaryLayerInletEpsilon`

Turbulent dissipation rate profile for k-ε turbulence models.

**Formula:** `ε = (u*³)/(κ(z-d+z0)) * √(C1*ln((z-d+z0)/z0) + C2)`

**Example:**

```openfoam
inlet
{
    type            atmBoundaryLayerInletEpsilon;
    flowDir         (1 0 0);
    zDir            (0 0 1);
    Uref            10.0;
    Zref            20.0;
    z0              uniform 0.1;
    d               uniform 0.0;
}
```

### 4. `atmBoundaryLayerInletOmega`

Specific dissipation rate profile for k-ω SST turbulence models.

**Formula:** `ω = u*/(κ√Cμ(z-d+z0))`

**Example:**

```openfoam
inlet
{
    type            atmBoundaryLayerInletOmega;
    flowDir         (1 0 0);
    zDir            (0 0 1);
    Uref            10.0;
    Zref            20.0;
    z0              uniform 0.1;
    d               uniform 0.0;
}
```

## Features

### ✅ Syntax Highlighting

All atmospheric boundary condition types and their parameters are highlighted:

- Boundary condition types in keyword color
- Parameter names (`flowDir`, `zDir`, `Uref`, etc.) highlighted
- Comments explaining each parameter

### ✅ Hover Documentation

Hover over any atmospheric BC keyword to see:

- Detailed description of the boundary condition
- Formula and physics behind the model
- Complete list of parameters with types and descriptions
- Example usage

### ✅ IntelliSense Completion

Auto-completion for:

- Boundary condition types
- All parameter names
- Parameter values with proper formatting

## Example Files

See the `examples/` directory for complete examples:

- `U_atmosphere` - Velocity with atmBoundaryLayerInletVelocity
- `k_atmosphere` - TKE with atmBoundaryLayerInletK
- `epsilon_atmosphere` - Dissipation with atmBoundaryLayerInletEpsilon

## References

Based on OpenFOAM's atmospheric modeling framework:

- Richards, P. J., & Hoxey, R. P. (1993). Appropriate boundary conditions for computational wind engineering models using the k-ε turbulence model.
- Yang, Y., Gu, M., Chen, S., & Jin, X. (2009). New inflow boundary conditions for modelling the neutral equilibrium atmospheric boundary layer in computational wind engineering.

## Usage Tips

1. **Choose appropriate z0**: The roughness length significantly affects the velocity profile. Use reference tables for your terrain type.

2. **Displacement height**: Set `d` to non-zero values only for urban canopies or dense forests where flow is displaced upward.

3. **Reference height**: `Zref` should be at a height where measurements are available, typically 10-20m for wind data.

4. **Turbulence model**: Use `atmBoundaryLayerInletEpsilon` for k-ε models and `atmBoundaryLayerInletOmega` for k-ω SST models.

5. **Wall functions**: Always use appropriate wall functions on the ground boundary:
   - `kqRWallFunction` for k
   - `epsilonWallFunction` for epsilon
   - `omegaWallFunction` for omega
