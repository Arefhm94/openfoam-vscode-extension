import * as vscode from "vscode";
import { DocsIndex } from "./index";
import { DocEntry } from "./parse";

/**
 * Inline help: hovering an identifier that exactly names an OpenFOAM C++
 * class shows its cpp.openfoam.org documentation — the one-line brief
 * always, and (when `openfoam.docs.onlineHelp` is on) the full "Detailed
 * Description" fetched from the class page. Returns nothing otherwise, so
 * the language server's own hovers are unaffected — VS Code stacks
 * whatever each provider returns. A leading `?` is ignored.
 */
class DocsHoverProvider implements vscode.HoverProvider {
  constructor(private readonly index: DocsIndex) {}

  async provideHover(
    doc: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Hover | undefined> {
    const range = doc.getWordRangeAtPosition(position, /\??[A-Za-z_][A-Za-z0-9_:]*/);
    if (!range) return undefined;
    const word = doc.getText(range).replace(/^\?/, "");
    if (word.length < 3) return undefined;

    const entry = this.index.exact(word);
    if (!entry) return undefined;

    return new vscode.Hover(await this.render(entry), range);
  }

  private async render(entry: DocEntry): Promise<vscode.MarkdownString> {
    const url = this.index.fullUrl(entry);
    let body = `**${entry.name}** — ${entry.brief || "_no description_"}`;
    const full = await this.index.fetchDoc(entry);
    if (full) {
      body += `\n\n${full}`;
    } else if (this.index.onlineEnabled) {
      /* online but nothing extra to add */
    }
    body += `\n\n[OpenFOAM C++ API ↗](${url})`;
    const md = new vscode.MarkdownString(body);
    md.isTrusted = false;
    return md;
  }
}

export function registerDocsHover(context: vscode.ExtensionContext, index: DocsIndex): void {
  context.subscriptions.push(
    vscode.languages.registerHoverProvider({ language: "openfoam" }, new DocsHoverProvider(index)),
  );
}
