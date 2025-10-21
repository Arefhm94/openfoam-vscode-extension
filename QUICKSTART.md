# Quick Start Guide - OpenFOAM Language Support

Get up and running with the OpenFOAM VS Code extension in minutes.

## Prerequisites

- Visual Studio Code 1.75.0 or higher
- Node.js 18+ and npm
- OpenFOAM installation (for keyword extraction)

## Installation Steps

### 1. Build the Extension

```bash
cd /Users/arefmoalemi/Downloads/OpenFOAM-13-master/openfoam-vscode-extension

# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Extract keywords from OpenFOAM source (already done!)
# npm run extract-keywords
# OR specify custom path:
# node out/extractor/extractKeywords.js /path/to/your/OpenFOAM-source
```

✅ **Good news!** Keyword extraction has already been completed with **2990 keywords** extracted from your OpenFOAM-13 source.

### 2. Install in VS Code

Choose one of these methods:

#### Method A: Extension Development Host (Recommended for testing)

1. Open the extension folder in VS Code:
   ```bash
   code /Users/arefmoalemi/Downloads/OpenFOAM-13-master/openfoam-vscode-extension
   ```

2. Press `F5` to launch Extension Development Host

3. In the new window, open an OpenFOAM file from the examples:
   ```bash
   # In the Extension Development Host window
   File → Open File → examples/controlDict
   ```

#### Method B: Install as Extension

1. Copy to extensions directory:
   ```bash
   cp -r /Users/arefmoalemi/Downloads/OpenFOAM-13-master/openfoam-vscode-extension \
         ~/.vscode/extensions/openfoam-language-support-0.1.0
   ```

2. Restart VS Code

3. Open any OpenFOAM file

#### Method C: Package and Install VSIX

```bash
# Install packaging tool
npm install -g @vscode/vsce

# Package the extension
cd /Users/arefmoalemi/Downloads/OpenFOAM-13-master/openfoam-vscode-extension
vsce package

# This creates: openfoam-language-support-0.1.0.vsix
# Install via: Extensions → ... → Install from VSIX
```

## Test the Extension

### 1. Open Example Files

The `examples/` directory contains sample OpenFOAM files:

- **controlDict** - Time and simulation control
- **fvSchemes** - Discretization schemes
- **fvSolution** - Linear solver settings
- **U** - Velocity field with boundary conditions

### 2. Test Syntax Highlighting

Open any example file. You should see:
- 🟦 Blue keywords (e.g., `application`, `startTime`, `solver`)
- 🟩 Green strings and comments
- 🟨 Yellow numbers
- 🟪 Purple types (e.g., `fixedValue`, `zeroGradient`)

### 3. Test Hover

Hover over keywords to see documentation:
- Hover over `deltaT` → Shows "Time step size (seconds)"
- Hover over `solver` → Shows solver types and parameters
- Hover over `fixedValue` → Shows boundary condition details

### 4. Test Auto-Completion

Start typing in a dictionary:
1. Type `del` → See `deltaT` suggestion
2. Press `Enter` → Snippet inserts `deltaT        ${1:value};`
3. Type `sol` → See `solver` and related keywords
4. Select `solver` → Inserts solver block template

### 5. Test Command

1. Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Win/Linux)
2. Type "OpenFOAM: Refresh"
3. Select "OpenFOAM: Refresh Keyword Database"
4. Enter OpenFOAM path when prompted (or cancel)

## Verify Installation

Check the Output panel:
1. View → Output
2. Select "OpenFOAM Language Server" from dropdown
3. Should see: "OpenFOAM Language Server ready with 2990 keywords"

## Using with Your OpenFOAM Cases

Once installed, the extension automatically activates for:

### By File Extension
- `*.foam`
- `*.dict`

### By Filename
- `controlDict`
- `fvSchemes`
- `fvSolution`
- `blockMeshDict`
- `snappyHexMeshDict`
- `decomposeParDict`
- `*Properties`
- `*Dict`

Just open any of these files in VS Code and start editing!

## Common Tasks

### Update Keyword Database

If you update OpenFOAM or want to extract from a different version:

```bash
cd /Users/arefmoalemi/Downloads/OpenFOAM-13-master/openfoam-vscode-extension
node out/extractor/extractKeywords.js /path/to/new/OpenFOAM
cp out/data/openfoam-keywords.json data/openfoam-keywords.json

# Then reload VS Code
```

### Watch Mode for Development

```bash
cd /Users/arefmoalemi/Downloads/OpenFOAM-13-master/openfoam-vscode-extension
npm run watch

# In another terminal or press F5 in VS Code
```

### Debug the Extension

1. Open extension folder in VS Code
2. Set breakpoints in TypeScript files
3. Press `F5` to launch debugger
4. Extension runs in new window with debugger attached

### Debug the Language Server

1. Uncomment `--inspect` in server options (src/extension.ts line 56)
2. Launch extension with `F5`
3. Open Chrome/Edge: `chrome://inspect`
4. Click "inspect" on the language server process

## Troubleshooting

### "No keywords found"

Check that `data/openfoam-keywords.json` exists:
```bash
ls -lh data/openfoam-keywords.json
```

If missing, run keyword extraction again.

### "Extension not activating"

1. Check file matches supported patterns
2. Look for errors: Help → Toggle Developer Tools → Console
3. Check Output panel: OpenFOAM Language Server

### "No completions appearing"

1. Verify language server is running (Output panel)
2. Try manual trigger: `Ctrl+Space`
3. Check keyword database loaded (should see count in Output)

## Next Steps

- **Customize**: Edit `src/extractor/extractKeywords.ts` to add more keywords
- **Extend**: Add new features in `src/language-server/server.ts`
- **Share**: Package and share with your team
- **Contribute**: Improve keyword coverage and documentation

## Support

For issues and questions:
- Check the main [README.md](README.md) for detailed documentation
- Review the [Known Limitations](README.md#known-limitations) section
- Check TODO comments in the source code

## Success Indicators

✅ Extension activates for OpenFOAM files
✅ Syntax highlighting displays correctly  
✅ Hover shows keyword documentation
✅ Completions suggest relevant keywords
✅ Output shows "ready with 2990 keywords"
✅ No errors in Developer Tools console

---

**Congratulations!** Your OpenFOAM Language Support extension is ready to use. Happy OpenFOAM coding! 🚀
