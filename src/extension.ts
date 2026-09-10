import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";
import { GeometryPreviewPanel } from "./workflow/GeometryPreviewPanel";
import { OpenFOAMDocumentSymbolProvider } from "./providers/OpenFOAMDocumentSymbolProvider";
import {
  OpenFOAMInlayHintsProvider,
  executeToggleBoolean,
} from "./providers/OpenFOAMCodeLensProvider";
import { OpenFOAMCaseTreeProvider, CaseItem } from "./providers/OpenFOAMCaseTreeProvider";

let client: LanguageClient;

/**
 * Activate the OpenFOAM language support extension
 */
export function activate(context: vscode.ExtensionContext) {
  console.log("Activating OpenFOAM Language Support extension...");

  // Start the language server
  client = startLanguageServer(context);

  // Register commands
  const refreshCommand = vscode.commands.registerCommand(
    "openfoam.refreshKeywordDB",
    async () => {
      await refreshKeywordDatabase(context);
    },
  );

  const setLanguageCommand = vscode.commands.registerCommand(
    "openfoam.setLanguageMode",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        await vscode.languages.setTextDocumentLanguage(
          editor.document,
          "openfoam",
        );
        vscode.window.showInformationMessage("Language mode set to OpenFOAM");
      } else {
        vscode.window.showWarningMessage("No active editor found");
      }
    },
  );

  // Status bar item — shows when an OpenFOAM file is active
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.text = '$(file-code) OpenFOAM';
  statusBar.tooltip = 'OpenFOAM Language Support active';
  context.subscriptions.push(statusBar);

  const updateStatusBar = (editor?: vscode.TextEditor) => {
    if (editor?.document.languageId === 'openfoam') {
      let text = '$(file-code) OpenFOAM';
      const caseRoot = findCaseRoot(editor.document.uri.fsPath);
      if (caseRoot) {
        const truncated = caseRoot.length > 30 ? '...' + caseRoot.slice(-27) : caseRoot;
        text += ` (${truncated})`;
      }
      const cfg = vscode.workspace.getConfiguration('openfoam');
      if (!cfg.get<boolean>('validateBoundaryPatches', true)) text += ' $(warning)';
      statusBar.text = text;
      statusBar.show();
    } else {
      statusBar.hide();
    }
  };
  updateStatusBar(vscode.window.activeTextEditor);
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateStatusBar));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('openfoam')) updateStatusBar(vscode.window.activeTextEditor);
  }));

  // Rebuild keyword database by running the Python pipeline scripts
  const rebuildDbCommand = vscode.commands.registerCommand(
    "openfoam.rebuildKeywordDb",
    async () => {
      const srcPath = await vscode.window.showInputBox({
        prompt: "Path to OpenFOAM-13 source root (cloned from GitHub)",
        placeHolder: "/path/to/OpenFOAM-13",
        value: process.env.WM_PROJECT_DIR || "",
      });
      if (!srcPath) return;
      const terminal = vscode.window.createTerminal("OpenFOAM DB Rebuild");
      terminal.show();
      const ext = context.extensionPath;
      const py = (n: string) => `python3 "${path.join(ext, 'scripts', n)}" --src "${srcPath}"`;
      [
        '01_discover_schemes.py', '02_parse_constructors.py', '03_extract_descriptions.py',
        '04_parse_boundary_conditions.py', '05_parse_fvSolution.py',
        '06_parse_turbulence_models.py', '07_parse_function_objects.py',
        '08_parse_thermophysical.py', '09_parse_snappyHexMesh.py',
        '10_parse_blockMesh.py', '11_parse_decomposePar.py', '12_parse_controlDict.py',
        '13_merge_database.py',
      ].forEach(s => terminal.sendText(`cd "${ext}" && ${py(s)}`));
      vscode.window.showInformationMessage(
        "Rebuilding OpenFOAM keyword database... Reload window when done.",
        "Reload Window"
      ).then(sel => { if (sel === "Reload Window") vscode.commands.executeCommand("workbench.action.reloadWindow"); });
    },
  );

  // Show scheme documentation in a quick-pick
  const showSchemeDocCommand = vscode.commands.registerCommand(
    "openfoam.showSchemeDoc",
    async () => {
      const dbPath = path.join(context.extensionPath, "data", "keyword-db.json");
      if (!require("fs").existsSync(dbPath)) {
        vscode.window.showErrorMessage("keyword-db.json not found. Run rebuildKeywordDb first.");
        return;
      }
      const db = JSON.parse(require("fs").readFileSync(dbPath, "utf-8"));
      const items: vscode.QuickPickItem[] = [];
      for (const [cat, members] of Object.entries(db.schemes || {})) {
        for (const [name, info] of Object.entries(members as Record<string, { format: string; brief: string }>)) {
          items.push({ label: name, description: cat, detail: info.brief || info.format });
        }
      }
      const sel = await vscode.window.showQuickPick(items, { placeHolder: "Search scheme..." });
      if (sel) vscode.window.showInformationMessage(`${sel.label} (${sel.description}): ${sel.detail}`);
    },
  );

  // Insert turbulence model block snippet
  const insertTurbCommand = vscode.commands.registerCommand(
    "openfoam.insertTurbulenceBlock",
    async () => {
      const models = ["kOmegaSST","kEpsilon","kOmega","SpalartAllmaras","realizableKE","laminar","Smagorinsky","WALE"];
      const sel = await vscode.window.showQuickPick(models, { placeHolder: "Choose turbulence model" });
      if (!sel) return;
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const isLES = ["Smagorinsky","WALE","dynamicKEqn"].includes(sel);
      const block = isLES
        ? `simulationType  LES;\nLES\n{\n    LESModel        ${sel};\n    turbulence      on;\n    printCoeffs     on;\n    delta           cubeRootVol;\n    cubeRootVolCoeffs { deltaCoeff 1; }\n}\n`
        : `simulationType  RAS;\nRAS\n{\n    RASModel        ${sel};\n    turbulence      on;\n    printCoeffs     on;\n}\n`;
      editor.insertSnippet(new vscode.SnippetString(block));
    },
  );

  // Register Document Symbol Provider for outline view
  const documentSymbolProvider =
    vscode.languages.registerDocumentSymbolProvider(
      { language: "openfoam" },
      new OpenFOAMDocumentSymbolProvider(),
    );

  // Register CodeLens provider for boolean toggles in the text editor
  const inlayHintsProvider = vscode.languages.registerInlayHintsProvider(
    { language: "openfoam" },
    new OpenFOAMInlayHintsProvider(),
  );

  // Register code action provider for boolean toggle
  const boolCodeActionProvider = vscode.languages.registerCodeActionsProvider(
    { language: "openfoam" },
    {
      provideCodeActions(document: vscode.TextDocument, range: vscode.Range): vscode.CodeAction[] {
        const BOOL_RE = /\b(true|false|yes|no|on|off)\b/i;
        const line = document.lineAt(range.start.line).text;
        const match = BOOL_RE.exec(line);
        if (!match) return [];
        const idx = line.indexOf(match[0]);
        if (idx < 0) return [];
        const action = new vscode.CodeAction('Toggle Boolean', vscode.CodeActionKind.QuickFix);
        action.command = {
          command: 'openfoam.toggleBoolean',
          title: 'Toggle Boolean',
          arguments: [range.start.line],
        };
        return [action];
      },
    },
  );

  const toggleBooleanCommand = vscode.commands.registerCommand(
    "openfoam.toggleBoolean",
    async (lineNumber: number) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      await executeToggleBoolean(editor.document.uri, lineNumber);
    },
  );

  // Case Explorer sidebar
  const caseTreeProvider = new OpenFOAMCaseTreeProvider(context);
  const caseTreeView = vscode.window.createTreeView('openfoam.caseExplorer', {
    treeDataProvider: caseTreeProvider,
    showCollapseAll: true,
  });
  const refreshCaseTreeCommand = vscode.commands.registerCommand(
    'openfoam.refreshCaseTree',
    () => caseTreeProvider.refresh(),
  );

  // Auto-refresh Case Explorer on file system changes
  const caseWatcher = vscode.workspace.createFileSystemWatcher('**/*');
  caseWatcher.onDidCreate(() => caseTreeProvider.refresh());
  caseWatcher.onDidDelete(() => caseTreeProvider.refresh());
  caseWatcher.onDidChange(() => caseTreeProvider.refresh());

  // Find file in case quick-pick
  const findFileCommand = vscode.commands.registerCommand(
    'openfoam.findFileInCase',
    async () => {
      const ws = vscode.workspace.workspaceFolders?.[0];
      if (!ws) { vscode.window.showInformationMessage('No workspace folder open'); return; }
      const caseRoot = findCaseRoot(ws.uri.fsPath) || ws.uri.fsPath;
      const files: vscode.QuickPickItem[] = [];
      function walkDir(dir: string) {
        try {
          for (const entry of fs.readdirSync(dir)) {
            const fp = path.join(dir, entry);
            const stat = fs.statSync(fp);
            if (stat.isDirectory() && !entry.startsWith('.')) walkDir(fp);
            else if (stat.isFile()) files.push({ label: entry, description: path.relative(caseRoot, fp) });
          }
        } catch { /* */ }
      }
      walkDir(caseRoot);
      if (!files.length) { vscode.window.showInformationMessage('No files found in case'); return; }
      const sel = await vscode.window.showQuickPick(files, { placeHolder: 'Search files in case...', matchOnDescription: true });
      if (sel) {
        const doc = await vscode.workspace.openTextDocument(path.join(caseRoot, sel.description!));
        vscode.window.showTextDocument(doc);
      }
    },
  );

  // Switch active case root in a multi-root workspace
  const switchCaseRootCommand = vscode.commands.registerCommand(
    'openfoam.switchCaseRoot',
    async () => {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length < 2) {
        vscode.window.showInformationMessage('Open a multi-root workspace with multiple OpenFOAM cases.');
        return;
      }
      const picks = folders.map(f => ({ label: f.name, description: f.uri.fsPath }));
      const sel = await vscode.window.showQuickPick(picks, { placeHolder: 'Select case root' });
      if (!sel) return;
      context.workspaceState.update('activeCaseRoot', sel.description);
      // Refresh the case tree
      caseTreeProvider.refresh();
      vscode.window.showInformationMessage(`Switched to: ${sel.label}`);
    },
  );

  // Context menu commands for Case Explorer
  const copyRelativePathCommand = vscode.commands.registerCommand(
    'openfoam.copyRelativePath',
    async (item: CaseItem) => {
      if (!item.resourceUri) return;
      const ws = vscode.workspace.workspaceFolders?.[0];
      const relPath = ws ? path.relative(ws.uri.fsPath, item.resourceUri.fsPath) : item.resourceUri.fsPath;
      vscode.env.clipboard.writeText(relPath);
      vscode.window.showInformationMessage(`Copied: ${relPath}`);
    },
  );
  const revealInFinderCommand = vscode.commands.registerCommand(
    'openfoam.revealInFinder',
    (item: CaseItem) => {
      if (item.resourceUri) vscode.commands.executeCommand('revealFileInOS', item.resourceUri);
    },
  );
  const duplicateFileCommand = vscode.commands.registerCommand(
    'openfoam.duplicateFile',
    async (item: CaseItem) => {
      if (!item.resourceUri) return;
      const ext = path.extname(item.resourceUri.fsPath);
      const base = path.basename(item.resourceUri.fsPath, ext);
      const newName = await vscode.window.showInputBox({ value: base + '_copy' + ext, placeHolder: 'New filename' });
      if (!newName) return;
      const newPath = path.join(path.dirname(item.resourceUri.fsPath), newName);
      try {
        require('fs').copyFileSync(item.resourceUri.fsPath, newPath);
        vscode.window.showInformationMessage(`Duplicated to: ${newName}`);
      } catch (e: any) {
        vscode.window.showErrorMessage(`Failed to duplicate: ${e.message}`);
      }
    },
  );

  const previewGeometryCommand = vscode.commands.registerCommand(
    'openfoam.previewGeometry',
    async (filePathOrUri?: vscode.Uri | string) => {
      let filePath: string | undefined;
      if (filePathOrUri instanceof vscode.Uri) {
        filePath = filePathOrUri.fsPath;
      } else if (typeof filePathOrUri === 'string') {
        filePath = filePathOrUri;
      } else {
        // Try to infer from hover context — ask user to pick from triSurface
        const caseRoots = vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath) ?? [];
        const picks: vscode.QuickPickItem[] = [];
        for (const root of caseRoots) {
          const triSurfDir = path.join(root, 'constant', 'triSurface');
          try {
            const files = require('fs').readdirSync(triSurfDir);
            for (const f of files) {
              const ext = path.extname(f).toLowerCase();
              if (['.stl', '.obj', '.vtk'].includes(ext)) {
                picks.push({ label: f, description: triSurfDir });
              }
            }
          } catch { /* */ }
        }
        if (!picks.length) {
          vscode.window.showInformationMessage('No geometry files found in constant/triSurface/');
          return;
        }
        const sel = await vscode.window.showQuickPick(picks, { placeHolder: 'Select geometry file to preview' });
        if (!sel) return;
        filePath = path.join(sel.description!, sel.label);
      }
      if (!filePath) return;
      const panel = GeometryPreviewPanel.createOrShow(context.extensionUri);
      if (panel) panel.previewGeometry(filePath);
    },
  );

  // Format on save
  const formatOnSaveDisposable = vscode.workspace.onWillSaveTextDocument(e => {
    const cfg = vscode.workspace.getConfiguration('openfoam');
    if (cfg.get<boolean>('formatOnSave') && e.document.languageId === 'openfoam') {
      e.waitUntil(
        vscode.commands.executeCommand('editor.action.formatDocument') as Thenable<void>,
      );
    }
  });

  // Auto-detect OpenFOAM files based on directory structure
  const autoDetectDisposable = vscode.workspace.onDidOpenTextDocument(
    async (document: vscode.TextDocument) => {
      // Skip if already set to openfoam or if it's not a file
      if (
        document.languageId === "openfoam" ||
        document.uri.scheme !== "file"
      ) {
        return;
      }

      const filePath = document.uri.fsPath;
      const fileName = path.basename(filePath);

      const hasNoExtension = !fileName.includes(".");
      const hasOrigExtension = fileName.endsWith(".orig");

      if ((hasNoExtension || hasOrigExtension) && _isInOpenFOAMCase(filePath)) {
        try {
          await vscode.languages.setTextDocumentLanguage(document, "openfoam");
        } catch (error) {
          console.error("Failed to set language mode:", error);
        }
      }
    },
  );

  // Also check currently open documents on activation
  vscode.workspace.textDocuments.forEach(async (document: vscode.TextDocument) => {
    if (document.languageId === "openfoam" || document.uri.scheme !== "file") {
      return;
    }

    const filePath = document.uri.fsPath;
    const fileName = path.basename(filePath);

    const hasNoExtension = !fileName.includes(".");
    const hasOrigExtension = fileName.endsWith(".orig");

    if ((hasNoExtension || hasOrigExtension) && _isInOpenFOAMCase(filePath)) {
      try {
        await vscode.languages.setTextDocumentLanguage(document, "openfoam");
      } catch (error) {
        console.error("Failed to set language mode:", error);
      }
    }
  });

  context.subscriptions.push(
    refreshCommand,
    setLanguageCommand,
    rebuildDbCommand,
    showSchemeDocCommand,
    insertTurbCommand,
    documentSymbolProvider,
    inlayHintsProvider,
    toggleBooleanCommand,
    boolCodeActionProvider,
    autoDetectDisposable,
    caseTreeView,
    refreshCaseTreeCommand,
    previewGeometryCommand,
    formatOnSaveDisposable,
    caseWatcher,
    findFileCommand,
    switchCaseRootCommand,
    copyRelativePathCommand,
    revealInFinderCommand,
    duplicateFileCommand,
  );

  console.log("OpenFOAM Language Support extension activated");
}

