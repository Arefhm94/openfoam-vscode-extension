# Testing Instructions - OpenFOAM VS Code Extension

## Pre-Test Verification

### ✅ Build Status

All components have been successfully built:

```bash
✅ Dependencies installed: 143 packages, 0 vulnerabilities
✅ TypeScript compiled: No errors
✅ Keyword database generated: 2990 keywords (669KB)
✅ Extension structure complete
```

### Files Ready for Testing

- `out/extension.js` - Compiled extension entry point
- `out/language-server/server.js` - Compiled language server
- `out/extractor/extractKeywords.js` - Compiled keyword extractor
- `data/openfoam-keywords.json` - Keyword database (2990 keywords)
- `syntaxes/openfoam.tmLanguage.json` - Syntax highlighting grammar
- `examples/` - 4 test files (controlDict, fvSchemes, fvSolution, U)

## Quick Test (5 minutes)

### Method 1: Press F5 (Recommended)

1. **Open the extension in VS Code:**
   ```bash
   cd /Users/arefmoalemi/Downloads/OpenFOAM-13-master/openfoam-vscode-extension
   code .
   ```

2. **Launch Extension Development Host:**
   - Press `F5` (or Run → Start Debugging)
   - A new VS Code window opens with the extension running

3. **Open an example file:**
   - In the new window: File → Open File
   - Navigate to: `examples/controlDict`
   - The file should open with syntax highlighting

4. **Test features:**

   **Syntax Highlighting:**
   - Keywords like `application`, `startTime`, `deltaT` should be colored
   - Numbers should be distinct color
   - Comments should be green/gray
   - Strings should be colored

   **Hover:**
   - Hover over `deltaT` → Should show: "Time step size (seconds)"
   - Hover over `application` → Should show: "Solver application name to use for the simulation"
   - Hover over `endTime` → Should show parameter information

   **Completion:**
   - Add a new line after `endTime         1000;`
   - Type `max` → Should suggest `maxCo`, `maxAlphaCo`, `maxDeltaT`
   - Select `maxCo` → Should insert `maxCo           1;`
   - Type `write` → Should suggest `writeControl`, `writeInterval`, `writeFormat`, etc.

   **Verify Language Server:**
   - View → Output
   - Select "OpenFOAM Language Server" from dropdown
   - Should see: "OpenFOAM Language Server ready with 2990 keywords"

5. **Test other example files:**
   - Open `examples/fvSchemes` - test scheme keywords
   - Open `examples/fvSolution` - test solver keywords
   - Open `examples/U` - test boundary condition keywords

### Method 2: Manual Installation

If F5 doesn't work, install manually:

```bash
# Copy to extensions directory
cp -r /Users/arefmoalemi/Downloads/OpenFOAM-13-master/openfoam-vscode-extension \
      ~/.vscode/extensions/openfoam-language-support-0.1.0

# Restart VS Code
# Open any example file
```

## Detailed Feature Tests

### Test 1: Syntax Highlighting

**File:** `examples/controlDict`

Expected highlighting:
```
application     simpleFoam;
// ^^^^^^^^^ keyword in blue/purple
//              ^^^^^^^^^^ string/identifier
//                        ^ operator

startTime       0;
// ^^^^^^^ keyword
//              ^ number in orange/yellow

deltaT          1;
// ^^^^^ keyword (should be highlighted)
```

**Pass Criteria:**
- [ ] Keywords are colored differently than values
- [ ] Numbers have distinct color
- [ ] Comments are grayed out
- [ ] Strings in quotes are colored
- [ ] Braces `{}` are highlighted

### Test 2: Hover Information

**File:** `examples/controlDict`

Test these hovers:

1. **Hover over `application`:**
   - Should show: "Solver application name to use for the simulation"
   - Category: (control)
   - May show examples

2. **Hover over `deltaT`:**
   - Should show: "Time step size (seconds)"
   - Parameters: value (scalar, required)
   - Examples: `deltaT          0.001;`

3. **Hover over `writeControl`:**
   - Should show: "Controls when results are written to disk"
   - Parameter: value (string) - timeStep, runTime, etc.

**Pass Criteria:**
- [ ] Hover shows description
- [ ] Hover shows category in parentheses
- [ ] Hover shows parameters for keywords that have them
- [ ] Hover uses Markdown formatting (bold keywords, code blocks)

### Test 3: Auto-Completion

**File:** Create new or edit `examples/controlDict`

Test these completions:

1. **Type `adj` on new line:**
   - Should suggest: `adjustTimeStep`
   - Insert should add: `adjustTimeStep  yes;`

