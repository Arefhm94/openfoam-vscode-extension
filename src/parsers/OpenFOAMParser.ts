export type ValueType = "boolean" | "number" | "string" | "vector" | "reference";

export interface DictNode {
  id: string;
  name: string;
  type: "block" | "param";
  line: number;
  endLine: number;
  children?: DictNode[];
  rawValue?: string;
  valueType?: ValueType;
}

const BOOL_VALUES = new Set(["true", "false", "yes", "no", "on", "off"]);

function classifyValue(v: string): ValueType {
  const lo = v.toLowerCase();
  if (BOOL_VALUES.has(lo)) return "boolean";
  if (v.startsWith("$")) return "reference";
  if (v.startsWith("(")) return "vector";
  if (!isNaN(Number(v))) return "number";
  return "string";
}

function stripComment(line: string): string {
  const idx = line.indexOf("//");
  return idx === -1 ? line : line.slice(0, idx);
}

export function parseOpenFOAM(source: string): DictNode {
  const rawLines = source.split("\n");
  const lines = rawLines.map(stripComment);

  const root: DictNode = {
    id: "root",
    name: "root",
    type: "block",
    line: 0,
    endLine: lines.length - 1,
    children: [],
  };

  let i = 0;

  function parseBlock(parent: DictNode, depth: number): void {
    while (i < lines.length) {
      const raw = lines[i].trim();

      // Skip empty lines, block comments, preprocessor
      if (raw === "" || raw.startsWith("/*") || raw.startsWith("*") || raw.startsWith("#")) {
        i++;
        continue;
      }

      // Closing brace — end of current block
      if (raw === "}" || raw === "};") {
        parent.endLine = i;
        i++;
        return;
      }

      // Standalone opening brace with no name — consume without attaching to avoid depth corruption
      if (raw === "{") {
        i++;
        let d = 1;
        while (i < lines.length && d > 0) {
          const r2 = lines[i].trim();
          if (r2 === "{") d++;
          if (r2 === "}" || r2 === "};") d--;
          i++;
        }
        continue;
      }

      // Block open on same line (unquoted): "word {" or "word { }"
      const blockSameLine = raw.match(/^(\w[\w.]*)\s*\{(.*)$/);
      if (blockSameLine) {
        const blockName = blockSameLine[1];
        const rest = blockSameLine[2].trim();
        const blockId = parent.id + "." + blockName;
        const blockNode: DictNode = {
          id: blockId,
          name: blockName,
          type: "block",
          line: i,
          endLine: i,
          children: [],
        };
        parent.children!.push(blockNode);
        if (rest === "}" || rest === "};") {
          blockNode.endLine = i;
          i++;
        } else {
          i++;
          parseBlock(blockNode, depth + 1);
        }
        continue;
      }

      // Block open on same line (quoted): "\"pattern\" {" or "\"pattern\" { }"
      const blockQuotedSameLine = raw.match(/^"([^"]+)"\s*\{(.*)$/);
      if (blockQuotedSameLine) {
        const blockName = blockQuotedSameLine[1];
        const rest = blockQuotedSameLine[2].trim();
        const blockId = parent.id + '."' + blockName + '"';
        const blockNode: DictNode = {
          id: blockId,
          name: '"' + blockName + '"',
          type: "block",
          line: i,
          endLine: i,
          children: [],
        };
        parent.children!.push(blockNode);
        if (rest === "}" || rest === "};") {
          blockNode.endLine = i;
          i++;
        } else {
          i++;
          parseBlock(blockNode, depth + 1);
        }
        continue;
      }

      // Block open next line (unquoted): just "word" on one line, then "{" next
      const wordOnly = raw.match(/^(\w[\w.]*)$/);
      if (wordOnly) {
        let j = i + 1;
        while (j < lines.length && lines[j].trim() === "") j++;
        if (j < lines.length && lines[j].trim() === "{") {
          const blockName = wordOnly[1];
          const blockId = parent.id + "." + blockName;
          const blockNode: DictNode = {
            id: blockId,
            name: blockName,
            type: "block",
            line: i,
            endLine: i,
            children: [],
          };
          parent.children!.push(blockNode);
          i = j + 1;
          parseBlock(blockNode, depth + 1);
          continue;
        }
      }

      // Block open next line (quoted): just "\"pattern\"" on one line, then "{" next
      const quotedOnly = raw.match(/^"([^"]+)"$/);
      if (quotedOnly) {
        let j = i + 1;
        while (j < lines.length && lines[j].trim() === "") j++;
        if (j < lines.length && lines[j].trim() === "{") {
          const blockName = quotedOnly[1];
          const blockId = parent.id + '."' + blockName + '"';
          const blockNode: DictNode = {
            id: blockId,
            name: '"' + blockName + '"',
            type: "block",
            line: i,
            endLine: i,
            children: [],
          };
          parent.children!.push(blockNode);
          i = j + 1;
          parseBlock(blockNode, depth + 1);
          continue;
        }
      }

      // Key-value parameter: "key value;" or "key value value ...;"
      const paramMatch = raw.match(/^(\w[\w.]*)\s+(.+?)\s*;$/);
      if (paramMatch) {
        const key = paramMatch[1];
        const val = paramMatch[2].trim();
        const paramId = parent.id + "." + key + "@" + i;
        parent.children!.push({
          id: paramId,
          name: key,
          type: "param",
          line: i,
          endLine: i,
          rawValue: val,
          valueType: classifyValue(val),
        });
        i++;
        continue;
      }

      // Fallthrough — skip unrecognised line
      i++;
    }
  }

  parseBlock(root, 0);

  root.endLine = lines.length - 1;

  return root;
}

/** Find the deepest node whose [line, endLine] contains the given line. */
export function findNodeAtLine(root: DictNode, targetLine: number): DictNode | null {
  let best: DictNode | null = null;

  function walk(node: DictNode): void {
    if (node.line <= targetLine && targetLine <= node.endLine) {
      if (!best || node.endLine - node.line < best.endLine - best.line) {
        best = node;
      }
      for (const child of node.children ?? []) {
        walk(child);
      }
    }
  }

  walk(root);
  return best;
}

/** Flatten all nodes into a map by id for quick lookup. */
export function buildNodeMap(root: DictNode): Map<string, DictNode> {
  const map = new Map<string, DictNode>();
  function walk(n: DictNode) {
    map.set(n.id, n);
    for (const c of n.children ?? []) walk(c);
  }
  walk(root);
  return map;
}