/**
 * Deactivate the extension
 */
export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}

/**
 * Find the OpenFOAM case root by walking up from a file path.
 */
function findCaseRoot(filePath: string): string | null {
  let dir = path.dirname(filePath);
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, 'system', 'controlDict')) || fs.existsSync(path.join(dir, 'system', 'fvSchemes'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/**
 * Check if a file path is inside an OpenFOAM case directory.
 * Walks up from the file to find system/ or constant/ siblings.
 */
function _isInOpenFOAMCase(filePath: string): boolean {
  const WITH_SYSTEM = /\/system\//.test(filePath);
  const WITH_CONSTANT = /\/constant\//.test(filePath);
  const IN_TIME_DIR = /\/\d+(\.\d+)?\//.test(filePath);
  if (WITH_SYSTEM || WITH_CONSTANT) return true;
  if (!IN_TIME_DIR) {
    const dirName = path.basename(path.dirname(filePath));
    if (dirName === "system" || dirName === "constant" || /^\d+(\.\d+)?$/.test(dirName)) {
      let dir = path.dirname(filePath);
      for (let i = 0; i < 3; i++) {
        const parent = path.dirname(dir);
        if (parent === dir) return false;
        if (fs.existsSync(path.join(parent, "system", "controlDict")) ||
            fs.existsSync(path.join(parent, "system", "fvSchemes"))) return true;
        dir = parent;
      }
    }
    return false;
  }
  // In a time directory — walk up to verify it's an OF case
  let dir = path.dirname(filePath);
  for (let i = 0; i < 4; i++) {
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    if (fs.existsSync(path.join(parent, "system", "controlDict")) ||
        fs.existsSync(path.join(parent, "system", "fvSchemes"))) return true;
    dir = parent;
  }
  return false;
}

/**
 * Start the language server
 */
function startLanguageServer(context: vscode.ExtensionContext): LanguageClient {
  // The server is implemented in node
  const serverModule = context.asAbsolutePath(
    path.join("out", "language-server", "server.js"),
  );

  // Debug options for the server
  const debugOptions = { execArgv: ["--nolazy", "--inspect=6009"] };

  // Server options for different run modes
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: debugOptions,
    },
  };

  // Client options
  const clientOptions: LanguageClientOptions = {
    // Register the server for OpenFOAM documents
    documentSelector: [
      { scheme: "file", language: "openfoam" },
      { scheme: "file", pattern: "**/controlDict*" },
      { scheme: "file", pattern: "**/fvSchemes*" },
      { scheme: "file", pattern: "**/fvSolution*" },
      { scheme: "file", pattern: "**/blockMeshDict*" },
      { scheme: "file", pattern: "**/snappyHexMeshDict*" },
      { scheme: "file", pattern: "**/decomposeParDict*" },
      { scheme: "file", pattern: "**/*Properties" },
      { scheme: "file", pattern: "**/*Dict" },
      // OpenFOAM field files (0, constant, system directories)
      { scheme: "file", pattern: "**/0/U" },
      { scheme: "file", pattern: "**/0/p*" },
      { scheme: "file", pattern: "**/0/k" },
      { scheme: "file", pattern: "**/0/epsilon" },
      { scheme: "file", pattern: "**/0/omega" },
      { scheme: "file", pattern: "**/0/nut*" },
      { scheme: "file", pattern: "**/0/nuTilda" },
      { scheme: "file", pattern: "**/0/alpha*" },
      { scheme: "file", pattern: "**/0/T" },
      { scheme: "file", pattern: "**/0/rho" },
      { scheme: "file", pattern: "**/0/mu" },
      { scheme: "file", pattern: "**/0/nu" },
    ],
    synchronize: {
      // Synchronize configuration section 'openfoam' to the server
      configurationSection: "openfoam",
      // Notify the server about file changes to OpenFOAM files
      fileEvents: vscode.workspace.createFileSystemWatcher("**/*.{foam,dict}"),
    },
  };

  // Create and start the language client
  const languageClient = new LanguageClient(
    "openfoamLanguageServer",
    "OpenFOAM Language Server",
    serverOptions,
    clientOptions,
  );

  // Start the client (this will also launch the server)
  languageClient.start();

  return languageClient;
}

