import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

/**
 * OpenFOAM Workflow Panel - Visual node-based case management
 */
export class WorkflowPanel {
  public static currentPanel: WorkflowPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _caseDirectory: string | undefined;

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    // Set the webview's initial html content
    this._update();

    // Listen for when the panel is disposed
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.command) {
          case "scanCase":
            this._scanCase();
            return;
          case "openFile":
            this._openFile(message.filePath);
            return;
          case "validateCase":
            this._validateCase();
            return;
          case "editParameters":
            this._editParameters(
              message.filePath,
              message.parameters,
              message.fileName,
            );
            return;
          case "saveParameter":
            this._saveParameter(
              message.filePath,
              message.key,
              message.value,
              message.fileName,
            );
            return;
        }
      },
      null,
      this._disposables,
    );
  }

  /**
   * Create or show the workflow panel
   */
  public static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // If we already have a panel, show it
    if (WorkflowPanel.currentPanel) {
      WorkflowPanel.currentPanel._panel.reveal(column);
      return;
    }

    // Otherwise, create a new panel
    const panel = vscode.window.createWebviewPanel(
      "openfoamWorkflow",
      "OpenFOAM Case Workflow",
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, "media"),
          vscode.Uri.joinPath(extensionUri, "out"),
        ],
      },
    );

    WorkflowPanel.currentPanel = new WorkflowPanel(panel, extensionUri);
  }

  /**
   * Scan the workspace for OpenFOAM case files
   */
  private async _scanCase() {
    // Try to find OpenFOAM case directory
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      vscode.window.showWarningMessage("No workspace folder open");
      return;
    }

    // Look for typical OpenFOAM case structure
    const rootPath = workspaceFolders[0].uri.fsPath;
    const caseData = await this._discoverCaseStructure(rootPath);

    // Send case data to webview
    this._panel.webview.postMessage({
      command: "caseData",
      data: caseData,
    });
  }

  /**
   * Discover OpenFOAM case structure
   */
  private async _discoverCaseStructure(
    rootPath: string,
  ): Promise<CaseStructure> {
    const caseStructure: CaseStructure = {
      rootPath,
      directories: {
        system: this._scanDirectory(path.join(rootPath, "system")),
        constant: this._scanDirectory(path.join(rootPath, "constant")),
        timeDirectories: this._findTimeDirectories(rootPath),
      },
      files: {},
    };

    // Scan for key system files
    const systemFiles = [
      "controlDict",
      "fvSchemes",
      "fvSolution",
      "decomposeParDict",
      "setFieldsDict",
      "blockMeshDict",
      "helyxHexMeshDict",
      "caseSetupDict",
      "fvOptions",
      "topoSetDict",
      "mapFieldsDict",
      "sampleDict",
      "surfaceFeatureExtractDict",
      "materialProperties",
    ];

    // Scan for constant files
    const constantFiles = [
      "transportProperties",
      "turbulenceProperties",
      "thermophysicalProperties",
      "phaseProperties",
      "g",
      "momentumTransport",
      "dynamicMeshDict",
      "RASProperties",
      "regionProperties",
    ];

    // Add physical properties files
    const constantDir = path.join(rootPath, "constant");
    if (fs.existsSync(constantDir)) {
      const constantEntries = fs.readdirSync(constantDir);
      constantEntries.forEach((entry) => {
        if (entry.startsWith("physicalProperties")) {
          constantFiles.push(entry);
        }
      });
    }

    for (const file of systemFiles) {
      const filePath = path.join(rootPath, "system", file);
      if (fs.existsSync(filePath)) {
        caseStructure.files[file] = {
          path: filePath,
          category: "system",
          exists: true,
          content: await this._parseFile(filePath),
        };
      } else {
        caseStructure.files[file] = {
          path: filePath,
          category: "system",
          exists: false,
        };
      }
    }

    for (const file of constantFiles) {
      const filePath = path.join(rootPath, "constant", file);
      if (fs.existsSync(filePath)) {
        caseStructure.files[file] = {
          path: filePath,
          category: "constant",
          exists: true,
          content: await this._parseFile(filePath),
        };
      } else {
        caseStructure.files[file] = {
          path: filePath,
          category: "constant",
          exists: false,
        };
      }
    }

    // Scan boundary condition files from time directories
    await this._scanBoundaryConditions(caseStructure, rootPath);

    return caseStructure;
  }

  /**
   * Scan boundary condition files from time directories
   */
  private async _scanBoundaryConditions(
    caseStructure: CaseStructure,
    rootPath: string,
  ) {
    const timeDirs = caseStructure.directories.timeDirectories;

    // Use the first time directory (usually "0") for boundary conditions
    const boundaryDir = timeDirs.length > 0 ? timeDirs[0] : "0";
    const boundaryPath = path.join(rootPath, boundaryDir);

    if (fs.existsSync(boundaryPath)) {
      const boundaryFiles = fs.readdirSync(boundaryPath).filter((file) => {
        const filePath = path.join(boundaryPath, file);
        const stat = fs.statSync(filePath);
        return stat.isFile() && !file.startsWith(".");
      });

      for (const file of boundaryFiles) {
        const filePath = path.join(boundaryPath, file);
        const fileKey = `${boundaryDir}/${file}`;
        caseStructure.files[fileKey] = {
          path: filePath,
          category: "boundary",
          exists: true,
          content: await this._parseFile(filePath),
        };
      }
    }
  }

  /**
   * Scan a directory for files
   */
  private _scanDirectory(dirPath: string): string[] {
    try {
      if (fs.existsSync(dirPath)) {
        return fs.readdirSync(dirPath).filter((file) => {
          const stat = fs.statSync(path.join(dirPath, file));
          return stat.isFile();
        });
      }
    } catch (error) {
      console.error(`Error scanning directory ${dirPath}:`, error);
    }
    return [];
  }

  /**
   * Find time directories (0, 0.001, etc.)
   */
  private _findTimeDirectories(rootPath: string): string[] {
    try {
      const entries = fs.readdirSync(rootPath);
      return entries
        .filter((entry) => {
          const entryPath = path.join(rootPath, entry);
          const stat = fs.statSync(entryPath);
          // Time directories are numeric or "0"
          return stat.isDirectory() && /^\d+(\.\d+)?$/.test(entry);
        })
        .sort((a, b) => parseFloat(a) - parseFloat(b));
    } catch (error) {
      console.error("Error finding time directories:", error);
      return [];
    }
  }

  /**
   * Parse OpenFOAM dictionary file
   */
  private async _parseFile(filePath: string): Promise<any> {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const parsed = this._parseOpenFOAMDictionary(content);
      return {
        raw: content,
        lines: content.split("\n").length,
        parameters: parsed.parameters,
        foamFile: parsed.foamFile,
      };
    } catch (error) {
      console.error(`Error parsing file ${filePath}:`, error);
      return {
        raw: "",
        lines: 0,
        parameters: {},
        foamFile: {},
      };
    }
  }

  /**
   * Parse OpenFOAM dictionary content
   */
  private _parseOpenFOAMDictionary(content: string): {
    parameters: any;
    foamFile: any;
  } {
    const lines = content.split("\n");
    const parameters: any = {};
    const foamFile: any = {};
    let inFoamFile = false;
    let inParameterBlock = false;
    let currentBlock = "";
    let braceCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Skip comments and empty lines
      if (
        line.startsWith("//") ||
        line.startsWith("/*") ||
        line === "" ||
        line.startsWith("*")
      ) {
        continue;
      }

      // Handle FoamFile block
      if (line === "FoamFile") {
        inFoamFile = true;
        continue;
      }
      if (inFoamFile && line === "{") {
        continue;
      }
      if (inFoamFile && line === "}") {
        inFoamFile = false;
        continue;
      }
      if (inFoamFile) {
        const match = line.match(/^(\w+)\s+(.+);$/);
        if (match) {
          foamFile[match[1]] = match[2].replace(/["']/g, "");
        }
        continue;
      }

      // Handle parameter blocks
      if (line.includes("{") && !line.includes("}")) {
        inParameterBlock = true;
        const key = line.split("{")[0].trim();
        if (key) {
          currentBlock = key;
          parameters[currentBlock] = "block defined";
        }
        braceCount =
          (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
        continue;
      }

      if (inParameterBlock) {
        braceCount += (line.match(/{/g) || []).length;
        braceCount -= (line.match(/}/g) || []).length;

        if (braceCount <= 0) {
          inParameterBlock = false;
          currentBlock = "";
          continue;
        }
        continue;
      }

      // Handle top-level parameters
      const match = line.match(/^(\w+)\s+(.+);$/);
      if (match) {
        const key = match[1];
        let value: any = match[2].trim();

        // Handle different value types
        if (value.startsWith("(") && value.endsWith(")")) {
          value = value.slice(1, -1).split(/\s+/);
        } else if (value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        } else if (value.startsWith("$")) {
          value = { reference: value.substring(1) };
        } else if (!isNaN(Number(value))) {
          value = Number(value);
        }

        parameters[key] = value;
      }
    }

    return { parameters, foamFile };
  }

  /**
   * Open a file in the editor
   */
  private async _openFile(filePath: string) {
    try {
      const doc = await vscode.workspace.openTextDocument(filePath);
      await vscode.window.showTextDocument(doc);
    } catch (error) {
      vscode.window.showErrorMessage(`Could not open file: ${filePath}`);
    }
  }

  /**
   * Validate case structure and settings
   */
  private async _validateCase() {
    // TODO: Implement validation logic
    vscode.window.showInformationMessage("Case validation coming soon!");
  }

  /**
   * Edit parameters for a file
   */
  private async _editParameters(
    filePath: string,
    parameters: any,
    fileName: string,
  ) {
    // Create a simple parameter editor
    const parameterItems = Object.entries(parameters)
      .map(([key, value]) => {
        return `${key}: ${this._formatParameterValue(value)}`;
      })
      .join("\n");

    const newValue = await vscode.window.showInputBox({
      prompt: `Edit parameters for ${fileName}`,
      value: parameterItems,
      placeHolder: "Enter parameters in key: value format, one per line",
      ignoreFocusOut: true,
    });

    if (newValue !== undefined) {
      // Parse the new parameters and save to file
      await this._saveParametersToFile(filePath, newValue);
      // Refresh the case data
      this._scanCase();
    }
  }

  /**
   * Format parameter value for display
   */
  private _formatParameterValue(value: any): string {
    if (Array.isArray(value)) {
      return `(${value.join(" ")})`;
    } else if (typeof value === "object" && value.reference) {
      return `$${value.reference}`;
    } else {
      return String(value);
    }
  }

  /**
   * Save parameters to file
   */
  private async _saveParametersToFile(filePath: string, parameterText: string) {
    try {
      // This is a simplified implementation - in a real scenario you'd want to
      // properly reconstruct the OpenFOAM file format
      const lines = parameterText.split("\n");
      let content = "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          const [key, ...valueParts] = trimmed.split(":");
          if (key && valueParts.length > 0) {
            const value = valueParts.join(":").trim();
            content += `${key}    ${value};\n`;
          }
        }
      }

      // Read original file to preserve header
      const originalContent = fs.readFileSync(filePath, "utf-8");
      const headerEnd = originalContent.indexOf(
        "// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //",
      );
      const header =
        headerEnd !== -1 ? originalContent.substring(0, headerEnd + 80) : "";

      const newContent =
        header +
        "\n" +
        content +
        "\n// ************************************************************************* //\n";

      fs.writeFileSync(filePath, newContent);
      vscode.window.showInformationMessage(
        `Parameters saved to ${path.basename(filePath)}`,
      );
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to save parameters: ${error}`);
    }
  }

  /**
   * Save a single parameter to file
   */
  private async _saveParameter(
    filePath: string,
    key: string,
    value: string,
    fileName: string,
  ) {
    try {
      // Read the file
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      let updated = false;

      // Find and update the parameter
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const match = line.match(/^(\w+)\s+(.+);$/);
        if (match && match[1] === key) {
          const indent = lines[i].match(/^\s*/)?.[0] || "";
          lines[i] = `${indent}${key}    ${value};`;
          updated = true;
          break;
        }
      }

      if (updated) {
        fs.writeFileSync(filePath, lines.join("\n"));
        vscode.window.showInformationMessage(`Updated ${key} in ${fileName}`);
        // Refresh the case view
        this._scanCase();
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to save parameter: ${error}`);
    }
  }

  /**
   * Update the webview content
   */
  private _update() {
    const webview = this._panel.webview;
    this._panel.title = "OpenFOAM Case Workflow";
    this._panel.webview.html = this._getHtmlForWebview(webview);
  }

  /**
   * Generate HTML for the webview
   */
  private _getHtmlForWebview(webview: vscode.Webview) {
    // Use a nonce to only allow specific scripts to run
    const nonce = getNonce();

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
      <title>OpenFOAM Case Workflow</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        body {
          font-family: var(--vscode-font-family);
          color: var(--vscode-foreground);
          background-color: var(--vscode-editor-background);
          font-size: 13px;
        }
        #container {
          width: 100%;
          height: 100vh;
          display: flex;
          flex-direction: column;
        }
        #toolbar {
          padding: 8px 12px;
          background-color: var(--vscode-sideBar-background);
          border-bottom: 1px solid var(--vscode-panel-border);
          display: flex;
          gap: 8px;
          align-items: center;
        }
        #toolbar h3 {
          margin: 0;
          font-size: 14px;
          font-weight: 600;
          flex: 1;
          color: var(--vscode-foreground);
        }
        button {
          background-color: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          padding: 5px 12px;
          cursor: pointer;
          border-radius: 3px;
          font-size: 12px;
          transition: background-color 0.1s;
        }
        button:hover {
          background-color: var(--vscode-button-hoverBackground);
        }
        #canvas {
          flex: 1;
          position: relative;
          overflow: auto;
          padding: 20px;
          background-color: var(--vscode-editor-background);
          background-image: radial-gradient(circle, var(--vscode-panel-border) 1px, transparent 1px);
          background-size: 20px 20px;
        }
        .branch-container {
          position: absolute;
          display: flex;
          flex-direction: column;
        }
        .branch-header {
          font-weight: 600;
          font-size: 11px;
          color: var(--vscode-descriptionForeground);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 10px;
          padding: 6px 12px;
          background-color: var(--vscode-sideBar-background);
          border-left: 3px solid var(--vscode-textLink-foreground);
          border-radius: 3px;
          text-align: left;
        }
        .nodes-container {
          display: flex;
          flex-direction: column;
        }
        .node {
          background-color: var(--vscode-sideBar-background);
          border: 1px solid var(--vscode-panel-border);
          border-radius: 4px;
          padding: 8px 10px;
          width: 100%;
          box-shadow: 0 1px 3px rgba(0,0,0,0.12);
          transition: box-shadow 0.2s;
        }
        .node:hover {
          box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        }
        .node.missing {
          border-color: var(--vscode-editorWarning-foreground);
          opacity: 0.5;
        }
        .node.valid {
          border-left: 3px solid var(--vscode-terminal-ansiGreen);
        }
        .node-header {
          font-weight: 600;
          font-size: 13px;
          margin-bottom: 4px;
          color: var(--vscode-foreground);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .node-category {
          font-size: 10px;
          color: var(--vscode-descriptionForeground);
          text-transform: uppercase;
          letter-spacing: 0.3px;
          opacity: 0.7;
        }
        .node-content {
          font-size: 12px;
          color: var(--vscode-descriptionForeground);
        }
        .node-actions {
          margin-top: 6px;
          display: flex;
          gap: 6px;
          padding-top: 6px;
          border-top: 1px solid var(--vscode-panel-border);
        }
        .node-actions button {
          font-size: 11px;
          padding: 3px 8px;
          flex: 1;
        }
        .parameter-details {
          margin-top: 6px;
          padding: 6px;
          background-color: rgba(0, 0, 0, 0.15);
          border-radius: 3px;
          max-height: 180px;
          overflow-y: auto;
          font-size: 11px;
        }
        .parameter-details::-webkit-scrollbar {
          width: 6px;
        }
        .parameter-details::-webkit-scrollbar-thumb {
          background: var(--vscode-scrollbarSlider-background);
          border-radius: 3px;
        }
        .parameter-item {
          margin-bottom: 3px;
          line-height: 1.4;
          word-break: break-word;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .parameter-item strong {
          color: var(--vscode-textLink-foreground);
          font-weight: 500;
          min-width: fit-content;
        }
        .parameter-item input {
          flex: 1;
          background: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          border: 1px solid var(--vscode-input-border);
          border-radius: 2px;
          padding: 2px 4px;
          font-size: 11px;
          font-family: var(--vscode-font-family);
        }
        .parameter-item input:focus {
          outline: 1px solid var(--vscode-focusBorder);
        }
        .parameter-value {
          flex: 1;
          color: var(--vscode-descriptionForeground);
        }
        .param-count {
          font-size: 11px;
          color: var(--vscode-descriptionForeground);
          margin-bottom: 4px;
          opacity: 0.8;
        }

        #welcome {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          text-align: center;
        }
        #welcome h2 {
          margin-bottom: 12px;
          font-size: 18px;
          font-weight: 600;
        }
        #welcome p {
          color: var(--vscode-descriptionForeground);
          font-size: 13px;
        }
      </style>
    </head>
    <body>
      <div id="container">
        <div id="toolbar">
          <h3>🌊 OpenFOAM Case Structure</h3>
          <button id="scanBtn">Scan</button>
          <button id="refreshBtn">Refresh</button>
        </div>
        <div id="canvas">
          <div id="welcome">
            <h2>OpenFOAM Case Visualizer</h2>
            <p>Click "Scan" to analyze your case structure</p>
          </div>
        </div>
      </div>

      <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        
        // Toolbar actions
        document.getElementById('scanBtn').addEventListener('click', () => {
          vscode.postMessage({ command: 'scanCase' });
        });

        document.getElementById('refreshBtn').addEventListener('click', () => {
          vscode.postMessage({ command: 'scanCase' });
        });

        // Handle messages from extension
        window.addEventListener('message', event => {
          const message = event.data;
          
          switch (message.command) {
            case 'caseData':
              renderCaseWorkflow(message.data);
              break;
          }
        });

        // Render the case workflow
        function renderCaseWorkflow(caseData) {
          const canvas = document.getElementById('canvas');
          const welcome = document.getElementById('welcome');
          
          if (welcome) {
            welcome.remove();
          }
          
          canvas.innerHTML = '';
          
          console.log('Rendering case workflow with data:', caseData);
          
          // Create SVG for connections
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('width', '100%');
          svg.setAttribute('height', '100%');
          svg.style.position = 'absolute';
          svg.style.top = '0';
          svg.style.left = '0';
          svg.style.zIndex = '0';
          canvas.appendChild(svg);
          
          // Organize files by category
          const categories = {
            system: [],
            constant: [],
            boundary: [],
            other: []
          };
          
          for (const [fileName, fileInfo] of Object.entries(caseData.files)) {
            if (fileInfo.category === 'system') {
              categories.system.push({ fileName, fileInfo });
            } else if (fileInfo.category === 'constant') {
              categories.constant.push({ fileName, fileInfo });
            } else if (fileInfo.category === 'boundary') {
              categories.boundary.push({ fileName, fileInfo });
            } else {
              categories.other.push({ fileName, fileInfo });
            }
          }
          
          console.log('Categories:', categories);

          // Layout configuration - vertical columns
          const columnSpacing = 310;
          const startX = 20;
          const startY = 10;

          const branches = [
            { name: 'System', category: 'system', x: startX },
            { name: 'Constant', category: 'constant', x: startX + columnSpacing },
            { name: 'Boundary (0/)', category: 'boundary', x: startX + columnSpacing * 2 }
          ];
          
          // Create branch containers (vertical columns)
          branches.forEach((branch, branchIndex) => {
            const items = categories[branch.category];
            if (items.length === 0) return;
            
            console.log('Creating branch:', branch.name, 'with', items.length, 'items');
            
            // Create branch container
            const container = document.createElement('div');
            container.className = 'branch-container';
            container.style.left = branch.x + 'px';
            container.style.top = startY + 'px';
            container.style.position = 'absolute';
            container.style.width = '290px';
            canvas.appendChild(container);
            
            // Create branch header
            const header = document.createElement('div');
            header.className = 'branch-header';
            header.textContent = branch.name;
            container.appendChild(header);
            
            // Create nodes container
            const nodesContainer = document.createElement('div');
            nodesContainer.className = 'nodes-container';
            container.appendChild(nodesContainer);

            // Create nodes for this branch - stacked vertically
            items.forEach((item, index) => {
              const node = createNode(item.fileName, item.fileInfo, 0, 0, true);
              node.style.position = 'relative';
              node.style.left = '0';
              node.style.top = '0';
              node.style.marginBottom = '8px';
              node.style.cursor = 'default';
              nodesContainer.appendChild(node);
            });
          });
        }

        // Create a node element
        function createNode(fileName, fileInfo, x, y, showParams) {
          const node = document.createElement('div');
          node.className = 'node ' + (fileInfo.exists ? 'valid' : 'missing');
          node.style.left = x + 'px';
          node.style.top = y + 'px';
          node.dataset.fileName = fileName;
          node.dataset.filePath = fileInfo.path;

          const header = document.createElement('div');
          header.className = 'node-header';
          header.textContent = fileName;

          const content = document.createElement('div');
          content.className = 'node-content';

          if (fileInfo.exists && fileInfo.content && fileInfo.content.parameters) {
            const params = fileInfo.content.parameters;
            const paramCount = Object.keys(params).length;

            if (paramCount > 0) {
              // Show parameter count
              const countDiv = document.createElement('div');
              countDiv.className = 'param-count';
              countDiv.textContent = paramCount + ' parameter' + (paramCount !== 1 ? 's' : '');
              content.appendChild(countDiv);

              // Add parameter details with inline editing
              const paramDetails = document.createElement('div');
              paramDetails.className = 'parameter-details';

              for (const [key, value] of Object.entries(params)) {
                const paramDiv = document.createElement('div');
                paramDiv.className = 'parameter-item';
                
                const keySpan = document.createElement('strong');
                keySpan.textContent = key + ':';
                paramDiv.appendChild(keySpan);
                
                const valueInput = document.createElement('input');
                valueInput.type = 'text';
                valueInput.value = formatValue(value);
                valueInput.dataset.paramKey = key;
                valueInput.onclick = (e) => e.stopPropagation();
                
                valueInput.onblur = () => {
                  // Save parameter on blur
                  saveParameter(fileInfo.path, key, valueInput.value, fileName);
                };
                
                valueInput.onkeydown = (e) => {
                  if (e.key === 'Enter') {
                    valueInput.blur();
                  }
                  if (e.key === 'Escape') {
                    valueInput.value = formatValue(value);
                    valueInput.blur();
                  }
                };
                
                paramDiv.appendChild(valueInput);
                paramDetails.appendChild(paramDiv);
              }

              content.appendChild(paramDetails);
            } else {
              content.textContent = 'No parameters';
            }
          } else {
            content.textContent = fileInfo.exists
              ? 'No parameters'
              : '⚠ Missing';
          }

          const actions = document.createElement('div');
          actions.className = 'node-actions';

          if (fileInfo.exists) {
            const openBtn = document.createElement('button');
            openBtn.textContent = 'Open File';
            openBtn.onclick = (e) => {
              e.stopPropagation();
              vscode.postMessage({
                command: 'openFile',
                filePath: fileInfo.path
              });
            };
            actions.appendChild(openBtn);
          }

          node.appendChild(header);
          node.appendChild(content);
          node.appendChild(actions);

          return node;
        }

        // Save parameter value
        function saveParameter(filePath, key, value, fileName) {
          vscode.postMessage({
            command: 'saveParameter',
            filePath: filePath,
            key: key,
            value: value,
            fileName: fileName
          });
        }

        // Format parameter values for display
        // Format parameter values for display
        function formatValue(value) {
          if (Array.isArray(value)) {
            return '(' + value.join(' ') + ')';
          } else if (typeof value === 'object' && value.reference) {
            return '$' + value.reference;
          } else {
            return String(value);
          }
        }

        // Make nodes draggable

      </script>
    </body>
    </html>`;
  }

  public dispose() {
    WorkflowPanel.currentPanel = undefined;

    this._panel.dispose();

    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}

function getNonce() {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

// Type definitions
interface CaseStructure {
  rootPath: string;
  directories: {
    system: string[];
    constant: string[];
    timeDirectories: string[];
  };
  files: {
    [key: string]: FileInfo;
  };
}

interface FileInfo {
  path: string;
  category: string;
  exists: boolean;
  content?: any;
}
