#!/usr/bin/env bash
set -euo pipefail

project_dir="${CLAUDE_PROJECT_DIR:-$(pwd)}"
tmp="$(mktemp)"
cat > "$tmp"

file_to_format="$(node - "$tmp" "$project_dir" <<'EOF'
const fs = require('fs')
const path = require('path')
const inputPath = process.argv[2]
const projectDir = process.argv[3]
const payload = JSON.parse(fs.readFileSync(inputPath, 'utf8'))

const filePath = payload.tool_input?.file_path
if (!filePath || typeof filePath !== 'string') {
  process.exit(0)
}

const absolute = path.isAbsolute(filePath) ? filePath : path.join(projectDir, filePath)
const normalized = path.normalize(absolute)

// Lexical containment is not enough: a path can sit lexically inside the
// project while a symlink (on the file itself or on an ancestor directory)
// resolves it to a real location outside the project. Resolve both sides
// through the filesystem before trusting containment.
if (!normalized.startsWith(path.normalize(projectDir + path.sep)) && normalized !== path.normalize(projectDir)) {
  process.exit(0)
}

if (!fs.existsSync(normalized) || !fs.statSync(normalized).isFile()) {
  process.exit(0)
}

let realProjectDir
let realFile
try {
  realProjectDir = fs.realpathSync(projectDir)
  realFile = fs.realpathSync(normalized)
} catch {
  process.exit(0)
}

if (realFile !== realProjectDir && !realFile.startsWith(realProjectDir + path.sep)) {
  process.exit(0)
}

// Markdown is excluded: prose reformatting is disruptive and not desired here.
const ext = path.extname(normalized).toLowerCase()
if (!['.ts', '.tsx', '.json', '.yml', '.yaml'].includes(ext)) {
  process.exit(0)
}

process.stdout.write(normalized)
EOF
)"
rm -f "$tmp"

if [[ -n "${file_to_format}" ]]; then
  pnpm prettier --write "$file_to_format" >/dev/null 2>&1 || true
fi
