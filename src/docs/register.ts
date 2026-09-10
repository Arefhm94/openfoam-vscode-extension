import * as vscode from "vscode";
import { DocsIndex } from "./index";
import { registerDocsLookup } from "./lookupComplete";
import { registerDocsHover } from "./hover";
import { registerDocsOnAccept } from "./onAccept";

/**
 * Wires up the `?` OpenFOAM C++ API docs help: the `?name` completion
 * lookup, the identifier hover, and the accept action (hover / browser /
 * comment, per `openfoam.docs.onAccept`), all backed by one shared
 * `DocsIndex` (bundled offline baseline + opt-in
 * `openfoam.docs.onlineHelp` refresh).
 */
export function registerDocsHelp(context: vscode.ExtensionContext): void {
  const index = new DocsIndex(context);
  registerDocsOnAccept(context, index);
  registerDocsLookup(context, index);
  registerDocsHover(context, index);
}
