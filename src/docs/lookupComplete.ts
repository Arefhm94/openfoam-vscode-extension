import * as vscode from "vscode";
import { DocsIndex } from "./index";
import { DocEntry } from "./parse";
import { ACCEPT_COMMAND } from "./onAccept";

interface DocCompletionItem extends vscode.CompletionItem {
  _entry: DocEntry;
}

/**
 * The `?` docs trigger. Typing `?name` where a value would go pops a
 * completion list of matching OpenFOAM C++ classes from
 * cpp.openfoam.org. As you move through the list, the detail pane beside
 * the cursor shows that class's brief and — when `openfoam.docs.onlineHelp`
 * is on — its full "Detailed Description", fetched from the class page.
 * Accepting an item does nothing but clear the `?query` — it's a lookup,
 * not an edit. (`@` is the separate scaffold trigger.)
 */
class DocsLookupProvider implements vscode.CompletionItemProvider {
  constructor(private readonly index: DocsIndex) {}

  provideCompletionItems(
    doc: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionList | undefined {
    const linePrefix = doc.lineAt(position.line).text.slice(0, position.character);
    const m = /(?:^|[\s{}(=])\?([A-Za-z0-9_:]+)$/.exec(linePrefix);
    if (!m) return undefined;
    if (linePrefix.includes("//")) return undefined;
    if ((linePrefix.match(/"/g) ?? []).length % 2 === 1) return undefined;

    const query = m[1];
    const hits = this.index.lookup(query);
    if (!hits.length) return undefined;

    // Cover the whole `?query`; accepting replaces it with nothing.
    const triggerRange = new vscode.Range(
      position.line,
      position.character - query.length - 1,
      position.line,
      position.character,
    );

    const items = hits.map((e, i) => {
      const item = new vscode.CompletionItem(
        { label: e.name, description: "OpenFOAM C++ API" },
        vscode.CompletionItemKind.Reference,
      ) as DocCompletionItem;
      item._entry = e;
      item.documentation = this.brief(e);
      item.detail = e.brief || undefined;
      item.filterText = "?" + e.name;
      item.sortText = String(i).padStart(4, "0");
      item.insertText = ""; // accepting removes the `?query`; the command does the rest
      item.range = triggerRange;
      item.command = { command: ACCEPT_COMMAND, title: "OpenFOAM C++ API", arguments: [e] };
      return item;
    });
    // `isIncomplete` so VS Code re-queries on every keystroke — keeps each
    // item's replace range covering the *current* `?query`, not a stale
    // prefix (otherwise accepting leaves the unmatched tail in the file).
    return new vscode.CompletionList(items, true);
  }

  async resolveCompletionItem(item: vscode.CompletionItem): Promise<vscode.CompletionItem> {
    const entry = (item as DocCompletionItem)._entry;
    if (!entry) return item;
    const full = await this.index.fetchDoc(entry);
    if (full) item.documentation = this.brief(entry, full);
    return item;
  }

  private brief(e: DocEntry, full?: string): vscode.MarkdownString {
    const url = this.index.fullUrl(e);
    let body = `**${e.name}**\n\n${e.brief || "_no description_"}`;
    if (full) body += `\n\n${full}`;
    body += `\n\n[Open in browser ↗](${url})`;
    return new vscode.MarkdownString(body);
  }
}

export function registerDocsLookup(context: vscode.ExtensionContext, index: DocsIndex): void {
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: "openfoam" },
      new DocsLookupProvider(index),
      "?",
    ),
  );
}
