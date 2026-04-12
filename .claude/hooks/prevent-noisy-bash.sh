#!/usr/bin/env bash
set -euo pipefail

tmp="$(mktemp)"
cat > "$tmp"

node - "$tmp" <<'EOF'
const fs = require('fs')
const path = process.argv[2]
const input = JSON.parse(fs.readFileSync(path, 'utf8'))
const command = input.tool_input?.command ?? ''

const deny = (reason) => {
  process.stdout.write(
    JSON.stringify({
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    }),
  )
}

if (/\bgrep\s+-[A-Za-z]*r[A-Za-z]*\b/.test(command)) {
  deny('Use `rg` instead of recursive `grep -r/-R` to reduce noisy output and token usage.')
  process.exit(0)
}

if (/\bls\s+-R\b/.test(command)) {
  deny('Use `rg --files` or targeted `find` instead of `ls -R` to avoid flooding context.')
  process.exit(0)
}

if (
  /\bcat\s+(docs\/ARCHITECTURE\.md|CLAUDE\.md|pnpm-lock\.yaml)\b/.test(command) &&
  !/[|>]/.test(command)
) {
  deny('Use `sed -n`, `rg`, or `head` for targeted reads of large/high-value files instead of full `cat`.')
  process.exit(0)
}
EOF

rm -f "$tmp"
