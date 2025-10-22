import * as vscode from "vscode";

/**
 * Document Symbol Provider for OpenFOAM files
 * Provides outline view support showing dictionary structure with colored icons
 */
export class OpenFOAMDocumentSymbolProvider
  implements vscode.DocumentSymbolProvider
{
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

  /**
   * Provide document symbols for the outline view
   */
  public provideDocumentSymbols(
    document: vscode.TextDocument,
    token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.DocumentSymbol[]> {
    const symbols: vscode.DocumentSymbol[] = [];
    const text = document.getText();
    const lines = text.split("\n");

    // Stack to track nested blocks
    const blockStack: Array<{
      symbol: vscode.DocumentSymbol;
      startLine: number;
    }> = [];

    // Parse the document line by line
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      // Skip empty lines and full-line comments
      if (trimmedLine.length === 0 || trimmedLine.startsWith("//")) {
        continue;
      }

      // Skip multi-line comment blocks (simple detection)
      if (
        trimmedLine.startsWith("/*") ||
        trimmedLine.includes("===") ||
        trimmedLine.startsWith("*")
      ) {
        continue;
      }

      // Detect inline blocks (name { ... } all on one line)
      const inlineBlockMatch = trimmedLine.match(
        /^([a-zA-Z_][\w\.\-]*)\s*\{[^}]+\}/,
      );
      if (inlineBlockMatch) {
        const name = inlineBlockMatch[1];
        // Extract the content between braces for display
        const contentMatch = trimmedLine.match(/\{([^}]+)\}/);
        let detail = "";
        if (contentMatch) {
          const content = contentMatch[1].trim();
          // Show first key-value pair as detail
          const firstParam = content.split(";")[0].trim();
          detail =
            firstParam.length > 40
              ? firstParam.substring(0, 40) + "..."
              : firstParam;
        }

        const symbolKind = this.getSymbolKind(name, true);
        const symbol = new vscode.DocumentSymbol(
          name,
          detail,
          symbolKind,
          new vscode.Range(i, 0, i, line.length),
          new vscode.Range(i, 0, i, line.length),
        );

        if (blockStack.length > 0) {
          blockStack[blockStack.length - 1].symbol.children.push(symbol);
        } else {
          symbols.push(symbol);
        }
        continue;
      }

      // Detect opening brace (start of a block)
      if (trimmedLine === "{") {
        // Look back to find the block name
        for (let j = i - 1; j >= 0; j--) {
          const prevLine = lines[j].trim();
          if (
            prevLine.length > 0 &&
            !prevLine.startsWith("//") &&
            !prevLine.startsWith("/*") &&
            !prevLine.startsWith("*")
          ) {
            const blockName = prevLine;
            const symbolKind = this.getSymbolKind(blockName, true);
            const symbol = new vscode.DocumentSymbol(
              blockName,
              "",
              symbolKind,
              new vscode.Range(j, 0, i, line.length),
              new vscode.Range(j, 0, j, lines[j].length),
            );

            if (blockStack.length > 0) {
              blockStack[blockStack.length - 1].symbol.children.push(symbol);
            } else {
              symbols.push(symbol);
            }

            blockStack.push({ symbol, startLine: j });
            break;
          }
        }
        continue;
      }

      // Detect closing brace (end of a block)
      if (trimmedLine === "}" || trimmedLine === "};") {
        if (blockStack.length > 0) {
          const block = blockStack.pop();
          if (block) {
            // Update the range to include the closing brace
            block.symbol.range = new vscode.Range(
              block.startLine,
              0,
              i,
              line.length,
            );
          }
        }
        continue;
      }

      // Detect block name followed by opening brace on the same line
      const blockWithBraceMatch = trimmedLine.match(
        /^([a-zA-Z_][\w\.\-]*)\s*\{$/,
      );
      if (blockWithBraceMatch) {
        const blockName = blockWithBraceMatch[1];
        const symbolKind = this.getSymbolKind(blockName, true);
        const symbol = new vscode.DocumentSymbol(
          blockName,
          "",
          symbolKind,
          new vscode.Range(i, 0, i, line.length),
          new vscode.Range(i, 0, i, line.length),
        );

        if (blockStack.length > 0) {
          blockStack[blockStack.length - 1].symbol.children.push(symbol);
        } else {
          symbols.push(symbol);
        }

        blockStack.push({ symbol, startLine: i });
        continue;
      }

      // Detect key-value pairs with semicolon (but not inline blocks)
      if (trimmedLine.includes(";") && !trimmedLine.includes("{")) {
        const kvMatch = trimmedLine.match(
          /^([a-zA-Z_][\w\.\-]*)\s+(.+?);?\s*$/,
        );
        if (kvMatch) {
          const [, key, value] = kvMatch;
          const cleanValue = value.replace(/;$/, "").trim();
          const displayName = `${key}: ${cleanValue}`;

          const symbolKind = this.getSymbolKind(displayName, false);
          const symbol = new vscode.DocumentSymbol(
            displayName,
            "",
            symbolKind,
            new vscode.Range(i, 0, i, line.length),
            new vscode.Range(i, 0, i, line.length),
          );

          if (blockStack.length > 0) {
            blockStack[blockStack.length - 1].symbol.children.push(symbol);
          } else {
            symbols.push(symbol);
          }
        }
        continue;
      }

      // Detect key-value pairs without semicolon (like solver incompressibleVoF;)
      const kvNoSemiMatch = trimmedLine.match(
        /^([a-zA-Z_][\w\.\-]*)\s+([^\s\{;]+)\s*$/,
      );
      if (kvNoSemiMatch && blockStack.length === 0) {
        const [, key, value] = kvNoSemiMatch;
        const displayName = `${key}: ${value}`;

        const symbolKind = this.getSymbolKind(displayName, false);
        const symbol = new vscode.DocumentSymbol(
          displayName,
          "",
          symbolKind,
          new vscode.Range(i, 0, i, line.length),
          new vscode.Range(i, 0, i, line.length),
        );

        symbols.push(symbol);
      }
    }

    return symbols;
  }
}
