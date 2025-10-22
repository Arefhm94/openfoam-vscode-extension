import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  CompletionItem,
  CompletionItemKind,
  TextDocumentPositionParams,
  TextDocumentSyncKind,
  Hover,
  MarkupKind,
  SignatureHelp,
  SignatureInformation,
  ParameterInformation,
  InitializeResult,
} from "vscode-languageserver/node";

import { TextDocument } from "vscode-languageserver-textdocument";
import * as fs from "fs";
import * as path from "path";

/**
 * OpenFOAM Language Server
 *
 * Provides IntelliSense features for OpenFOAM dictionary files:
 * - Hover: Show keyword descriptions and parameters
 * - Completion: Suggest keywords with snippets
 * - Signature Help: Show parameter information while typing
 */

interface KeywordInfo {
  name: string;
  description: string;
  parameters?: ParameterInfo[];
  examples?: string[];
  sourceFile?: string;
  category: string;
}

interface ParameterInfo {
  name: string;
  type?: string;
  required: boolean;
  description?: string;
  defaultValue?: string;
}

interface KeywordDatabase {
  version: string;
  generatedAt: string;
  sourceRoot: string;
  keywordCount: number;
  keywords: KeywordInfo[];
}

class OpenFOAMLanguageServer {
  private connection = createConnection(ProposedFeatures.all);
  private documents = new TextDocuments(TextDocument);
  private keywordMap = new Map<string, KeywordInfo>();
  private keywordsByCategory = new Map<string, KeywordInfo[]>();

  constructor() {
    this.setupConnectionHandlers();
    this.setupDocumentHandlers();
  }

  /**
   * Set up connection event handlers
   */
  private setupConnectionHandlers(): void {
    this.connection.onInitialize(this.onInitialize.bind(this));
    this.connection.onInitialized(this.onInitialized.bind(this));
    this.connection.onHover(this.onHover.bind(this));
    this.connection.onCompletion(this.onCompletion.bind(this));
    this.connection.onCompletionResolve(this.onCompletionResolve.bind(this));
    this.connection.onSignatureHelp(this.onSignatureHelp.bind(this));
  }

  /**
   * Set up document event handlers
   */
  private setupDocumentHandlers(): void {
    this.documents.listen(this.connection);
  }

  /**
   * Initialize the language server
   */
  private onInitialize(params: InitializeParams): InitializeResult {
    console.log("Initializing OpenFOAM Language Server...");

    const result: InitializeResult = {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        hoverProvider: true,
        completionProvider: {
          resolveProvider: true,
          triggerCharacters: [" ", "\n", "\t", "{"],
        },
        signatureHelpProvider: {
          triggerCharacters: [" ", "\t"],
        },
      },
    };