/**
 * Refresh the keyword database by running the extractor
 */
async function refreshKeywordDatabase(
  context: vscode.ExtensionContext,
): Promise<void> {
  const terminal = vscode.window.createTerminal("OpenFOAM Keyword Extraction");

  // Show a notification
  vscode.window.showInformationMessage(
    "Refreshing OpenFOAM keyword database...",
  );

  // Get the extension path
  const extensionPath = context.extensionPath;
  const extractorScript = path.join(
    extensionPath,
    "out",
    "extractor",
    "extractKeywords.js",
  );

  // Prompt user for OpenFOAM source directory
  const openfoamPath = await vscode.window.showInputBox({
    prompt: "Enter the path to your OpenFOAM source directory",
    placeHolder: "/path/to/OpenFOAM-XX",
    value: process.env.WM_PROJECT_DIR || "",
  });

  if (!openfoamPath) {
    vscode.window.showWarningMessage("Keyword database refresh cancelled");
    return;
  }

  // Run the extraction script
  terminal.show();
  terminal.sendText(`node "${extractorScript}" "${openfoamPath}"`);

  // Show completion message
  vscode.window
    .showInformationMessage(
      "Keyword extraction started. Check the terminal for progress. Restart VS Code after completion to load the new database.",
      "Reload Window",
    )
    .then((selection: string | undefined) => {
      if (selection === "Reload Window") {
        vscode.commands.executeCommand("workbench.action.reloadWindow");
      }
    });
}
