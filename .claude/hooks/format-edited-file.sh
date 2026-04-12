#!/usr/bin/env bash
set -euo pipefail

project_dir="${CLAUDE_PROJECT_DIR:-$(pwd)}"
tmp="$(mktemp)"
cat > "$tmp"

node - "$tmp" "$project_dir" <<'EOF'
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

if (!normalized.startsWith(path.normalize(projectDir + path.sep))) {
  process.exit(0)
}

if (!fs.existsSync(normalized) || !fs.statSync(normalized).isFile()) {
  process.exit(0)
}

const ext = path.extname(normalized).toLowerCase()
if (!['.ts', '.tsx', '.json', '.md', '.yml', '.yaml'].includes(ext)) {
  process.exit(0)
}

process.stdout.write(normalized)
EOF

file_to_format="$(cat "$tmp" || true)"
rm -f "$tmp"

if [[ -n "${file_to_format}" ]]; then
  pnpm prettier --write "$file_to_format" >/dev/null 2>&1 || true
fi
