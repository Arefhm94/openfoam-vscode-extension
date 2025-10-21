# OpenFOAM Language Support for VS Code

A comprehensive VS Code extension providing syntax highlighting and IntelliSense for OpenFOAM dictionary files.

## Features

### 🎨 Syntax Highlighting
- Color-coded tokens for keywords, values, comments, strings, and numbers
- Support for OpenFOAM dictionary syntax including:
  - FoamFile headers
  - Dictionary blocks with braces
  - Include directives (`#include`, `#includeEtc`, etc.)
  - Comments (C++ style `//` and `/* */`)
  - Scientific notation numbers

### 🧠 IntelliSense

#### Hover Information
Hover over any OpenFOAM keyword to see:
- Concise description of the keyword
- Required and optional parameters
- Parameter types and default values
- Usage examples
- Source file reference (where extracted from)

#### Auto-Completion
- Context-aware keyword suggestions
- Snippet-style completions with tab stops
- Parameter templates for complex keywords
- Prioritized suggestions based on file context

#### Signature Help
- Parameter information while typing
- Shows parameter names, types, and descriptions
- Indicates required vs. optional parameters

## Supported File Types

The extension automatically activates for:

### File Extensions
- `.foam` - OpenFOAM case files
- `.dict` - Dictionary files

### Specific Filenames
- `controlDict` - Simulation control parameters
- `fvSchemes` - Discretization schemes
- `fvSolution` - Linear solver settings
- `blockMeshDict` - Mesh generation
- `snappyHexMeshDict` - Advanced meshing
- `decomposeParDict` - Parallel decomposition
- `transportProperties` - Physical properties
- `turbulenceProperties` - Turbulence model settings
- `thermophysicalProperties` - Thermophysical properties
- And many more...

## Installation

### From Source

1. **Clone or copy the extension to your workspace:**
   ```bash
   cd /path/to/OpenFOAM-13-master/openfoam-vscode-extension
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Extract OpenFOAM keywords (important!):**
   ```bash
   npm run compile
   npm run extract-keywords
   ```
   
   Or specify a custom OpenFOAM source directory:
   ```bash
   node out/extractor/extractKeywords.js /path/to/OpenFOAM-source
   ```

4. **Compile the extension:**
   ```bash
   npm run compile
   ```

5. **Package the extension (optional):**
   ```bash
   npm install -g vsce
   vsce package
   ```
   This creates a `.vsix` file you can install.

6. **Install in VS Code:**
   - Method 1: Copy the extension folder to `~/.vscode/extensions/`
   - Method 2: In VS Code, press `F5` to launch Extension Development Host
   - Method 3: Install the `.vsix` file via Extensions panel → "..." → Install from VSIX

## Usage

### Basic Usage

1. Open any OpenFOAM dictionary file (`controlDict`, `fvSchemes`, etc.)
2. The extension activates automatically
3. Start typing to see completions
4. Hover over keywords for documentation
5. Use `Ctrl+Space` to trigger completions manually

### Refreshing the Keyword Database

If you update your OpenFOAM source or want to extract from a different version:

1. **Via Command Palette:**
   - Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
   - Type "OpenFOAM: Refresh Keyword Database"
   - Enter your OpenFOAM source directory path
   - Wait for extraction to complete
   - Reload VS Code window

2. **Via Terminal:**
   ```bash
   cd /path/to/openfoam-vscode-extension
   node out/extractor/extractKeywords.js /path/to/OpenFOAM-source
   # Then reload VS Code
   ```

## Development

### Project Structure

```
openfoam-vscode-extension/
├── package.json                    # Extension manifest
├── tsconfig.json                   # TypeScript configuration
├── language-configuration.json     # Language configuration
├── src/
│   ├── extension.ts               # Extension entry point
│   ├── language-server/
│   │   └── server.ts              # Language server implementation
│   └── extractor/
│       └── extractKeywords.ts     # Keyword extraction script
├── syntaxes/
│   └── openfoam.tmLanguage.json   # TextMate grammar
├── data/
│   └── openfoam-keywords.json     # Generated keyword database
├── examples/
│   ├── controlDict                # Example OpenFOAM files
│   ├── fvSchemes
│   ├── fvSolution
│   └── U
└── README.md                       # This file
```

### Building and Debugging

**Compile TypeScript:**
```bash
npm run compile
```

**Watch mode (auto-recompile on changes):**
```bash
npm run watch
```

**Debug the extension:**
1. Open the extension folder in VS Code
2. Press `F5` to launch Extension Development Host
3. Open an OpenFOAM file in the new window
4. Set breakpoints in the TypeScript source

**Debug the language server:**
The language server runs in a separate process. To debug:
1. Uncomment the `--inspect` line in `src/extension.ts`
2. Launch the extension with `F5`
3. Attach a debugger to the language server process (port 6009)

### Keyword Extraction Process

The keyword extractor (`src/extractor/extractKeywords.ts`) performs the following:

1. **Hardcoded Keywords:** Adds ~100 essential OpenFOAM keywords with detailed documentation
2. **Source Scanning:** 
   - Walks the OpenFOAM source tree (`src/`, `applications/`, `etc/`)
   - Extracts keywords from C++ files using regex patterns:
     - `dict.lookup()` and `lookupOrDefault()` calls
     - String literals in dictionary access patterns
   - Extracts keywords from OpenFOAM dictionary templates
3. **Documentation Extraction:**
   - Searches for Doxygen-style comments (`//!`, `///`, `/* */`)
   - Extracts inline comments near keyword usage
