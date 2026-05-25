import * as path from "path";
import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";
import { InspectorPanel } from "./workflow/InspectorPanel";
import { OpenFOAMDocumentSymbolProvider } from "./providers/OpenFOAMDocumentSymbolProvider";
import {
  OpenFOAMInlayHintsProvider,
  executeToggleBoolean,
} from "./providers/OpenFOAMCodeLensProvider";

let client: LanguageClient;

/**
 * Activate the OpenFOAM language support extension
 */
export function activate(context: vscode.ExtensionContext) {
  console.log("Activating OpenFOAM Language Support extension...");

  // Show activation message
  vscode.window.showInformationMessage("OpenFOAM Language Support activated");

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

  const inspectorCommand = vscode.commands.registerCommand(
    "openfoam.openInspector",
    () => { InspectorPanel.createOrShow(context.extensionUri, context); },
  );

  // Status bar item — shows when an OpenFOAM file is active
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.text = '$(file-code) OpenFOAM';
  statusBar.tooltip = 'OpenFOAM Language Support active';
  statusBar.command = 'openfoam.openInspector';
  context.subscriptions.push(statusBar);

  const updateStatusBar = (editor?: vscode.TextEditor) => {
    if (editor?.document.languageId === 'openfoam') statusBar.show();
    else statusBar.hide();
  };
  updateStatusBar(vscode.window.activeTextEditor);
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateStatusBar));

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

  // When the active editor switches to an OpenFOAM file, push it to the inspector
  const activeEditorWatcher = vscode.window.onDidChangeActiveTextEditor(
    (editor: vscode.TextEditor | undefined) => {
      if (editor && InspectorPanel.currentPanel) {
        InspectorPanel.currentPanel.loadDocument(editor.document);
      }
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

  const toggleBooleanCommand = vscode.commands.registerCommand(
    "openfoam.toggleBoolean",
    async (uri: vscode.Uri, lineNumber: number) => {
      await executeToggleBoolean(uri, lineNumber);
    },
  );

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
      const dirName = path.basename(path.dirname(filePath));

      // Check if file is in OpenFOAM-related directories
      const isInOpenFOAMDir =
        filePath.includes("/system/") ||
        filePath.includes("/constant/") ||
        /\/\d+(\.\d+)?\//.test(filePath) || // Time directories like /0/, /1/, /0.5/
        dirName === "system" ||
        dirName === "constant" ||
        /^\d+(\.\d+)?$/.test(dirName); // Directory name is a number

      // Check if file has no extension or has .orig extension
      const hasNoExtension = !fileName.includes(".");
      const hasOrigExtension = fileName.endsWith(".orig");

      // Auto-detect if in OpenFOAM directory structure and has no extension
      if (isInOpenFOAMDir && (hasNoExtension || hasOrigExtension)) {
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
    const dirName = path.basename(path.dirname(filePath));

    const isInOpenFOAMDir =
      filePath.includes("/system/") ||
      filePath.includes("/constant/") ||
      /\/\d+(\.\d+)?\//.test(filePath) ||
      dirName === "system" ||
      dirName === "constant" ||
      /^\d+(\.\d+)?$/.test(dirName);

    const hasNoExtension = !fileName.includes(".");
    const hasOrigExtension = fileName.endsWith(".orig");

    if (isInOpenFOAMDir && (hasNoExtension || hasOrigExtension)) {
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
    inspectorCommand,
    rebuildDbCommand,
    showSchemeDocCommand,
    insertTurbCommand,
    activeEditorWatcher,
    documentSymbolProvider,
    inlayHintsProvider,
    toggleBooleanCommand,
    autoDetectDisposable,
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
