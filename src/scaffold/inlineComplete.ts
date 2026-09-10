import * as vscode from "vscode";
import { renderSnippet } from "./features";
import { collectRankedForDoc, loadKeywordDb } from "./context";

/**
 * The `@` inline trigger. Typing `@` (optionally followed by a query)
 * where a dictionary key or block name would go pops a completion list of
 * scaffoldable features, ranked for the current file. Accepting one
 * replaces the `@` with the block — as a snippet, so the fields are
 * tab-stops you fill right there. No dialog, no staging tab.
 *
 * With `openfoam.scaffold.insertMode` set to `"stagingTab"`, accepting
 * instead removes the `@` and opens the editable staging tab for that
 * feature (via `openfoam.searchInsert`).
 *
 * (`?` is a separate trigger — the cpp.openfoam.org docs lookup; see
 * `src/docs/`.)
 */
class InlineScaffoldProvider implements vscode.CompletionItemProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  provideCompletionItems(
    doc: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionList | undefined {
    const linePrefix = doc.lineAt(position.line).text.slice(0, position.character);
    // A lone `@` at a key/block-name position, then an optional query.
    const m = /(?:^\s*|[{}]\s*)@([A-Za-z0-9_:]*)$/.exec(linePrefix);
    if (!m) return undefined;
    if (linePrefix.includes("//")) return undefined; // a comment
    // Not inside a string (e.g. #calc "…@…").
    if ((linePrefix.match(/"/g) ?? []).length % 2 === 1) return undefined;

    let db: unknown;
    try {
      db = loadKeywordDb(this.context);
    } catch {
      return undefined;
    }

    const queryLen = m[1].length;
    const replace = new vscode.Range(
      position.line,
      position.character - queryLen - 1, // the "@"
      position.line,
      position.character,
    );

    const mode = vscode.workspace
      .getConfiguration("openfoam")
      .get<string>("scaffold.insertMode", "inline");

    const features = collectRankedForDoc(db, doc);
    const items = features.map((f, i) => {
      const item = new vscode.CompletionItem(
        { label: f.label, description: f.categoryLabel },
        vscode.CompletionItemKind.Snippet,
      );
      item.detail = "OpenFOAM: insert block";
      item.documentation = new vscode.MarkdownString(f.brief || "");
      item.filterText = "@" + f.label;
      item.sortText = String(i).padStart(4, "0");
      item.range = replace;
      if (mode === "stagingTab") {
        item.insertText = "";
        item.command = {
          command: "openfoam.searchInsert",
          title: "Configure & insert",
          arguments: [{ featureId: f.id }],
        };
      } else {
        item.insertText = new vscode.SnippetString(renderSnippet(f));
      }
      return item;
    });
    // `isIncomplete` so VS Code re-queries as the user types — each item's
    // replace range then always covers the current `@query`, never a stale
    // prefix that would leave the tail behind on accept.
    return new vscode.CompletionList(items, true);
  }
}

export function registerInlineScaffold(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: "openfoam" },
      new InlineScaffoldProvider(context),
      "@",
    ),
  );
}