2. **Type `purge`:**
   - Should suggest: `purgeWrite`
   - Should show description in suggestion detail

3. **Type `time`:**
   - Should suggest multiple: `startTime`, `endTime`, `deltaT`, `timeFormat`, `timePrecision`, etc.
   - Suggestions should be sorted by relevance

4. **In fvSchemes, type `ddt`:**
   - Should suggest: `ddtSchemes`
   - Should insert with block template if applicable

**Pass Criteria:**
- [ ] Completions appear while typing
- [ ] Completions show descriptions
- [ ] Inserted text includes proper formatting
- [ ] Context-aware (control keywords in controlDict, scheme keywords in fvSchemes)

### Test 4: Scheme Keywords

**File:** `examples/fvSchemes`

Test completions and hovers:

1. **Hover over `Gauss`:**
   - Should show: "Gauss integration scheme"
   - Should mention it requires interpolation scheme

2. **Hover over `linearUpwind`:**
   - Should show: "Second-order upwind scheme"
   - Should show gradScheme parameter

3. **Type `van` in divSchemes block:**
   - Should suggest: `vanLeer`
   - Should show: "Van Leer TVD scheme"

**Pass Criteria:**
- [ ] Scheme keywords recognized
- [ ] Hover shows scheme descriptions
- [ ] Completions suggest appropriate schemes

### Test 5: Solver Keywords

**File:** `examples/fvSolution`

Test solver-related keywords:

1. **Hover over `GAMG`:**
   - Should show: solver type description
   - May show parameters

2. **Hover over `tolerance`:**
   - Should show: "Absolute convergence tolerance"
   - Should show it's a scalar value

3. **Type `smooth` in solver block:**
   - Should suggest: `smoother`, `smoothSolver`

**Pass Criteria:**
- [ ] Solver keywords recognized
- [ ] Parameters documented
- [ ] Appropriate completions suggested

### Test 6: Boundary Conditions

**File:** `examples/U`

Test boundary condition keywords:

1. **Hover over `fixedValue`:**
   - Should show: "Fixed (Dirichlet) boundary condition"
   - Should show value parameter

2. **Hover over `zeroGradient`:**
   - Should show: "Zero gradient (Neumann) boundary condition"

3. **Type `inlet` in boundaryField:**
   - Should suggest: `inletOutlet`

**Pass Criteria:**
- [ ] Boundary condition types recognized
- [ ] Hover shows BC descriptions
- [ ] Completions suggest BC keywords

### Test 7: Language Server Status

**Check server is running:**

1. View → Output
2. Select "OpenFOAM Language Server" from dropdown
3. Should see startup message: "OpenFOAM Language Server ready with 2990 keywords"

**Pass Criteria:**
- [ ] Language server starts without errors
- [ ] Shows keyword count (2990)
- [ ] No error messages in output

### Test 8: Command Palette

**Test the refresh command:**

1. Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Win/Linux)
2. Type "OpenFOAM"
3. Should see: "OpenFOAM: Refresh Keyword Database"
4. Select it
5. Enter a path (or cancel)

**Pass Criteria:**
- [ ] Command appears in palette
- [ ] Command shows input prompt
- [ ] Can cancel without errors

## Advanced Tests

### Test 9: File Pattern Activation

Test that extension activates for various file patterns:

1. Create file named `testDict` → Should activate
2. Create file named `test.foam` → Should activate
3. Create file named `transportProperties` → Should activate
4. Create file with `.dict` extension → Should activate

**Pass Criteria:**
- [ ] Extension activates for all supported patterns
- [ ] Syntax highlighting works for all file types

### Test 10: Multi-file Testing

Open multiple OpenFOAM files simultaneously:

1. Open `controlDict`, `fvSchemes`, `fvSolution` in different tabs
2. Switch between tabs
3. Test hover/completion in each

**Pass Criteria:**
- [ ] Language server works across all tabs
- [ ] No performance degradation
- [ ] Context-appropriate suggestions in each file

### Test 11: Large File Performance

Open the keyword database JSON to test:

```bash
# In Extension Development Host
# Open: data/openfoam-keywords.json (669KB, 2990 entries)
```

**Pass Criteria:**
- [ ] File opens without lag
- [ ] Scrolling is smooth
- [ ] No memory issues

## Debugging Tests

### Test 12: Debug Extension

1. Set breakpoint in `src/extension.ts` at `activate()` function
2. Press F5
3. Breakpoint should hit
4. Step through code

**Pass Criteria:**
- [ ] Breakpoint hits
- [ ] Can inspect variables
- [ ] Can step through code

