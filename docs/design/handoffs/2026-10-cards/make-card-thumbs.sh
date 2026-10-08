#!/usr/bin/env bash
# Card Locker swatch thumbnails (spec Part 2: "Locker swatches use small static
# thumbnails"): each mythic's main texture at 2× the 50×68 swatch. Aspect is
# kept, so the swatch's own cover/position crop matches the card's.
# Usage (repo root; reads the textures make-card-assets.sh already shipped):
#   bash docs/design/handoffs/2026-10-cards/make-card-thumbs.sh
set -euo pipefail

OUT=apps/web/public/images/cards
while read -r key tex; do
  ffmpeg -nostdin -v error -y -i "$OUT/$tex" \
    -vf "scale=100:136:force_original_aspect_ratio=increase:flags=lanczos" \
    -frames:v 1 -c:v libwebp -quality 70 "$OUT/thumb-$key.webp"
done <<'LIST'
frozen tex-ice-glacier.webp
futureC tex-future-circuit.webp
inferno tex-inferno-gate.webp
stormLive tex-storm-clouds.webp
olympus tex-olympus-temple.webp
LIST
ls -l "$OUT"/thumb-*.webp
