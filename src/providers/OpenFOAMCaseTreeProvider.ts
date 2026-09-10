import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class CaseItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly resourceUri?: vscode.Uri,
    public readonly isDirectory = false,
  ) {
    super(label, collapsibleState);
    this.contextValue = isDirectory ? 'folder' : 'file';
    if (resourceUri) {
      this.resourceUri = resourceUri;
      if (!isDirectory) {
        const ext = path.extname(label).toLowerCase();
        const isGeometry = ['.stl', '.obj', '.vtk'].includes(ext);
        this.command = {
          command: isGeometry ? 'openfoam.previewGeometry' : 'vscode.open',
          title: isGeometry ? 'Preview Geometry' : 'Open File',
          arguments: [resourceUri],
        };
        this.tooltip = resourceUri.fsPath;
        if (isGeometry) this.iconPath = new vscode.ThemeIcon('eye');
      }
    }
    if (isDirectory) {
      this.iconPath = new vscode.ThemeIcon('folder');
    } else if (!this.iconPath) {
      this.iconPath = new vscode.ThemeIcon('file');
    }
  }
}

export class OpenFOAMCaseTreeProvider implements vscode.TreeDataProvider<CaseItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<CaseItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private caseRoot: string | null = null;
  private _storedRoot: string | null = null;

  constructor(private context: vscode.ExtensionContext) {
    this._storedRoot = context.workspaceState.get<string | null>('activeCaseRoot', null);
    this.detectCaseRoot();
    vscode.window.onDidChangeActiveTextEditor(() => {
      this.detectCaseRoot();
      this._onDidChangeTreeData.fire();
    }, null, context.subscriptions);
  }

  refresh(): void {
    this.detectCaseRoot();
    this._onDidChangeTreeData.fire();
  }

  private detectCaseRoot(): void {
    // Prefer stored root from workspace state
    if (this._storedRoot && fs.existsSync(path.join(this._storedRoot, 'system', 'controlDict'))) {
      this.caseRoot = this._storedRoot;
      return;
    }
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      let dir = path.dirname(editor.document.uri.fsPath);
      for (let i = 0; i < 12; i++) {
        if (
          fs.existsSync(path.join(dir, 'system', 'controlDict')) ||
          fs.existsSync(path.join(dir, 'system', 'fvSchemes'))
        ) {
          this.caseRoot = dir;
          return;
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    }
    // Fall back to stored root or first workspace root
    if (this._storedRoot) { this.caseRoot = this._storedRoot; return; }
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (ws) this.caseRoot = ws.uri.fsPath;
  }

  getTreeItem(element: CaseItem): vscode.TreeItem { return element; }

  getChildren(element?: CaseItem): vscode.ProviderResult<CaseItem[]> {
    if (!this.caseRoot) {
      return [new CaseItem('Open a folder with an OpenFOAM case to get started',
        vscode.TreeItemCollapsibleState.None)];
    }

    if (!element) {
      return this.getRootChildren();
    }
    if ((element as any)._timeDirs) {
      const dirs = (element as any)._timeDirs as string[];
      return dirs.map(d => {
        const fp = path.join(this.caseRoot!, d);
        return new CaseItem(d, vscode.TreeItemCollapsibleState.Collapsed, vscode.Uri.file(fp), true);
      });
    }
    if (element.isDirectory && element.resourceUri) {
      return this.getDirChildren(element.resourceUri.fsPath);
    }
    return [];
  }

  private getRootChildren(): CaseItem[] {
    if (!this.caseRoot) return [];
    const items: CaseItem[] = [];

    // Standard OpenFOAM directories
    const stdDirs = ['0', 'system', 'constant'];
    for (const d of stdDirs) {
      const fp = path.join(this.caseRoot, d);
      if (fs.existsSync(fp)) {
        items.push(new CaseItem(
          d, vscode.TreeItemCollapsibleState.Collapsed,
          vscode.Uri.file(fp), true,
        ));
      }
    }

    // Time directories (numeric names > 0, excluding 0 which was already added)
    try {
      const entries = fs.readdirSync(this.caseRoot);
      const timeDirs = entries
        .filter(e => /^\d+(\.\d+)?$/.test(e) && e !== '0')
        .sort((a, b) => parseFloat(a) - parseFloat(b));

      // Group time directories if there are more than 10
      if (timeDirs.length > 10) {
        const groups: { label: string; dirs: string[] }[] = [];
        let currentGroup: string[] = [];
        let groupStart = '';
        for (let ti = 0; ti < timeDirs.length; ti++) {
          if (currentGroup.length === 0) { groupStart = timeDirs[ti]; currentGroup.push(timeDirs[ti]); }
          else if (currentGroup.length < 10) { currentGroup.push(timeDirs[ti]); }
          else {
            groups.push({ label: `${groupStart}–${timeDirs[ti - 1]} (${currentGroup.length})`, dirs: currentGroup });
            groupStart = timeDirs[ti]; currentGroup = [timeDirs[ti]];
          }
        }
        if (currentGroup.length) groups.push({ label: `${groupStart}–${timeDirs[timeDirs.length - 1]} (${currentGroup.length})`, dirs: currentGroup });
        for (const g of groups) {
          const grpItem = new CaseItem(g.label, vscode.TreeItemCollapsibleState.Collapsed, undefined, true);
          grpItem.contextValue = 'timeGroup';
          (grpItem as any)._timeDirs = g.dirs;
          grpItem.iconPath = new vscode.ThemeIcon('folder');
          items.push(grpItem);
        }
      } else {
        for (const d of timeDirs) {
          const fp = path.join(this.caseRoot, d);
          try {
            if (fs.statSync(fp).isDirectory()) {
              items.push(new CaseItem(d, vscode.TreeItemCollapsibleState.Collapsed, vscode.Uri.file(fp), true));
            }
          } catch { /* skip */ }
        }
      }
    } catch { /* skip */ }

    return items;
  }

  private getDirChildren(dirPath: string): CaseItem[] {
    const items: CaseItem[] = [];
    try {
      const entries = fs.readdirSync(dirPath).sort();
      for (const entry of entries) {
        if (entry.startsWith('.')) continue;
        const fp = path.join(dirPath, entry);
        try {
          const stat = fs.statSync(fp);
          if (stat.isDirectory()) {
            items.push(new CaseItem(
              entry, vscode.TreeItemCollapsibleState.Collapsed,
              vscode.Uri.file(fp), true,
            ));
          } else {
            items.push(new CaseItem(
              entry, vscode.TreeItemCollapsibleState.None,
              vscode.Uri.file(fp), false,
            ));
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
    return items;
  }
}