4. **Categorization:** Automatically categorizes keywords:
   - `control` - Time and simulation control
   - `solver` - Linear solver settings
   - `scheme` - Discretization schemes
   - `boundary` - Boundary conditions
   - `function` - Function objects
   - `property` - Physical properties
   - `utility` - Mesh utilities
5. **Output:** Generates `data/openfoam-keywords.json` with structured data

### Keyword Database Format

```json
{
  "version": "1.0.0",
  "generatedAt": "2025-10-22T...",
  "sourceRoot": "/path/to/OpenFOAM",
  "keywordCount": 150,
  "keywords": [
    {
      "name": "deltaT",
      "description": "Time step size (seconds)",
      "category": "control",
      "parameters": [
        {
          "name": "value",
          "type": "scalar",
          "required": true,
          "description": "Time step in seconds"
        }
      ],
      "examples": [
        "deltaT          0.001;"
      ],
      "sourceFile": "src/OpenFOAM/..."
    }
  ]
}
```

## Coverage

### Implemented Keywords (~100+ essential keywords)

**Control Keywords:**
- `application`, `startFrom`, `startTime`, `stopAt`, `endTime`
- `deltaT`, `writeControl`, `writeInterval`, `writeFormat`
- `adjustTimeStep`, `maxCo`, `maxAlphaCo`, `runTimeModifiable`

**Solver Keywords:**
- `solver`, `preconditioner`, `tolerance`, `relTol`
- `minIter`, `maxIter`, `smoother`, `nSweeps`
- `GAMG`, `PCG`, `PBiCG`, `smoothSolver`

**Scheme Keywords:**
- `ddtSchemes`, `gradSchemes`, `divSchemes`, `laplacianSchemes`
- `Euler`, `backward`, `CrankNicolson`, `steadyState`
- `Gauss`, `linear`, `upwind`, `linearUpwind`, `vanLeer`, `LUST`

**Boundary Conditions:**
- `fixedValue`, `zeroGradient`, `calculated`, `mixed`
- `inletOutlet`, `slip`, `noSlip`, `symmetry`, `empty`
- `type`, `value`, `boundaryField`, `internalField`

Additional keywords are extracted from your OpenFOAM source during the extraction process.

## Known Limitations

### Current Implementation

1. **Regex-based extraction:** The keyword extractor uses regular expressions rather than full C++ AST parsing. This means:
   - Some complex keyword patterns may be missed
   - False positives may occur for generic string literals
   - Nested namespace and class context is not fully captured

2. **Documentation quality:** Documentation quality depends on:
   - Presence of comments in the source code
   - Proximity of comments to keyword usage
   - Doxygen-style documentation availability

