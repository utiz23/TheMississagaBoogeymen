#!/usr/bin/env bash
# Scrape all 84 NHL 26 X-Factor PNGs (28 X-Factors × Red/Gold/Blue tiers)
# from EA's hub site into docs/branding/x-factors/.
#
# Each detail page server-renders the image URLs in raw HTML; curl + grep
# pulls them out. Across all 28 detail pages we deduplicate URLs by
# filename and download each unique PNG.
#
# Usage: bash scripts/scrape_ea_xfactor_pngs.sh

set -euo pipefail

# Resolve the repo root from the script's own location so re-runs work
# regardless of cwd.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

UA='Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0'
HUB='https://www.ea.com/games/nhl/nhl-26/nhl26-x-factors-hub'
# Assets live under public/ so Next.js serves them at
# /assets/x-factors/<Name>/<file>.png. Source-of-truth here, not in
# docs/branding/.
OUT="$REPO_ROOT/apps/web/public/assets/x-factors"
URLS_TMP="$(mktemp)"
trap 'rm -f "$URLS_TMP"' EXIT

mkdir -p "$OUT"

# 28 X-Factor slugs (16 from page 1, 12 from page 2, hand-listed so the
# script doesn't depend on the live hub HTML for the index — a network
# blip on the hub itself would otherwise abort the whole crawl).
SLUGS=(
  nhl26-ankle-breaker nhl26-backhand-beauty nhl26-big-rig nhl26-big-tipper
  nhl26-born-leader nhl26-dialed-in nhl26-elite-edges nhl26-hipster
  nhl26-no-contest nhl26-one-t nhl26-post-to-post nhl26-pressure-plus
  nhl26-quick-draw nhl26-quickpick nhl26-quick-release nhl26-recharge
  nhl26-rocket nhl26-second-wind nhl26-send-it nhl26-show-stopper
  nhl26-spark-plug nhl26-sponge nhl26-stick-em-up nhl26-tape-to-tape
  nhl26-truculence nhl26-unstoppable nhl26-warrior nhl26-wheels
)

echo "scraping ${#SLUGS[@]} detail pages..."
for slug in "${SLUGS[@]}"; do
  url="$HUB/$slug"
  # Pick up both naming conventions EA uses for X-Factor PNGs:
  #   1. NHL_26_<Name>_X-Factor_Image__<Tier>__File.png  (27 X-Factors)
  #   2. <name>_<N>.png  where N=1|2|3  (Wheels only, as of 2026-05)
  # Tier mapping for the wheels_N pattern, confirmed visually:
  #   1=Gold, 2=Blue, 3=Red.
  curl -sL -A "$UA" "$url" \
    | grep -ohE 'drop-assets\.ea\.com/images/[A-Za-z0-9]+/[A-Za-z0-9]+/(NHL_?26_[A-Za-z0-9_%.+-]+X-Factor_Image[A-Za-z0-9_%.]+\.png|[a-z_]+_[1-3]\.png)' \
    >> "$URLS_TMP" || true
done

sort -u -o "$URLS_TMP" "$URLS_TMP"
TOTAL=$(wc -l < "$URLS_TMP")
echo "found $TOTAL unique X-Factor image URLs across all detail pages"

if [ "$TOTAL" -lt 80 ]; then
  echo "WARN: expected ~84, got $TOTAL — some tier variants may be missing"
fi

# Map the wheels_N pattern to the canonical naming so the final folder
# is uniform. Visually confirmed mapping: 1=Gold, 2=Blue, 3=Red.
declare -A TIER_BY_N=([1]="Gold" [2]="Blue" [3]="Red")

echo "downloading + organizing into $OUT/<Name>/..."
DL_OK=0
DL_SKIP=0
while read -r url; do
  raw=$(basename "$url")
  if [[ "$raw" =~ ^([a-z_]+)_([1-3])\.png$ ]]; then
    raw_name="${BASH_REMATCH[1]}"
    n="${BASH_REMATCH[2]}"
    # Title-case the slug (wheels → Wheels, stick_em_up → Stick_Em_Up).
    canon_name=$(echo "$raw_name" \
      | awk -F_ '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) substr($i,2)} 1' OFS=_)
    fname="NHL_26_${canon_name}_X-Factor_Image__${TIER_BY_N[$n]}__File.png"
  else
    fname="$raw"
  fi
  # Extract the X-Factor name segment for folder placement.
  if [[ "$fname" =~ ^NHL_26_(.+)_X-Factor_Image__[A-Z][a-z]+__File\.png$ ]]; then
    sub="${BASH_REMATCH[1]}"
  else
    sub="_misc"
  fi
  dir="$OUT/$sub"
  mkdir -p "$dir"
  out="$dir/$fname"
  if [ -s "$out" ]; then
    DL_SKIP=$((DL_SKIP+1))
    continue
  fi
  if curl -sL -A "$UA" -o "$out" "https://$url"; then
    DL_OK=$((DL_OK+1))
  else
    echo "FAIL: $url" >&2
    rm -f "$out"
  fi
done < "$URLS_TMP"

total=$(find "$OUT" -name '*.png' | wc -l)
folders=$(find "$OUT" -maxdepth 1 -mindepth 1 -type d | wc -l)
echo "done: $DL_OK downloaded, $DL_SKIP already present, total: $total PNGs across $folders folders"

# Sanity: every folder should have exactly 3 files (Red/Gold/Blue).
bad_folders=0
for d in "$OUT"/*/; do
  c=$(find "$d" -maxdepth 1 -name '*.png' | wc -l)
  if [ "$c" -ne 3 ]; then
    echo "  WARN: $(basename "$d") has $c PNGs (expected 3)" >&2
    bad_folders=$((bad_folders+1))
  fi
done
if [ "$bad_folders" -eq 0 ]; then
  echo "all $folders folders have exactly 3 tier PNGs"
fi
