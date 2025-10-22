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

    // Scan for key files
    const systemFiles = [
      "controlDict",
      "fvSchemes",
      "fvSolution",
      "decomposeParDict",
    ];
    const constantFiles = [
      "transportProperties",
      "turbulenceProperties",
      "thermophysicalProperties",
    ];

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
      }
    }

    return caseStructure;
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
      // Simple parsing - extract key information
      return {
        raw: content,
        lines: content.split("\n").length,
      };
    } catch (error) {
      console.error(`Error parsing file ${filePath}:`, error);
      return null;
    }
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
        body {
          padding: 0;
          margin: 0;
          font-family: var(--vscode-font-family);
          color: var(--vscode-foreground);
          background-color: var(--vscode-editor-background);
        }
        #container {
          width: 100%;
          height: 100vh;
          display: flex;
          flex-direction: column;
        }
        #toolbar {
          padding: 10px;
          background-color: var(--vscode-editor-background);
          border-bottom: 1px solid var(--vscode-panel-border);
          display: flex;
          gap: 10px;
        }
        button {
          background-color: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          padding: 6px 14px;
          cursor: pointer;
          border-radius: 2px;
        }
        button:hover {
          background-color: var(--vscode-button-hoverBackground);
        }
        #canvas {
          flex: 1;
          position: relative;
          overflow: auto;
        }
        .node {
          position: absolute;
          background-color: var(--vscode-editor-background);
          border: 2px solid var(--vscode-panel-border);
          border-radius: 8px;
          padding: 15px;
          min-width: 150px;
          cursor: move;
          box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        }
        .node.missing {
          border-color: var(--vscode-editorWarning-foreground);
          opacity: 0.6;
        }
        .node.valid {
          border-color: var(--vscode-terminal-ansiGreen);
        }
        .node-header {
          font-weight: bold;
          margin-bottom: 8px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .node-category {
          font-size: 0.8em;
          color: var(--vscode-descriptionForeground);
          text-transform: uppercase;
        }
        .node-content {
          font-size: 0.9em;
          color: var(--vscode-descriptionForeground);
        }
        .node-actions {
          margin-top: 10px;
          display: flex;
          gap: 5px;
        }
        .node-actions button {
          font-size: 0.8em;
          padding: 4px 8px;
        }
        .connection {
          position: absolute;
          pointer-events: none;
        }
        .connection-line {
          stroke: var(--vscode-panel-border);
          stroke-width: 2;
          fill: none;
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
          margin-bottom: 20px;
        }
      </style>
    </head>
    <body>
      <div id="container">
        <div id="toolbar">
          <button id="scanBtn">Scan Case</button>
          <button id="validateBtn">Validate Case</button>
          <button id="refreshBtn">Refresh</button>
        </div>
        <div id="canvas">
          <div id="welcome">
            <h2>🌊 OpenFOAM Case Workflow Visualizer</h2>
            <p>Click "Scan Case" to analyze your OpenFOAM case structure</p>
          </div>
        </div>
      </div>

      <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        
        // Toolbar actions
        document.getElementById('scanBtn').addEventListener('click', () => {
          vscode.postMessage({ command: 'scanCase' });
        });

        document.getElementById('validateBtn').addEventListener('click', () => {
          vscode.postMessage({ command: 'validateCase' });
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
          
          let x = 50, y = 50;
          const nodes = [];
          
          // Create nodes for each file
          for (const [fileName, fileInfo] of Object.entries(caseData.files)) {
            const node = createNode(fileName, fileInfo, x, y);
            canvas.appendChild(node);
            nodes.push({ element: node, x, y });
            
            y += 150;
            if (y > 600) {
              y = 50;
              x += 250;
            }
          }
          
          // Make nodes draggable
          nodes.forEach(nodeInfo => {
            makeDraggable(nodeInfo.element);
          });
        }

        // Create a node element
        function createNode(fileName, fileInfo, x, y) {
          const node = document.createElement('div');
          node.className = 'node ' + (fileInfo.exists ? 'valid' : 'missing');
          node.style.left = x + 'px';
          node.style.top = y + 'px';
          
          const header = document.createElement('div');
          header.className = 'node-header';
          header.textContent = fileName;
          
          const category = document.createElement('div');
          category.className = 'node-category';
          category.textContent = fileInfo.category;
          
          const content = document.createElement('div');
          content.className = 'node-content';
          content.textContent = fileInfo.exists 
            ? '✓ File exists' 
            : '⚠ Missing';
          
          const actions = document.createElement('div');
          actions.className = 'node-actions';
          
          if (fileInfo.exists) {
            const openBtn = document.createElement('button');
            openBtn.textContent = 'Open';
            openBtn.onclick = () => {
              vscode.postMessage({ 
                command: 'openFile', 
                filePath: fileInfo.path 
              });
            };
            actions.appendChild(openBtn);
          }
          
          node.appendChild(header);
          node.appendChild(category);
          node.appendChild(content);
          node.appendChild(actions);
          
          return node;
        }

        // Make nodes draggable
        function makeDraggable(element) {
          let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
          
          element.onmousedown = dragMouseDown;
          
          function dragMouseDown(e) {
            e = e || window.event;
            e.preventDefault();
            pos3 = e.clientX;
            pos4 = e.clientY;
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
          }
          
          function elementDrag(e) {
            e = e || window.event;
            e.preventDefault();
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            element.style.top = (element.offsetTop - pos2) + "px";
            element.style.left = (element.offsetLeft - pos1) + "px";
          }
          
          function closeDragElement() {
            document.onmouseup = null;
            document.onmousemove = null;
          }
        }
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
