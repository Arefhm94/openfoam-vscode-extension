# OpenFOAM Solver Information Scraping

This extension can fetch solver information from the OpenFOAM C++ documentation website (https://cpp.openfoam.org/) and integrate it into the IntelliSense system.

## Overview

The solver scraper extracts:
- **Solver names** (e.g., simpleFoam, interFoam, rhoPimpleFoam)
- **Descriptions** from the documentation
- **Purpose** and application areas
- **URLs** to the full documentation

This information is then available in:
- ✅ **Autocomplete** when typing solver names
- ✅ **Hover tooltips** showing solver descriptions
- ✅ **Code snippets** for `application` keyword in controlDict

## Usage

### 1. Scrape Solver Information

Fetch solver data from the OpenFOAM documentation website:

```bash
npm run scrape-solvers
```

Or for a specific OpenFOAM version:

```bash
npm run scrape-solvers 13  # OpenFOAM v13
npm run scrape-solvers 12  # OpenFOAM v12
```

This creates: `data/openfoam-solvers.json`

### 2. Update the Keyword Database

Merge the scraped solver information into the main keyword database:

```bash
npm run extract-keywords
```

Or do both steps at once:

```bash
npm run update-database
```

This updates: `data/openfoam-keywords.json`

### 3. Rebuild and Test

Compile the extension:

```bash
npm run compile
```

Then press F5 in VS Code to launch the extension development host and test the new solver IntelliSense.

## How It Works

### 1. Web Scraping (`src/extractor/solverScraper.ts`)

The scraper:
- Fetches the solver directory page from cpp.openfoam.org
- Parses HTML to find solver module links
- Extracts descriptions and documentation
- Falls back to hardcoded solver list if web scraping fails

### 2. Database Integration (`src/extractor/extractKeywords.ts`)

The keyword extractor:
- Reads the scraped solver data from `openfoam-solvers.json`
- Converts solver information to keyword format
- Merges with existing keywords from source code
- Saves the combined database to `openfoam-keywords.json`

### 3. Language Server (`src/language-server/server.ts`)

The language server:
- Loads the keyword database on startup
- Provides hover information for solver names
- Offers autocomplete suggestions
- Shows solver descriptions and usage examples

## Example: IntelliSense for Solvers

When you type in a `controlDict` file:

```foam
application     sim<CTRL+SPACE>
```

You'll see autocomplete suggestions:
- `simpleFoam` - Steady-state solver for incompressible, turbulent flows
- `pimpleFoam` - Transient solver for incompressible flow
- `interFoam` - Two-phase VOF solver
- ... and 40+ more solvers

Hover over a solver name to see:
- Full description
- Purpose
- Application areas
- Link to documentation

## Supported OpenFOAM Versions

The scraper supports:
- OpenFOAM 13 (current) ✅
- OpenFOAM 12 ✅
- OpenFOAM 11 ✅
- OpenFOAM 10 ✅
- OpenFOAM 9 ✅
- Earlier versions (with URL adjustment)

## Fallback Mode

If web scraping fails (network issues, website changes), the scraper automatically uses a comprehensive hardcoded list of 40+ standard OpenFOAM solvers including:

### Incompressible Flow
- `simpleFoam`, `pimpleFoam`, `pisoFoam`, `icoFoam`
- `SRFSimpleFoam`, `MRFSimpleFoam`, `pimpleDyMFoam`

### Multiphase Flow
- `interFoam`, `interIsoFoam`, `multiphaseInterFoam`
- `twoPhaseEulerFoam`, `multiphaseEulerFoam`, `driftFluxFoam`

### Compressible Flow
- `rhoPimpleFoam`, `rhoSimpleFoam`, `sonicFoam`, `rhoCentralFoam`

### Combustion
- `reactingFoam`, `sprayFoam`, `coalChemistryFoam`
- `coldEngineFoam`, `engineFoam`, `XiFoam`, `PDRFoam`

### Heat Transfer
- `buoyantSimpleFoam`, `buoyantPimpleFoam`
- `chtMultiRegionFoam`, `thermoFoam`

### Lagrangian Particles
- `DPMFoam`, `MPPICFoam`, `reactingParcelFoam`

### Specialized
- `potentialFoam`, `laplacianFoam`, `scalarTransportFoam`
- `solidDisplacementFoam`, `cavitatingFoam`, `dsmcFoam`
- `overPimpleDyMFoam`, `overInterDyMFoam`, `shallowWaterFoam`

## Troubleshooting

### Web Scraping Fails
If you see errors during scraping:
1. Check your internet connection
2. Verify the OpenFOAM documentation site is accessible
3. The scraper will automatically use the fallback solver list

### Solvers Not Showing in IntelliSense
1. Ensure you ran `npm run update-database`
2. Check that `data/openfoam-keywords.json` exists
3. Rebuild with `npm run compile`
4. Restart the extension development host (F5)

### Missing Solvers
The current implementation includes 40+ common solvers. To add custom solvers:
1. Manually edit `data/openfoam-solvers.json`
2. Run `npm run extract-keywords` to merge
3. Or add them directly to `src/extractor/extractKeywords.ts` in the `addEssentialKeywords()` method

## Future Enhancements

Potential improvements:
- 🔄 Automatic periodic updates from documentation
- 📊 Solver compatibility checking (OpenFOAM version)
- 🔗 Deep links to specific solver documentation pages
- 🎯 Solver parameter extraction (solver-specific options)
- 📝 Tutorial case detection for each solver
- 🏷️ Solver categorization and filtering

## Contributing

To improve solver scraping:
1. Update the HTML parsing logic in `solverScraper.ts`
2. Add more solver metadata fields
3. Improve description extraction
4. Add unit tests for scraping logic

## API Reference

### SolverScraper Class

```typescript
class SolverScraper {
  constructor(version: string)
  async scrapeSolvers(): Promise<Map<string, SolverInfo>>
  async saveSolvers(outputPath: string): Promise<void>
}
```

### SolverInfo Interface

```typescript
interface SolverInfo {
  name: string;          // Solver name (e.g., "simpleFoam")
  description: string;   // Brief description
  category: 'solver';    // Always 'solver'
  url: string;          // Documentation URL
  version: string;      // OpenFOAM version
  purpose?: string;     // Application purpose
  equations?: string[]; // Governing equations (future)
  applications?: string[]; // Application areas
}
```

## License

Same as the parent extension (see LICENSE file).