### Test 13: Debug Language Server

1. In `src/extension.ts`, uncomment `--inspect` in debugOptions
2. Launch extension with F5
3. Open Chrome: `chrome://inspect`
4. Find and attach to language server process

**Pass Criteria:**
- [ ] Server process appears in Chrome inspector
- [ ] Can attach debugger
- [ ] Can set breakpoints in server.ts

## Troubleshooting During Tests

### Issue: Extension Doesn't Activate

**Check:**
```bash
# Verify compiled files exist
ls -la out/extension.js
ls -la out/language-server/server.js
```

**Fix:** Run `npm run compile` again

### Issue: No Hover/Completion

**Check:**
1. View → Output → "OpenFOAM Language Server"
2. Look for errors or "keyword database not found"

**Fix:**
```bash
# Verify keyword database exists
ls -lh data/openfoam-keywords.json

# If missing, regenerate:
npm run extract-keywords
```

### Issue: Syntax Highlighting Not Working

**Check:**
1. Look at bottom-right corner of VS Code
2. Verify language is set to "OpenFOAM"

**Fix:** 
- Click language selector → choose "OpenFOAM"
- Or add `// OpenFOAM` comment at top of file

### Issue: No Suggestions

**Check:**
1. Trigger manually with `Ctrl+Space`
2. Check Output panel for errors

**Fix:**
- Restart extension host window
- Reload VS Code window

## Performance Benchmarks

Expected performance:

- **Startup:** < 2 seconds
- **Keyword DB load:** < 1 second
- **Hover response:** < 100ms
- **Completion trigger:** < 200ms
- **File open:** < 500ms

## Test Results Checklist

After testing, you should have:

- [ ] ✅ Syntax highlighting works
- [ ] ✅ Hover shows documentation for 10+ keywords
- [ ] ✅ Completions suggest relevant keywords
- [ ] ✅ Language server starts and loads 2990 keywords
- [ ] ✅ All example files display correctly
- [ ] ✅ No errors in console or output
- [ ] ✅ Extension activates for all file patterns
- [ ] ✅ Refresh command works
- [ ] ✅ Debugging works

## Next Steps After Testing

### If All Tests Pass: ✅

1. **Package for distribution:**
   ```bash
   npm install -g @vscode/vsce
   vsce package
   ```

2. **Install on other machines:**
   - Share the `.vsix` file
   - Install via: Extensions → ... → Install from VSIX

3. **Customize:**
   - Add more keywords in `extractKeywords.ts`
   - Enhance syntax highlighting
   - Extend language server features

### If Tests Fail: ⚠️

1. Check console for errors: Help → Toggle Developer Tools
2. Review Output panel: "OpenFOAM Language Server"
3. Verify build: `npm run compile`
4. Check file paths are correct
5. Consult QUICKSTART.md or README.md troubleshooting sections

## Quick Test Script

Run this script to do a basic verification:

```bash
#!/bin/bash
cd /Users/arefmoalemi/Downloads/OpenFOAM-13-master/openfoam-vscode-extension

echo "=== OpenFOAM Extension Quick Verification ==="
echo ""

echo "✓ Checking compiled files..."
test -f out/extension.js && echo "  ✅ extension.js exists" || echo "  ❌ extension.js missing"
test -f out/language-server/server.js && echo "  ✅ server.js exists" || echo "  ❌ server.js missing"

echo ""
echo "✓ Checking keyword database..."
test -f data/openfoam-keywords.json && echo "  ✅ Keywords DB exists" || echo "  ❌ Keywords DB missing"
if [ -f data/openfoam-keywords.json ]; then
    size=$(wc -c < data/openfoam-keywords.json)
    echo "  📊 Database size: $size bytes"
fi

echo ""
echo "✓ Checking example files..."
for file in controlDict fvSchemes fvSolution U; do
    test -f examples/$file && echo "  ✅ $file exists" || echo "  ❌ $file missing"
done

echo ""
echo "✓ Checking grammar..."
test -f syntaxes/openfoam.tmLanguage.json && echo "  ✅ Grammar exists" || echo "  ❌ Grammar missing"

echo ""
echo "=== Ready to test! Press F5 in VS Code ==="
```

Save this as `test-verification.sh` and run it before testing.

---

## Summary

This extension is **ready for testing**. The quickest way to verify:

1. Open extension folder in VS Code
2. Press F5
3. Open `examples/controlDict`
4. Hover over `deltaT`
5. Type `max` to see completions

**If those work, the extension is functioning correctly!** ✅

For detailed testing of all features, follow the test cases above.
