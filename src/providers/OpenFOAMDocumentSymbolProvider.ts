import * as vscode from "vscode";
import type { Parser as TSParser } from "../treeSitter/parser";
import { getParser, parseText } from "../treeSitter/parser";
import { buildOutline, OutlineNode, SimpleRange } from "../treeSitter/queries";

/**
 * Document Symbol Provider for OpenFOAM files.
 * Provides outline view support showing dictionary structure with colored
 * icons, built from the tree-sitter-openfoam parse tree (via `buildOutline`)
 * rather than an independent line-by-line regex parser.
 */
export class OpenFOAMDocumentSymbolProvider
  implements vscode.DocumentSymbolProvider
{
  private parserPromise: Promise<TSParser> | undefined;

  private getSharedParser(): Promise<TSParser> {
    if (!this.parserPromise) this.parserPromise = getParser();
    return this.parserPromise;
  }

  /**
   * Determine the appropriate symbol kind based on the name and context
   */
  private getSymbolKind(name: string, isBlock: boolean): vscode.SymbolKind {
    if (!isBlock) {
      // Key-value pairs - use different icons based on content
      const lowerName = name.toLowerCase();

      // Boolean values - purple checkbox icon
      if (
        lowerName.includes(": true") ||
        lowerName.includes(": false") ||
        lowerName.includes(": yes") ||
        lowerName.includes(": no") ||
        lowerName.includes(": on") ||
        lowerName.includes(": off")
      ) {
        return vscode.SymbolKind.Boolean;
      }

      // Numeric values - blue number icon
      if (lowerName.match(/:\s*[-+]?\d+(\.\d+)?(e[-+]?\d+)?/i)) {
        return vscode.SymbolKind.Number;
      }

      // String/text values - orange string icon
      if (lowerName.match(/:\s*".*"/) || lowerName.match(/:\s*[a-z_]/i)) {
        return vscode.SymbolKind.String;
      }

      // Default for key-value pairs - green field icon
      return vscode.SymbolKind.Field;
    }

    // For blocks/dictionaries
    const lowerName = name.toLowerCase();

    // Special OpenFOAM headers - blue namespace icon
    if (name === "FoamFile") {
      return vscode.SymbolKind.Namespace;
    }

    // Scheme-related blocks - yellow function icon
    if (lowerName.includes("scheme") || lowerName.includes("interpolation")) {
      return vscode.SymbolKind.Function;
    }

    // Solver/control blocks - magenta method icon
    if (
      lowerName.includes("solver") ||
      lowerName.includes("control") ||
      lowerName.includes("relaxation")
    ) {
      return vscode.SymbolKind.Method;
    }

    // Geometry/mesh blocks - cyan struct icon
    if (
      lowerName.includes("geometry") ||
      lowerName.includes("mesh") ||
      lowerName.includes("surface") ||
      lowerName.includes("region") ||
      lowerName.includes("feature")
    ) {
      return vscode.SymbolKind.Struct;
    }

    // Layer/refinement blocks - orange enum icon
    if (
      lowerName.includes("layer") ||
      lowerName.includes("refinement") ||
      lowerName.includes("snap")
    ) {
      return vscode.SymbolKind.Enum;
    }

    // Properties/physics blocks - green interface icon
    if (
      lowerName.includes("properties") ||
      lowerName.includes("phase") ||
      lowerName.includes("transport") ||
      lowerName.includes("turbulence")
    ) {
      return vscode.SymbolKind.Interface;
    }

    // Default for other blocks - purple class icon
    return vscode.SymbolKind.Class;
  }

  private toRange(r: SimpleRange): vscode.Range {
    return new vscode.Range(r.start.line, r.start.character, r.end.line, r.end.character);
  }

  private toSymbol(node: OutlineNode): vscode.DocumentSymbol {
    const isBlock = node.kind === "block";
    const displayName = isBlock ? node.name : `${node.name}: ${node.detail}`;
    const symbol = new vscode.DocumentSymbol(
      displayName,
      "",
      this.getSymbolKind(displayName, isBlock),
      this.toRange(node.range),
      this.toRange(node.selectionRange),
    );
    symbol.children = node.children.map(child => this.toSymbol(child));
    return symbol;
  }

  /**
   * Provide document symbols for the outline view
   */
  public async provideDocumentSymbols(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): Promise<vscode.DocumentSymbol[]> {
    const parser = await this.getSharedParser();
    const tree = parseText(parser, document.getText());
    return buildOutline(tree).map(node => this.toSymbol(node));
  }
}
