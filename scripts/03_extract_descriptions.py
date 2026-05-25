#!/usr/bin/env python3
"""
Script 03: Extract documentation from OpenFOAM .H file headers.

OpenFOAM uses its own header format rather than standard Doxygen markers:

    Class
        Foam::linearUpwind

    Description
        First line of description.
        Continuation...

    Usage
        ...

    Note
        ...

    Warning
        ...

    See also
        ...

This script reads every .H file referenced in 01_scheme_registry.json and
also does a broad scan for any .H file whose Class name matches a known
scheme/model/BC, extracting the Description, Usage, Note, and Warning blocks.

Usage:
    python3 scripts/03_extract_descriptions.py \\
        --src /path/to/OpenFOAM-13 \\
        --registry data/01_scheme_registry.json \\
        --out data/03_descriptions.json
"""

import re
import json
from pathlib import Path
from argparse import ArgumentParser


# ── Block extraction helpers ──────────────────────────────────────────────────

# Section headers that can follow Description (terminating it)
SECTION_KEYWORDS = re.compile(
    r'^(Usage|SourceFiles|SeeAlso|See also|Note|Warning|Deprecated|ToDo|'
    r'TODO|Author|Since|Version|Bug|References?|Example)\s*$',
    re.IGNORECASE
)
END_COMMENT = re.compile(r'^\s*\\\*')


def _extract_block(lines: list[str], start_idx: int) -> str:
    """Collect indented lines after a section header."""
    parts = []
    for line in lines[start_idx:]:
        stripped = line.rstrip()
        # Stop at next section header or end-of-comment marker
        if SECTION_KEYWORDS.match(stripped) or END_COMMENT.match(stripped):
            break
        # Stop at a line with no leading whitespace (unless blank)
        if stripped and not stripped[0].isspace():
            break
        parts.append(stripped)
    # Remove leading/trailing blank lines, then de-indent
    while parts and not parts[0].strip():
        parts.pop(0)
    while parts and not parts[-1].strip():
        parts.pop()
    if not parts:
        return ''
    # Find common indent
    indent = min((len(p) - len(p.lstrip()) for p in parts if p.strip()), default=0)
    return '\n'.join(p[indent:] for p in parts)


def extract_doc(header_path: Path) -> dict:
    """Return a dict with keys: brief, detail, usage, notes, warnings, see."""
    try:
        text = header_path.read_text(errors='ignore')
    except Exception:
        return {}

    lines = text.splitlines()
    result: dict = {}

    i = 0
    while i < len(lines):
        stripped = lines[i].rstrip()

        # ── Description block ──────────────────────────────────────────────
        if stripped == 'Description':
            block = _extract_block(lines, i + 1)
            if block:
                # First non-empty line(s) until blank = brief
                paras = re.split(r'\n\s*\n', block, maxsplit=1)
                result['brief'] = ' '.join(paras[0].split())
                result['detail'] = paras[1].strip() if len(paras) > 1 else ''

        # ── Usage block ────────────────────────────────────────────────────
        elif stripped == 'Usage':
            block = _extract_block(lines, i + 1)
            if block:
                # Strip \table / \verbatim / \endtable / \endverbatim markers
                cleaned = re.sub(r'\\(table|endtable|verbatim|endverbatim)\b', '', block)
                # Collapse multiple blank lines
                cleaned = re.sub(r'\n{3,}', '\n\n', cleaned).strip()
                result['usage'] = cleaned

        # ── Note block ─────────────────────────────────────────────────────
        elif re.match(r'^Note\s*$', stripped, re.IGNORECASE):
            block = _extract_block(lines, i + 1)
            if block:
                result.setdefault('notes', []).append(' '.join(block.split()))

        # ── Warning block ──────────────────────────────────────────────────
        elif re.match(r'^Warning\s*$', stripped, re.IGNORECASE):
            block = _extract_block(lines, i + 1)
            if block:
                result.setdefault('warnings', []).append(' '.join(block.split()))

        # ── See also block ─────────────────────────────────────────────────
        elif re.match(r'^See also\s*$', stripped, re.IGNORECASE):
            block = _extract_block(lines, i + 1)
            if block:
                result['see'] = [s.strip() for s in block.splitlines() if s.strip()]

        i += 1

    return result


# ── Name → header file search ─────────────────────────────────────────────────

def build_class_index(src: Path) -> dict[str, Path]:
    """
    Scan every .H in src for 'Class\n    Foam::<Name>' and map Name → Path.
    This lets us find headers for names not in the registry.
    """
    index: dict[str, Path] = {}
    class_re = re.compile(r'^Class\s*\n\s+Foam::(\w+)', re.MULTILINE)
    for h in src.rglob('*.H'):
        try:
            text = h.read_text(errors='ignore')
        except Exception:
            continue
        m = class_re.search(text)
        if m:
            name = m.group(1)
            # Keep the first occurrence (most likely the canonical header)
            index.setdefault(name, h)
    return index


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    ap = ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--registry', default='data/01_scheme_registry.json')
    ap.add_argument('--out', default='data/03_descriptions.json')
    args = ap.parse_args()

    src = Path(args.src)
    registry = json.loads(Path(args.registry).read_text())

    print('Building class → header index (scanning all .H files)...')
    class_index = build_class_index(src)
    print(f'  Found {len(class_index)} class headers')

    descriptions: dict = {}
    hit = miss = 0

    for cat, cat_data in registry.get('categories', {}).items():
        descriptions[cat] = {}
        for keyword, member in cat_data.get('members', {}).items():
            # 1. Try the explicit headerFile from the registry
            hf = member.get('headerFile', '')
            doc: dict = {}
            if hf:
                full = src / hf
                if full.exists():
                    doc = extract_doc(full)

            # 2. Fall back to class-name index search
            if not doc.get('brief'):
                h2 = class_index.get(keyword)
                if h2:
                    doc = extract_doc(h2)

            descriptions[cat][keyword] = doc
            if doc.get('brief'):
                hit += 1
            else:
                miss += 1

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(descriptions, indent=2))
    print(f'Written {args.out}')
    print(f'  {hit} entries with description, {miss} without')


if __name__ == '__main__':
    main()