3. **No diagnostics:** The current version does not provide:
   - Syntax error checking
   - Value validation
   - Required parameter verification
   - Type checking

4. **Limited signature help:** Signature help is basic and doesn't track cursor position within parameter lists

5. **Static database:** The keyword database must be manually regenerated when:
   - Switching OpenFOAM versions
   - Updating the OpenFOAM source
   - Adding custom keywords

## Future Improvements

### High Priority
- [ ] Add proper C++ AST parsing for keyword extraction (using libclang or tree-sitter)
- [ ] Implement diagnostics for syntax errors
- [ ] Add value validation based on parameter types
- [ ] Improve signature help with active parameter tracking
- [ ] Support for OpenFOAM dictionary inheritance and `#include` resolution

### Medium Priority
- [ ] Add code actions (quick fixes) for common issues
- [ ] Implement document formatting
- [ ] Add snippets for common dictionary patterns
- [ ] Support for field file templates
- [ ] Integration with OpenFOAM version detection

### Low Priority
- [ ] Go-to-definition for included files
- [ ] Find references for dictionary keys
- [ ] Workspace-wide symbol search
- [ ] Integration with OpenFOAM case validation tools
- [ ] Support for foam file system links

## Contributing

This is a first-draft extension skeleton. Contributions are welcome!

### Areas for Contribution
1. **Keyword coverage:** Add more keywords and better documentation
2. **Parser improvements:** Replace regex with proper parsing
3. **Diagnostics:** Add syntax and semantic checking
4. **Testing:** Add unit and integration tests
5. **Documentation:** Improve user and developer documentation

### Development TODO Comments

The code contains TODO comments marking areas needing improvement:
- `TODO: Enhance with proper C++ AST parsing`
- `TODO: Add support for parsing OpenFOAM dictionary files directly`
- `TODO: Replace regex-based extraction with proper C++ AST parsing`
- `TODO: Handle nested class definitions and namespaces better`

## Testing

### Manual Testing

1. Open the example files in `examples/`
2. Verify syntax highlighting appears correctly
3. Hover over keywords like `deltaT`, `solver`, `type`
4. Start typing in a dictionary and check completions
5. Test with your own OpenFOAM cases

### Test Checklist

- [ ] Syntax highlighting works for all token types
- [ ] Hover shows information for essential keywords
- [ ] Completions appear when typing
- [ ] Completions insert correct snippet format
- [ ] Extension activates for all specified file patterns
- [ ] Keyword refresh command works
- [ ] No errors in Developer Tools console

## Troubleshooting

### Extension doesn't activate
- Check that your file matches one of the supported patterns
- Look for errors in Developer Tools (Help → Toggle Developer Tools)
- Ensure the extension is installed and enabled

### No IntelliSense suggestions
- Verify keyword database exists: `data/openfoam-keywords.json`
- Run keyword extraction if database is missing
- Check language server is running (look for "OpenFOAM Language Server" in Output panel)
- Reload VS Code window

### Keyword extraction fails
- Ensure you have the correct path to OpenFOAM source
- Check you have read permissions for the source directory
- Verify Node.js and TypeScript are installed
- Check terminal output for specific error messages

### Performance issues
- The keyword database loading is done once at startup
- If you have performance issues, check the size of `openfoam-keywords.json`
- Consider reducing the source scanning scope in `extractKeywords.ts`

## License

This extension is provided as-is for use with OpenFOAM. OpenFOAM is licensed under the GNU General Public License v3.0.

## Credits

- OpenFOAM: The OpenFOAM Foundation (https://openfoam.org)
- VS Code Extension API: Microsoft
- Language Server Protocol: Microsoft

## Version History

### 0.1.0 (Initial Release)
- Basic syntax highlighting for OpenFOAM dictionary files
- Hover information for ~100 essential keywords
- Auto-completion with snippets
- Signature help for parameters
- Keyword extraction from OpenFOAM source
- Support for common OpenFOAM file types

---

**Note:** This is a first-draft extension skeleton designed to be extended and improved. The extraction process uses heuristics and may not capture all keywords or documentation perfectly. Contributions to improve coverage and accuracy are welcome!
