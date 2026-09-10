import * as vscode from "vscode";
import { DocsIndex } from "./index";
import { DocEntry } from "./parse";
import { showDocPanel } from "./docPanel";

/** Internal command a `?` completion item runs when accepted. */
export const ACCEPT_COMMAND = "openfoam.docs._accepted";

export function registerDocsOnAccept(context: vscode.ExtensionContext, index: DocsIndex): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(ACCEPT_COMMAND, async (entry: DocEntry) => {
      if (!entry?.url) return;
      const url = index.fullUrl(entry);
      const mode = vscode.workspace
        .getConfiguration("openfoam")
        .get<string>("docs.onAccept", "panel");

      if (mode === "none") return;

      if (mode === "browser") {
        try {
          await vscode.commands.executeCommand("simpleBrowser.show", url);
        } catch {
          await vscode.env.openExternal(vscode.Uri.parse(url));
        }
        return;
      }

      if (mode === "comment") {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        const brief = entry.brief ? ` — ${entry.brief}` : "";
        await editor.edit(b => b.insert(editor.selection.active, `// ${entry.name}${brief}\n// ${url}\n`));
        return;
      }

      // mode === "panel" (default): a persistent doc view beside the editor.
      await showDocPanel(index, entry);
    }),
  );
}
