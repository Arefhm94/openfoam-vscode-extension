import * as vscode from "vscode";
import { DocsIndex } from "./index";
import { DocEntry } from "./parse";
import { absolutizeUrls, extractArticle } from "./page";

/**
 * A persistent doc panel beside the editor — the `?`-accept target for
 * `openfoam.docs.onAccept: "panel"`. One reused webview; it stays until
 * the user closes it (unlike a hover, which vanishes on mouse-move).
 * Shows the class page's own HTML (styled to the theme) when
 * `openfoam.docs.onlineHelp` is on, else the bundled brief + why.
 */
let panel: vscode.WebviewPanel | undefined;
let current: { index: DocsIndex; entry: DocEntry } | undefined;

export async function showDocPanel(index: DocsIndex, entry: DocEntry): Promise<void> {
  current = { index, entry };

  if (!panel) {
    panel = vscode.window.createWebviewPanel(
      "openfoamDocs",
      entry.name,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true },
    );
    panel.onDidDispose(() => {
      panel = undefined;
      current = undefined;
    });
    panel.webview.onDidReceiveMessage(async (msg: { type: string }) => {
      if (!current) return;
      if (msg.type === "open") {
        await vscode.env.openExternal(vscode.Uri.parse(current.index.fullUrl(current.entry)));
      } else if (msg.type === "enable") {
        await vscode.workspace
          .getConfiguration("openfoam")
          .update("docs.onlineHelp", true, vscode.ConfigurationTarget.Global);
        await render(true);
      } else if (msg.type === "retry") {
        await render(true);
      }
    });
  }
  await render(false);
}

async function render(force: boolean): Promise<void> {
  if (!panel || !current) return;
  const { index, entry } = current;
  const url = index.fullUrl(entry);
  const p = panel;

  p.title = entry.name;
  p.webview.html = shell(entry, url, `<p class="muted">Loading ${esc(entry.name)}…</p>`);
  p.reveal(vscode.ViewColumn.Beside, true);

  const raw = await index.fetchPageHtml(entry, force);
  if (panel !== p || current?.entry !== entry) return;

  if (raw) {
    const dir = url.replace(/\/[^/]*$/, "/");
    p.webview.html = shell(entry, url, absolutizeUrls(extractArticle(raw), dir));
    return;
  }

  const brief = esc(entry.brief) || "<em>No description in the bundled index.</em>";
  if (!index.onlineEnabled) {
    p.webview.html = shell(
      entry,
      url,
      `<p>${brief}</p>
       <p class="muted">Online help is off, so only the bundled one-line description is available.</p>
       <p><button data-msg="enable">Enable online help</button>
          <button data-msg="open">Open page in browser</button></p>`,
    );
  } else {
    p.webview.html = shell(
      entry,
      url,
      `<p>${brief}</p>
       <p class="muted">Couldn't load the page from cpp.openfoam.org${
         index.lastPageError ? ` — ${esc(index.lastPageError)}` : ""
       }.</p>
       <p><button data-msg="retry">Retry</button>
          <button data-msg="open">Open page in browser</button></p>`,
    );
  }
}

function shell(entry: DocEntry, url: string, body: string): string {
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const csp =
    `default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https: data:; script-src 'nonce-${nonce}';`;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
         padding: 12px 18px; line-height: 1.5; }
  a { color: var(--vscode-textLink-foreground); }
  h1 { font-size: 1.3em; } h2 { font-size: 1.12em; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 2px; }
  h3 { font-size: 1em; }
  code, tt, .fragment, pre { font-family: var(--vscode-editor-font-family);
         background: var(--vscode-textCodeBlock-background); }
  code, tt { padding: 0 3px; border-radius: 3px; }
  .fragment, pre { display: block; padding: 8px 10px; border-radius: 4px; overflow-x: auto; white-space: pre; }
  table { border-collapse: collapse; } td, th { border: 1px solid var(--vscode-panel-border); padding: 3px 7px; }
  img { max-width: 100%; }
  .muted { color: var(--vscode-descriptionForeground); }
  .src { margin: 0 0 12px; font-size: 0.9em; }
  button { font: inherit; margin-right: 8px; padding: 4px 12px; cursor: pointer;
           color: var(--vscode-button-foreground); background: var(--vscode-button-background);
           border: none; border-radius: 3px; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  .memproto, .memitem { border: 1px solid var(--vscode-panel-border); border-radius: 4px; }
  .memproto { background: var(--vscode-editor-inactiveSelectionBackground); padding: 4px 8px; }
  .memdoc { padding: 6px 10px; }
</style></head>
<body>
  <p class="src"><strong>${esc(entry.name)}</strong> — <a href="${url}">${url}</a></p>
  ${body}
  <script nonce="${nonce}">
    const vs = acquireVsCodeApi();
    document.body.addEventListener('click', e => {
      const b = e.target.closest('button[data-msg]');
      if (b) vs.postMessage({ type: b.dataset.msg });
    });
  </script>
</body></html>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}
