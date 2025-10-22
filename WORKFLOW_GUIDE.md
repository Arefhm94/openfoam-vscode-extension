# OpenFOAM Case Workflow Visualizer

## Overview

The **OpenFOAM Case Workflow Visualizer** provides an interactive, node-based visual interface for understanding and managing OpenFOAM case files. Similar to n8n or node-red, it helps you see the complete case structure at a glance and understand relationships between different configuration files.

## Features

### 🎯 Visual Case Overview

- **Node-Based Interface**: Each OpenFOAM file is represented as a draggable node
- **Color-Coded Status**:
  - Green border = File exists and is valid
  - Orange border = File is missing
  - Gray = File not scanned yet
- **Category Labels**: System files, constant files, and field files are clearly labeled

### 📁 Auto-Discovery

- Automatically scans your workspace for OpenFOAM case structure
- Detects:
  - `system/` directory files (controlDict, fvSchemes, fvSolution, etc.)
  - `constant/` directory files (transportProperties, turbulenceProperties, etc.)
  - Time directories (0/, 0.001/, etc.)
  - Boundary condition files

### 🔍 File Management

- **Quick Open**: Click "Open" button on any node to view the file in editor
- **Drag & Arrange**: Organize nodes to match your mental model
- **Real-time Status**: Visual indicators show which files exist and which are missing

## How to Use

### 1. Open the Workflow Viewer

There are several ways to open the workflow visualizer:

**Method 1: Command Palette**

1. Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
2. Type "OpenFOAM: Open Case Workflow"
3. Press Enter

**Method 2: Quick Access**

- The command appears in the command palette when you have an OpenFOAM workspace open

### 2. Scan Your Case

1. Click the **"Scan Case"** button in the toolbar
2. The extension will automatically discover your OpenFOAM case structure
3. Nodes will appear for each discovered file

### 3. Interact with Nodes

**View File Information:**

- Each node shows:
  - File name (e.g., "controlDict")
  - Category (e.g., "system", "constant")
  - Status (exists or missing)

**Open Files:**

- Click the "Open" button on any existing file node
- The file will open in the VS Code editor

**Organize Layout:**

- Drag nodes to arrange them logically
- Create your own visual organization

### 4. Validate Case (Coming Soon)

Click **"Validate Case"** to check for:

- Missing required files
- Inconsistent settings
- Invalid configurations

## Visual Guide

```
┌─────────────────────────────────────────┐
│ [Scan Case] [Validate] [Refresh]        │ ← Toolbar
├─────────────────────────────────────────┤
│                                         │
│  ┌──────────────┐    ┌──────────────┐  │
│  │ controlDict  │    │  fvSchemes   │  │
│  │   SYSTEM     │    │   SYSTEM     │  │
│  │ ✓ File exists│    │ ✓ File exists│  │
│  │   [Open]     │    │   [Open]     │  │
│  └──────────────┘    └──────────────┘  │
│                                         │
│  ┌──────────────┐    ┌──────────────┐  │
│  │ fvSolution   │    │decomposeParDict│
│  │   SYSTEM     │    │   SYSTEM     │  │
│  │ ✓ File exists│    │ ⚠ Missing    │  │
│  │   [Open]     │    │              │  │
│  └──────────────┘    └──────────────┘  │
│                                         │
└─────────────────────────────────────────┘
```

## Roadmap

### Phase 1: Foundation ✅ (Current)

- [x] Basic workflow panel
- [x] Case file discovery
- [x] Node-based visualization
- [x] File opening from nodes
- [x] Draggable nodes

### Phase 2: Enhanced Visualization (Next)

- [ ] Connection lines showing file dependencies
- [ ] Expandable nodes with parameter details
- [ ] Mini-map for large cases
- [ ] Node grouping by category
- [ ] Search and filter nodes

### Phase 3: Deep Integration

- [ ] Real-time file parsing
- [ ] Parameter validation
- [ ] Dependency analysis
- [ ] Solver workflow tracking
- [ ] Field relationship mapping

### Phase 4: Interactive Editing

- [ ] In-node parameter editing
- [ ] Template-based file generation
- [ ] Drag-and-drop file creation
- [ ] Copy/paste between cases

### Phase 5: Workflow Automation

- [ ] Case setup wizards
- [ ] Pre-flight checks
- [ ] Batch operations
- [ ] Custom workflows
- [ ] Integration with OpenFOAM utilities

## Examples

### Typical Case Layout

When you open a standard OpenFOAM case, you'll see nodes for:

**System Directory:**

- controlDict - Simulation control parameters
- fvSchemes - Discretization schemes
- fvSolution - Solution and algorithm controls
- decomposeParDict - Parallel decomposition settings

**Constant Directory:**

- transportProperties - Physical properties
- turbulenceProperties - Turbulence model settings
- thermophysicalProperties - Thermal properties

**Time Directories:**

- 0/U - Initial velocity field
- 0/p - Initial pressure field
- 0/k, 0/epsilon, 0/omega - Turbulence fields

### Missing Files

Files that should exist but don't will be shown with:

- Orange/warning border color
- "⚠ Missing" status text
- Reduced opacity
- No "Open" button

## Tips

1. **Start with Scan**: Always click "Scan Case" after opening the workflow viewer

2. **Organize Your View**: Drag nodes to create a layout that makes sense for your workflow. Common organizations:
   - Left to right: System → Constant → Fields
   - Top to bottom: Input → Processing → Output
   - By solver stage: Setup → Initialization → Solution

3. **Quick Navigation**: Use the workflow as a visual sitemap to quickly jump between files

4. **Spot Missing Files**: Orange-bordered nodes immediately show what's missing from your case

## Technical Details

### Supported Files

The workflow visualizer currently recognizes these OpenFOAM files:

**System Directory:**

- controlDict, fvSchemes, fvSolution
- decomposeParDict, blockMeshDict
- snappyHexMeshDict, refineMeshDict
- And more...

**Constant Directory:**

- All \*Properties files
- All \*Dict files
- Mesh-related files

**Time Directories:**

- All field files (U, p, T, k, epsilon, omega, etc.)

### File Detection

The extension uses several methods to detect OpenFOAM files:

1. Standard OpenFOAM naming conventions
2. Directory structure (system/, constant/, 0/, etc.)
3. File content analysis (FoamFile header)

## Troubleshooting

**Problem**: "No files showing after scan"

- **Solution**: Make sure you have an OpenFOAM case open in your workspace
- Check that you have system/ and/or constant/ directories

**Problem**: "Nodes not draggable"

- **Solution**: Click and hold on the node header to drag

**Problem**: "Case structure not detected"

- **Solution**: Click "Refresh" button to rescan
- Ensure your workspace folder contains a valid OpenFOAM case

## Future Enhancements

We're working on exciting features including:

- **Smart Validation**: AI-powered case validation and suggestions
- **Visual Dependencies**: Lines connecting related files and parameters
- **Parameter Inspector**: Expandable nodes showing all parameters
- **Quick Edit**: Edit common parameters directly in the workflow
- **Templates**: Pre-configured case templates and workflows
- **Export/Import**: Save and share workflow layouts

## Feedback

This is a new feature and we'd love your feedback!

Please report issues or suggest features on our GitHub repository.

---

**Note**: This is Phase 1 of the workflow visualizer. More features are coming soon!
