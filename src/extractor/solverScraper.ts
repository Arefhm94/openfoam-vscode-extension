import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Solver information scraper for OpenFOAM C++ documentation website
 * 
 * Fetches solver names and descriptions from https://cpp.openfoam.org/
 * for integration into the keyword database and IntelliSense.
 */

interface SolverInfo {
  name: string;
  description: string;
  category: 'solver';
  url: string;
  version: string;
  purpose?: string;
  equations?: string[];
  applications?: string[];
}

export class SolverScraper {
  private version: string;
  private baseUrl: string;
  private solvers: Map<string, SolverInfo> = new Map();

  constructor(version: string = '13') {
    this.version = version;
    this.baseUrl = `https://cpp.openfoam.org/v${version}`;
  }

  /**
   * Main entry point - scrape all solver information
   */
  async scrapeSolvers(): Promise<Map<string, SolverInfo>> {
    console.log(`Scraping OpenFOAM v${this.version} solvers from ${this.baseUrl}...`);

    try {
      // First, get the applications/solvers directory listing
      const solversPageUrl = `${this.baseUrl}/dir_3298c1b3ffc9e8c42e8a12cfd3c20a8d.html`;
      console.log(`Fetching solvers page: ${solversPageUrl}`);

      const solversHtml = await this.fetchPage(solversPageUrl);

      // Extract solver module links
      const solverLinks = this.extractSolverLinks(solversHtml);
      console.log(`Found ${solverLinks.length} solver modules`);

      // Fetch details for each solver
      for (const link of solverLinks) {
        await this.fetchSolverDetails(link);
      }

      console.log(`Successfully scraped ${this.solvers.size} solvers`);

      // If no solvers found, use fallback
      if (this.solvers.size === 0) {
        console.log('No solvers found via web scraping, using fallback list...');
        return this.getFallbackSolvers();
      }

      return this.solvers;

    } catch (error) {
      console.error('Error scraping solvers:', error);
      console.log('Using fallback solver list...');
      // Return hardcoded list if scraping fails
      return this.getFallbackSolvers();
    }
  }

