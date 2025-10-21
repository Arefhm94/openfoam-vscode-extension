# OpenFOAM Keyword Database

This directory contains the generated keyword database (`openfoam-keywords.json`) created by the keyword extraction script.

## Generation

To generate or update the keyword database:

```bash
# From the extension root directory
npm run extract-keywords

# Or with a specific OpenFOAM path
node out/extractor/extractKeywords.js /path/to/OpenFOAM-source
```

## Format

The database is a JSON file with the following structure:

- `version`: Database format version
- `generatedAt`: ISO timestamp of generation
- `sourceRoot`: Path to OpenFOAM source used for extraction
- `keywordCount`: Total number of keywords
- `keywords`: Array of keyword objects with:
  - `name`: Keyword name
  - `description`: Human-readable description
  - `category`: Category (control, solver, scheme, boundary, etc.)
  - `parameters`: Optional array of parameter definitions
  - `examples`: Optional array of usage examples
  - `sourceFile`: Optional source file reference

## Note

The keyword database is gitignored by default as it's generated during the build process and may be large. Each user should generate their own database based on their OpenFOAM installation.
