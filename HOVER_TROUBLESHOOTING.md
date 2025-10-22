# Hover Information Troubleshooting

If hover information is not showing when you move your mouse over OpenFOAM keywords, follow these steps:

## Step 1: Verify Extension is Installed

1. Press `Cmd+Shift+X` to open Extensions view
2. Search for "OpenFOAM"
3. Verify "OpenFOAM Dictionary Support" is installed and enabled

## Step 2: Set Language Mode

OpenFOAM dictionary files (like `controlDict`, `fvSchemes`, `fvSolution`, etc.) often don't have file extensions, so VS Code may not automatically recognize them as OpenFOAM files.

### Method 1: Using Command Palette

1. Open an OpenFOAM file (e.g., `controlDict`)
2. Press `Cmd+Shift+P` to open Command Palette
3. Type "OpenFOAM: Set Language Mode" and select it
4. Or type "Change Language Mode" and select "OpenFOAM"

### Method 2: Using Status Bar

1. Look at the bottom-right corner of VS Code
2. Click on the language indicator (it might say "Plain Text")
3. Select "OpenFOAM" from the list

### Method 3: Automatic File Association (Recommended)

Add this to your VS Code settings (`Cmd+,` then click "Open Settings (JSON)"):

```json
{
  "files.associations": {
    "**/controlDict*": "openfoam",
    "**/fvSchemes*": "openfoam",
    "**/fvSolution*": "openfoam",
    "**/blockMeshDict*": "openfoam",
    "**/snappyHexMeshDict*": "openfoam",
    "**/decomposeParDict*": "openfoam",
    "**/*Properties": "openfoam",
    "**/*Dict": "openfoam",
    "*.foam": "openfoam",
    "*.dict": "openfoam"
  }
}
```

## Step 3: Reload VS Code

After installing or updating the extension:

1. Press `Cmd+Shift+P`
2. Type "Developer: Reload Window"
3. Press Enter

## Step 4: Test Hover

1. Open an OpenFOAM file (e.g., `examples/controlDict`)
2. Verify the language mode shows "OpenFOAM" in bottom-right corner
3. Hover your mouse over keywords like:
   - `application`
   - `startFrom`
   - `deltaT`
   - `writeInterval`

You should now see detailed information about each keyword!

## Step 5: Check Language Server Status

1. Go to **View → Output** (`Cmd+Shift+U`)
2. Select "OpenFOAM Language Server" from the dropdown
3. You should see messages like:
   ```
   Initializing OpenFOAM Language Server...
   Loading 3072 keywords from database...
   OpenFOAM Language Server ready with 3072 keywords
   ```

## Still Not Working?

### Enable Verbose Logging

1. Open VS Code settings (`Cmd+,`)
2. Search for "openfoam trace"
3. Set "Openfoam: Trace Server" to "verbose"
4. Reload window and check Output panel again

### Common Issues

**Issue**: File shows as "Plain Text"

- **Solution**: Use Method 3 above to add file associations

**Issue**: Extension not activating

- **Solution**: Make sure you have at least one OpenFOAM file open with language mode set to "OpenFOAM"

**Issue**: Hover shows nothing

- **Solution**: Make sure the keyword exists in the database (3072 keywords loaded). Try common keywords like `application`, `solver`, `relaxationFactors`

**Issue**: Language server not starting

- **Solution**: Check the Output panel for errors. The extension needs the keyword database at `out/data/openfoam-keywords.json`

## Need Help?

If you're still having issues, please open an issue on GitHub with:

1. VS Code version
2. Extension version
3. Output from "OpenFOAM Language Server" panel
4. Screenshot showing the language mode in bottom-right corner