  /**
   * Fetch HTML content from URL
   */
  private async fetchPage(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;

      protocol.get(url, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${url}`));
          }
        });

      }).on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Extract solver links from the solvers directory page
   */
  private extractSolverLinks(html: string): Array<{ name: string, url: string }> {
    const links: Array<{ name: string, url: string }> = [];

    // Parse HTML to find solver module directories
    // OpenFOAM documentation uses specific patterns for solver directories
    const dirPattern = /href="(dir_[^"]+\.html)">([^<]+)</g;
    let match;

    while ((match = dirPattern.exec(html)) !== null) {
      const url = match[1];
      const name = match[2].trim();

      // Filter out non-solver directories
      if (this.isSolverDirectory(name)) {
        links.push({
          name: name,
          url: `${this.baseUrl}/${url}`
        });
      }
    }

    return links;
  }

  /**
   * Determine if directory name represents a solver
   */
  private isSolverDirectory(name: string): boolean {
    // Common OpenFOAM solver naming patterns
    const solverPatterns = [
      /Foam$/i,           // simpleFoam, pimpleFoam, etc.
      /Solver$/i,         // multiphaseEuler, compressibleVoF
      /^incompressible/i,
      /^compressible/i,
      /^multiphase/i,
      /^DNS/i,
      /^LES/i,
    ];

    // Exclude utility and non-solver directories
    const excludePatterns = [
      /^utilities/i,
      /^test/i,
      /^include/i,
    ];

    for (const exclude of excludePatterns) {
      if (exclude.test(name)) return false;
    }

    for (const pattern of solverPatterns) {
      if (pattern.test(name)) return true;
    }

    return false;
  }

  /**
   * Fetch detailed information for a specific solver
   */
  private async fetchSolverDetails(link: { name: string, url: string }): Promise<void> {
    try {
      const html = await this.fetchPage(link.url);

      // Extract description from the page
      const description = this.extractDescription(html, link.name);

      // Extract purpose/applications if available
      const purpose = this.extractPurpose(html);

      const solver: SolverInfo = {
        name: link.name,
        description: description,
        category: 'solver',
        url: link.url,
        version: this.version,
        purpose: purpose,
      };

      this.solvers.set(link.name, solver);
      console.log(`  Extracted: ${link.name}`);

    } catch (error) {
      console.error(`  Failed to fetch ${link.name}:`, error);
    }
  }

  /**
   * Extract description from HTML
   */
  private extractDescription(html: string, name: string): string {
    // Try to find description in various HTML patterns
    const patterns = [
      /<div class="textblock">([^<]+)</,
      /<p>([^<]+)<\/p>/,
      /<td class="mdescRight">([^<]+)</,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        return this.cleanText(match[1]);
      }
    }

    // Fallback to generic description
    return `OpenFOAM solver module: ${name}`;
  }

  /**
   * Extract purpose/application area from HTML
   */
  private extractPurpose(html: string): string | undefined {
    const purposePattern = /<h2[^>]*>Purpose<\/h2>\s*<p>([^<]+)<\/p>/i;
    const match = html.match(purposePattern);

    if (match && match[1]) {
      return this.cleanText(match[1]);
    }

    return undefined;
  }

  /**
   * Clean extracted text (remove HTML entities, extra whitespace)
   */
  private cleanText(text: string): string {
    return text
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Fallback solver list (hardcoded from OpenFOAM 13)
   * Used when web scraping fails
   */
  private getFallbackSolvers(): Map<string, SolverInfo> {
    const fallbackSolvers: SolverInfo[] = [
      {
        name: 'simpleFoam',
        description: 'Steady-state solver for incompressible, turbulent flows using the SIMPLE algorithm',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Steady-state incompressible turbulent flow',
        applications: ['External aerodynamics', 'HVAC', 'Industrial flows']
      },
      {
        name: 'pimpleFoam',
        description: 'Transient solver for incompressible flow using the PIMPLE (merged PISO-SIMPLE) algorithm',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Transient incompressible flow',
        applications: ['Unsteady flows', 'Fluid-structure interaction', 'Moving meshes']
      },
      {
        name: 'pisoFoam',
        description: 'Transient solver for incompressible flow using the PISO algorithm',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Transient incompressible flow (DNS/LES)',
        applications: ['Direct numerical simulation', 'Large eddy simulation']
      },
      {
        name: 'interFoam',
        description: 'Solver for two incompressible, isothermal immiscible fluids using a VOF phase-fraction method',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Two-phase free surface flow',
        applications: ['Sloshing', 'Wave breaking', 'Dam break', 'Filling processes']
      },
      {
        name: 'interIsoFoam',
        description: 'Solver for two incompressible, isothermal immiscible fluids using isoAdvector phase-fraction method',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Sharp interface two-phase flow',
        applications: ['High accuracy VOF', 'Bubble dynamics', 'Droplet impact']
      },
      {
        name: 'multiphaseInterFoam',
        description: 'Solver for n incompressible, isothermal immiscible fluids using VOF',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Multi-phase free surface flow',
        applications: ['Multiple immiscible fluids', 'Three or more phases']
      },
      {
        name: 'compressibleInterFoam',
        description: 'Solver for 2 compressible, isothermal immiscible fluids using VOF',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Compressible two-phase flow',
        applications: ['Gas-liquid flows with compression', 'Underwater explosions']
      },
      {
        name: 'rhoPimpleFoam',
        description: 'Transient solver for compressible flow using the PIMPLE algorithm',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Transient compressible flow',
        applications: ['Subsonic compressible flows', 'Heat transfer', 'Combustion']
      },
      {
        name: 'rhoSimpleFoam',
        description: 'Steady-state solver for compressible turbulent flow using the SIMPLE algorithm',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Steady-state compressible flow',
        applications: ['Subsonic flows', 'Heat exchangers', 'Turbomachinery']
      },
      {
        name: 'sonicFoam',
        description: 'Transient solver for compressible flows with shock waves',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Supersonic/transonic flow with shocks',
        applications: ['Supersonic flows', 'Shock tubes', 'Nozzles']
      },
      {
        name: 'rhoCentralFoam',
        description: 'Density-based compressible flow solver using central-upwind schemes',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'High-speed compressible flow',
        applications: ['Supersonic jets', 'Shock interactions', 'Explosions']
      },
      {
        name: 'buoyantSimpleFoam',
        description: 'Steady-state solver for buoyant, turbulent flow of compressible fluids',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Steady-state buoyancy-driven flow',
        applications: ['Natural convection', 'HVAC', 'Fire simulation']
      },
      {
        name: 'buoyantPimpleFoam',
        description: 'Transient solver for buoyant, turbulent flow of compressible fluids',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Transient buoyancy-driven flow',
        applications: ['Natural convection', 'Fire dynamics', 'Indoor airflow']
      },
      {
        name: 'reactingFoam',
        description: 'Solver for combustion with chemical reactions',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Compressible reacting flow',
        applications: ['Combustion', 'Chemical reactions', 'Premixed/diffusion flames']
      },
      {
        name: 'coldEngineFoam',
        description: 'Solver for cold flow in internal combustion engines with mesh motion',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Engine cold flow simulation',
        applications: ['IC engine breathing', 'Intake/exhaust flow', 'Valve motion']
      },
      {
        name: 'engineFoam',
        description: 'Solver for internal combustion engines with spray, combustion and heat transfer',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Engine combustion simulation',
        applications: ['IC engines', 'Fuel injection', 'Engine combustion']
      },
      {
        name: 'sprayFoam',
        description: 'Transient solver for compressible flow with spray parcels',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Spray combustion',
        applications: ['Diesel spray', 'Fuel injection', 'Spray atomization']
      },
      {
        name: 'coalChemistryFoam',
        description: 'Transient solver for coal combustion with solid particles',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Coal combustion',
        applications: ['Pulverized coal', 'Biomass combustion', 'Solid fuel']
      },
      {
        name: 'DPMFoam',
        description: 'Transient solver for incompressible flow with Discrete Particle Method (Lagrangian particles)',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Particle-laden flow',
        applications: ['Spray', 'Pneumatic conveying', 'Droplet dynamics']
      },
      {
        name: 'MPPICFoam',
        description: 'Solver for incompressible flow with Multi-Phase Particle-In-Cell dense particles',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Dense particle flow',
        applications: ['Fluidized beds', 'Particle collisions', 'Granular flow']
      },
      {
        name: 'reactingParcelFoam',
        description: 'Solver for compressible flow with reacting Lagrangian particles',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Reacting particle flow',
        applications: ['Spray combustion', 'Droplet evaporation', 'Particle reactions']
      },
      {
        name: 'twoPhaseEulerFoam',
        description: 'Solver for a system of 2 incompressible fluid phases with heat transfer',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Eulerian two-phase flow',
        applications: ['Bubbly flow', 'Fluidization', 'Sedimentation']
      },
      {
        name: 'multiphaseEulerFoam',
        description: 'Solver for multiple incompressible fluid phases with heat and mass transfer',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Multi-phase Eulerian flow',
        applications: ['Multiple bubble sizes', 'Population balance', 'Mass transfer']
      },
      {
        name: 'driftFluxFoam',
        description: 'Solver for 2 incompressible fluid phases using mixture model',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Drift-flux two-phase model',
        applications: ['Settling', 'Sedimentation', 'Dilute dispersed phase']
      },
      {
        name: 'potentialFoam',
        description: 'Potential flow solver for incompressible, inviscid flow',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Potential flow initialization',
        applications: ['Initial conditions', 'Inviscid flow', 'External aerodynamics']
      },
      {
        name: 'icoFoam',
        description: 'Transient solver for incompressible, laminar flow of Newtonian fluids',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Laminar incompressible flow',
        applications: ['Low Reynolds number', 'Microfluidics', 'Validation cases']
      },
      {
        name: 'nonNewtonianIcoFoam',
        description: 'Transient solver for incompressible, laminar flow of non-Newtonian fluids',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Non-Newtonian laminar flow',
        applications: ['Polymer flows', 'Blood flow', 'Rheology']
      },
      {
        name: 'SRFSimpleFoam',
        description: 'Steady-state solver for incompressible flow using Single Rotating Frame of reference',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Rotating machinery (steady)',
        applications: ['Turbomachinery', 'Fans', 'Impellers']
      },
      {
        name: 'SRFPimpleFoam',
        description: 'Transient solver for incompressible flow using Single Rotating Frame',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Rotating machinery (transient)',
        applications: ['Unsteady turbomachinery', 'Rotor-stator', 'Cyclic flows']
      },
      {
        name: 'MRFSimpleFoam',
        description: 'Steady-state solver for incompressible flow with Multiple Reference Frames',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Multiple rotating regions',
        applications: ['Multi-stage turbomachinery', 'Mixing tanks', 'Propellers']
      },
      {
        name: 'MRFPimpleFoam',
        description: 'Transient solver for incompressible flow with Multiple Reference Frames',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Transient multiple rotating regions',
        applications: ['Unsteady mixing', 'Rotor dynamics', 'Pumps']
      },
      {
        name: 'pimpleDyMFoam',
        description: 'Transient solver for incompressible flow with dynamic mesh motion',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Dynamic mesh',
        applications: ['Moving boundaries', 'FSI', 'Morphing geometry']
      },
      {
        name: 'laplacianFoam',
        description: 'Solver for simple Laplace equation (e.g., thermal diffusion)',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Diffusion/Laplace equation',
        applications: ['Heat conduction', 'Potential fields', 'Diffusion']
      },
      {
        name: 'scalarTransportFoam',
        description: 'Solves a transport equation for a passive scalar',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Passive scalar transport',
        applications: ['Tracer transport', 'Concentration', 'Age of air']
      },
      {
        name: 'dnsFoam',
        description: 'Direct Numerical Simulation (DNS) solver for incompressible flow',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'DNS turbulence',
        applications: ['Turbulence research', 'High-fidelity simulation']
      },
      {
        name: 'shallowWaterFoam',
        description: 'Solver for shallow water equations',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Shallow water flow',
        applications: ['Rivers', 'Coastal flows', 'Flood modeling']
      },
      {
        name: 'electrostaticFoam',
        description: 'Solver for electrostatics',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Electrostatic fields',
        applications: ['Electric potential', 'Charge distribution']
      },
      {
        name: 'magneticFoam',
        description: 'Solver for electromagnetic fields',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Electromagnetic simulation',
        applications: ['Magnetic fields', 'Inductance']
      },
      {
        name: 'solidDisplacementFoam',
        description: 'Solver for solid mechanics (linear elasticity)',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Solid mechanics',
        applications: ['Structural analysis', 'Stress', 'Deformation']
      },
      {
        name: 'solidEquilibriumDisplacementFoam',
        description: 'Steady-state solver for solid mechanics',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Equilibrium solid mechanics',
        applications: ['Static structural analysis']
      },
      {
        name: 'thermoFoam',
        description: 'Solver for energy equation in stationary fluid',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Pure heat transfer',
        applications: ['Heat conduction', 'Thermal analysis']
      },
      {
        name: 'chtMultiRegionFoam',
        description: 'Solver for conjugate heat transfer between solid and fluid regions',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Conjugate heat transfer',
        applications: ['Heat exchangers', 'Electronics cooling', 'Multi-region thermal']
      },
      {
        name: 'overPimpleDyMFoam',
        description: 'Transient solver for incompressible flow with overset meshes',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Overset (Chimera) meshes',
        applications: ['Complex motion', 'Multiple bodies', 'Relative motion']
      },
      {
        name: 'overInterDyMFoam',
        description: 'Solver for two-phase flow with overset meshes',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Two-phase overset',
        applications: ['Ship hydrodynamics', 'Floating bodies', 'Wave-structure']
      },
      {
        name: 'cavitatingFoam',
        description: 'Transient cavitation solver based on homogeneous equilibrium model',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Cavitation',
        applications: ['Hydrofoils', 'Propellers', 'Pumps with cavitation']
      },
      {
        name: 'interPhaseChangeFoam',
        description: 'Solver for two incompressible fluids with phase change (evaporation/condensation)',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Phase change two-phase',
        applications: ['Boiling', 'Condensation', 'Evaporation']
      },
      {
        name: 'dsmcFoam',
        description: 'Direct Simulation Monte Carlo solver for rarefied gas dynamics',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Rarefied gas',
        applications: ['Vacuum', 'High altitude', 'Molecular dynamics']
      },
      {
        name: 'PDRFoam',
        description: 'Solver for partially stirred reactor for engine combustion',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Explosion simulation',
        applications: ['Gas explosions', 'Vented explosions', 'Safety analysis']
      },
      {
        name: 'XiFoam',
        description: 'Solver for premixed turbulent combustion using b-Xi model',
        category: 'solver',
        url: '',
        version: this.version,
        purpose: 'Premixed combustion',
        applications: ['Gas turbines', 'Premixed flames', 'Flame speed']
      },
    ];

    const solverMap = new Map<string, SolverInfo>();
    for (const solver of fallbackSolvers) {
      solverMap.set(solver.name, solver);
    }

    return solverMap;
  }

  /**
   * Save scraped solvers to JSON file
   */
  async saveSolvers(outputPath: string): Promise<void> {
    // If no solvers in map, it means we might not have called scrapeSolvers yet
    // or there was an issue - ensure we have the fallback
    if (this.solvers.size === 0) {
      console.log('No solvers in memory, ensuring fallback is used...');
      this.solvers = this.getFallbackSolvers();
    }

    const solversArray = Array.from(this.solvers.values());

    const output = {
      version: this.version,
      generatedAt: new Date().toISOString(),
      source: this.baseUrl,
      solverCount: solversArray.length,
      solvers: solversArray
    };

    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(`Saved ${solversArray.length} solvers to ${outputPath}`);
  }
}

/**
 * CLI entry point
 */
async function main() {
  const version = process.argv[2] || '13';
  const outputPath = process.argv[3] || path.join(__dirname, '..', '..', 'data', 'openfoam-solvers.json');

  console.log(`OpenFOAM Solver Scraper`);
  console.log(`Version: ${version}`);
  console.log(`Output: ${outputPath}`);
  console.log('');

  const scraper = new SolverScraper(version);

  try {
    // Scrape solvers (will use fallback if web scraping fails)
    const solvers = await scraper.scrapeSolvers();

    // Save the result
    await scraper.saveSolvers(outputPath);

    console.log('\nSummary:');
    console.log(`  Total solvers: ${solvers.size}`);
    console.log(`  Output file: ${outputPath}`);

  } catch (error) {
    console.error('\nError:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export default SolverScraper;
