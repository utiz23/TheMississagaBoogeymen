#!/usr/bin/env bash
# Builds the mythic card-theme assets (spec Part 2 budget: ≤ 800 KB per mythic,
# ≤ 3 MB total) from the design zip into apps/web/public/images/cards/.
# Usage (repo root): bash docs/design/handoffs/2026-10-cards/make-card-assets.sh
# Needs ffmpeg (libwebp, libwebp_anim, libvpx-vp9, libx264) and python3 + Pillow
# (ffmpeg 6.1 cannot decode animated WebP). Crops keep only what object-fit:
# cover shows on the 264×421 card.
set -euo pipefail

ZIP="Card Customization Page.zip"
OUT=apps/web/public/images/cards
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
unzip -q -o "$ZIP" 'design_handoff_player_cards_badges/assets/*' -d "$WORK"
A="$WORK/design_handoff_player_cards_badges/assets"
mkdir -p "$OUT"

# Full-card textures: 2× the card height.
for f in tex-ice-glacier.png tex-storm-clouds.png tex-olympus-temple.png tex-inferno-gate.webp tex-future-circuit.webp; do
  ffmpeg -v error -y -i "$A/$f" -vf "scale=-2:860:flags=lanczos" -frames:v 1 \
    -c:v libwebp -quality 72 -compression_level 6 "$OUT/${f%.*}.webp"
done
# Cyber circuit mask keeps its alpha channel.
ffmpeg -v error -y -i "$A/fx-future-mask.png" -vf "scale=-2:860:flags=lanczos" -frames:v 1 \
  -c:v libwebp -quality 70 "$OUT/fx-future-mask.webp"
cp "$A/ice-cracks.avif" "$OUT/ice-cracks.avif"

# Storm rain: 3-frame loop, cover-cropped to the centre, as animated WebP.
ffmpeg -v error -y -i "$A/fx-storm-rain.gif" -vf "crop=452:720,scale=-2:600:flags=lanczos" \
  -c:v libwebp_anim -loop 0 -quality 50 "$OUT/fx-storm-rain.webp"

# Inferno embers: screen-blended, so black is transparent — a plain video works.
# Visible slice under cover + objectPosition 'center bottom' ≈ the centre 120 px.
for ext in webm mp4; do
  if [ "$ext" = webm ]; then codec=(-c:v libvpx-vp9 -crf 40 -b:v 0 -row-mt 1); else codec=(-c:v libx264 -preset slow -crf 28 -movflags +faststart); fi
  ffmpeg -v error -y -i "$A/fx-inferno-embers-slow.gif" -vf "crop=120:180,format=yuv420p" \
    "${codec[@]}" -an "$OUT/fx-inferno-embers.$ext"
done

# Storm lightning footage: split frames with Pillow, crop to the slice cover
# shows at objectPosition 58% (208×332 at x=176), short GOP for fast seeks.
mkdir -p "$WORK/live"
python3 - "$A/tex-storm-live.webp" "$WORK/live" <<'PY'
import sys
from PIL import Image, ImageSequence
for i, frame in enumerate(ImageSequence.Iterator(Image.open(sys.argv[1]))):
    frame.convert('RGB').save(f'{sys.argv[2]}/{i:04d}.png')
PY
for ext in webm mp4; do
  if [ "$ext" = webm ]; then codec=(-c:v libvpx-vp9 -crf 36 -b:v 0 -row-mt 1); else codec=(-c:v libx264 -preset slow -crf 26 -movflags +faststart); fi
  ffmpeg -v error -y -framerate 100/3 -i "$WORK/live/%04d.png" -vf "crop=208:332:176:0,format=yuv420p" \
    -g 15 "${codec[@]}" -an "$OUT/fx-storm-live.$ext"
done

bash "$(dirname "$0")/make-card-thumbs.sh"
ls -l "$OUT"
