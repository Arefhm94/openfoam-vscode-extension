import * as path from "path";
import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";
import { WorkflowPanel } from "./workflow/WorkflowPanel";
import { OpenFOAMDocumentSymbolProvider } from "./providers/OpenFOAMDocumentSymbolProvider";

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

  const workflowCommand = vscode.commands.registerCommand(
    "openfoam.openWorkflow",
    () => {
      WorkflowPanel.createOrShow(context.extensionUri);
    },
  );

  // Register Document Symbol Provider for outline view
  const documentSymbolProvider =
    vscode.languages.registerDocumentSymbolProvider(
      { language: "openfoam" },
      new OpenFOAMDocumentSymbolProvider(),
    );

  // Auto-detect OpenFOAM files based on directory structure
  const autoDetectDisposable = vscode.workspace.onDidOpenTextDocument(
    async (document) => {
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
  vscode.workspace.textDocuments.forEach(async (document) => {
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
    workflowCommand,
    documentSymbolProvider,
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
    .then((selection) => {
      if (selection === "Reload Window") {
        vscode.commands.executeCommand("workbench.action.reloadWindow");
      }
    });
}
