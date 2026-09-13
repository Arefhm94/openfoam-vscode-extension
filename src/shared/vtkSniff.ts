import * as fs from "fs";

const FIELD_DATA_RE = /\bPOINT_DATA\b|\bCELL_DATA\b/;
const CHUNK_SIZE = 1 << 20; // 1 MB
// A legacy-VTK file's POINT_DATA/CELL_DATA section always comes *after*
// the POINTS/POLYGONS data it describes, so for any real mesh (more than
// a handful of points) it sits well past the first few KB — an 8 KB
// sniff missed it on every real example file, misrouting field-data VTKs
// to the plain geometry viewer. Scan in 1 MB chunks up to this cap
// instead of reading the whole file, which can be many MB.
const MAX_SCAN_BYTES = 16 * CHUNK_SIZE;

/**
 * Cheap-ish sniff for whether a legacy-VTK file carries POINT_DATA/
 * CELL_DATA, without reading a potentially multi-MB file in full just to
 * route a click. Scans in bounded chunks, keeping a small overlap so a
 * match split across a chunk boundary isn't missed.
 */
export function looksLikeFieldData(fsPath: string): boolean {
  let fd: number;
  try {
    fd = fs.openSync(fsPath, "r");
  } catch {
    return false;
  }
  try {
    const buf = Buffer.alloc(CHUNK_SIZE);
    let carry = "";
    let offset = 0;
    for (;;) {
      if (offset >= MAX_SCAN_BYTES) return false;
      const n = fs.readSync(fd, buf, 0, buf.length, offset);
      if (n <= 0) return false;
      const text = carry + buf.toString("utf8", 0, n);
      if (FIELD_DATA_RE.test(text)) return true;
      carry = text.slice(-32);
      offset += n;
    }
  } finally {
    fs.closeSync(fd);
  }
}