    return result;
  }

  /**
   * Server initialized - load keyword database
   */
  private onInitialized(): void {
    console.log("Server initialized, loading keyword database...");
    this.loadKeywordDatabase();
  }

  /**
   * Load the keyword database from JSON file
   */
  private loadKeywordDatabase(): void {
    try {
      // Try to find the keyword database (relative to the compiled server.js location)
      const possiblePaths = [
        path.join(__dirname, "..", "data", "openfoam-keywords.json"),
        path.join(__dirname, "..", "..", "data", "openfoam-keywords.json"),
      ];

      let dbPath: string | null = null;
      for (const p of possiblePaths) {
        console.log(`Checking for keyword database at: ${p}`);
        if (fs.existsSync(p)) {
          dbPath = p;
          console.log(`Found keyword database at: ${dbPath}`);
          break;
        }
      }

      if (!dbPath) {
        const errorMsg = `Keyword database not found. Searched paths:\n${possiblePaths.join("\n")}`;
        console.error(errorMsg);
        this.connection.console.error(errorMsg);
        return;
      }

      const dbContent = fs.readFileSync(dbPath, "utf-8");
      const database: KeywordDatabase = JSON.parse(dbContent);

      console.log(`Loading ${database.keywordCount} keywords from database...`);

      // Build keyword maps
      for (const keyword of database.keywords) {
        this.keywordMap.set(keyword.name.toLowerCase(), keyword);

        // Group by category
        const category = keyword.category || "other";
        if (!this.keywordsByCategory.has(category)) {
          this.keywordsByCategory.set(category, []);
        }
        this.keywordsByCategory.get(category)!.push(keyword);
      }

      console.log(`Loaded ${this.keywordMap.size} keywords successfully`);
      this.connection.console.log(
        `OpenFOAM Language Server ready with ${this.keywordMap.size} keywords`,
      );
    } catch (error) {
      console.error("Error loading keyword database:", error);
      this.connection.console.error(
        `Failed to load keyword database: ${error}`,
      );
    }
  }

  /**
   * Handle hover requests
   */
  private onHover(params: TextDocumentPositionParams): Hover | null {
    const document = this.documents.get(params.textDocument.uri);
    if (!document) {
      return null;
    }

    const word = this.getWordAtPosition(document, params.position);
    if (!word) {
      return null;
    }

    const keyword = this.keywordMap.get(word.toLowerCase());
    if (!keyword) {
      return null;
    }

    const content = this.formatKeywordHover(keyword);

    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: content,
      },
    };
  }

  /**
   * Format keyword information for hover display
   */
  private formatKeywordHover(keyword: KeywordInfo): string {
    let content = `**${keyword.name}** _(${keyword.category})_\n\n`;
    content += `${keyword.description}\n\n`;

    if (keyword.parameters && keyword.parameters.length > 0) {
      content += "**Parameters:**\n\n";
      for (const param of keyword.parameters) {
        const required = param.required ? "_required_" : "_optional_";
        const typeInfo = param.type ? ` \`${param.type}\`` : "";
        const defaultInfo = param.defaultValue
          ? ` (default: \`${param.defaultValue}\`)`
          : "";
        content += `- **${param.name}**${typeInfo} - ${required}${defaultInfo}`;
        if (param.description) {
          content += `\n  ${param.description}`;
        }
        content += "\n";
      }
      content += "\n";
    }

    if (keyword.examples && keyword.examples.length > 0) {
      content += "**Example:**\n\n";
      content += "```openfoam\n";
      content += keyword.examples[0];
      content += "\n```\n";
    }

    if (keyword.sourceFile) {
      content += `\n_Source: ${keyword.sourceFile}_`;
    }

    return content;
  }

  /**
   * Handle completion requests
   */
  private onCompletion(params: TextDocumentPositionParams): CompletionItem[] {
    const document = this.documents.get(params.textDocument.uri);
    if (!document) {
      return [];
    }

    const context = this.getCompletionContext(document, params.position);
    const items: CompletionItem[] = [];

    // Generate completion items from keyword database
    for (const [name, keyword] of this.keywordMap) {
      const item: CompletionItem = {
        label: keyword.name,
        kind: this.getCompletionKind(keyword.category),
        detail: keyword.description,
        documentation: {
          kind: MarkupKind.Markdown,
          value: this.formatKeywordHover(keyword),
        },
        insertText: this.generateInsertText(keyword),
        insertTextFormat: 2, // Snippet format
        sortText: this.getSortText(keyword, context),
      };

      items.push(item);
    }

    return items;
  }

  /**
   * Resolve additional completion item details
   */
  private onCompletionResolve(item: CompletionItem): CompletionItem {
    // Additional details can be added here if needed
    return item;
  }

  /**
   * Handle signature help requests
   */
  private onSignatureHelp(
    params: TextDocumentPositionParams,
  ): SignatureHelp | null {
    const document = this.documents.get(params.textDocument.uri);
    if (!document) {
      return null;
    }

    const word = this.getWordAtPosition(document, params.position);
    if (!word) {
      return null;
    }

    const keyword = this.keywordMap.get(word.toLowerCase());
    if (!keyword || !keyword.parameters || keyword.parameters.length === 0) {
      return null;
    }

    const signature: SignatureInformation = {
      label: this.formatSignatureLabel(keyword),
      documentation: {
        kind: MarkupKind.Markdown,
        value: keyword.description,
      },
      parameters: keyword.parameters.map((param) => {
        const paramInfo: ParameterInformation = {
          label: param.name,
          documentation: {
            kind: MarkupKind.Markdown,
            value: param.description || "",
          },
        };
        return paramInfo;
      }),
    };

    return {
      signatures: [signature],
      activeSignature: 0,
      activeParameter: 0,
    };
  }

  /**
   * Format signature label for display
   */
  private formatSignatureLabel(keyword: KeywordInfo): string {
    if (!keyword.parameters || keyword.parameters.length === 0) {
      return keyword.name;
    }

    const params = keyword.parameters
      .map((p) => {
        const opt = p.required ? "" : "?";
        return `${p.name}${opt}`;
      })
      .join(", ");

    return `${keyword.name}(${params})`;
  }

  /**
   * Get completion context to prioritize suggestions
   */
  private getCompletionContext(document: TextDocument, position: any): string {
    const text = document.getText();
    const offset = document.offsetAt(position);
    const before = text.substring(Math.max(0, offset - 100), offset);

    if (before.includes("FoamFile")) return "header";
    if (before.includes("controlDict")) return "control";
    if (before.includes("fvSchemes")) return "scheme";
    if (before.includes("fvSolution")) return "solver";
    if (before.includes("boundaryField") || before.includes("type"))
      return "boundary";

    return "general";
  }

  /**
   * Get appropriate completion item kind based on category
   */
  private getCompletionKind(category: string): CompletionItemKind {
    switch (category) {
      case "control":
        return CompletionItemKind.Property;
      case "solver":
        return CompletionItemKind.Method;
      case "scheme":
        return CompletionItemKind.Function;
      case "boundary":
        return CompletionItemKind.Class;
      case "function":
        return CompletionItemKind.Module;
      case "property":
        return CompletionItemKind.Field;
      case "utility":
        return CompletionItemKind.Unit;
      default:
        return CompletionItemKind.Keyword;
    }
  }

  /**
   * Generate insert text (snippet) for completion
   */
  private generateInsertText(keyword: KeywordInfo): string {
    // Simple value keywords
    if (!keyword.parameters || keyword.parameters.length === 0) {
      if (keyword.examples && keyword.examples.length > 0) {
        // Extract simple value from example
        const match = keyword.examples[0].match(/\s+(.+);$/);
        if (match) {
          return `${keyword.name}        ${match[1]};`;
        }
      }
      return `${keyword.name}        \${1:value};`;
    }

    // Keywords with parameters - create snippet with sub-dictionary
    if (keyword.parameters.length === 1 && !keyword.name.includes("Schemes")) {
      const param = keyword.parameters[0];
      const value = param.defaultValue || "${1:value}";
      return `${keyword.name}        ${value};`;
    }

    // Complex keywords with multiple parameters
    let snippet = `${keyword.name}\n{\n`;
    keyword.parameters.forEach((param, index) => {
      const value =
        param.defaultValue || `\${${index + 1}:${param.type || "value"}}`;
      snippet += `    ${param.name}        ${value};\n`;
    });
    snippet += "}";

    return snippet;
  }

  /**
   * Get sort text to prioritize completions based on context
   */
  private getSortText(keyword: KeywordInfo, context: string): string {
    // Prioritize keywords matching the context
    if (keyword.category === context) {
      return "0_" + keyword.name;
    }

    // Secondary priority for related categories
    const priorities: { [key: string]: string[] } = {
      control: ["property", "function"],
      solver: ["scheme", "property"],
      scheme: ["solver"],
      boundary: ["property"],
    };

    if (priorities[context]?.includes(keyword.category)) {
      return "1_" + keyword.name;
    }

    return "2_" + keyword.name;
  }

  /**
   * Get word at cursor position
   */
  private getWordAtPosition(
    document: TextDocument,
    position: any,
  ): string | null {
    const text = document.getText();
    const offset = document.offsetAt(position);

    // Find word boundaries
    let start = offset;
    let end = offset;

    while (start > 0 && /[a-zA-Z0-9_]/.test(text[start - 1])) {
      start--;
    }

    while (end < text.length && /[a-zA-Z0-9_]/.test(text[end])) {
      end++;
    }

    if (start === end) {
      return null;
    }

    return text.substring(start, end);
  }

  /**
   * Start listening for requests
   */
  public listen(): void {
    this.documents.listen(this.connection);
    this.connection.listen();
  }
}

// Start the server
const server = new OpenFOAMLanguageServer();
server.listen();
