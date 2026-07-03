#!/usr/bin/env bash
# Screenshot every generated HTML frame at 1920x1080 with headless Edge.
set -euo pipefail
cd "$(dirname "$0")"
EDGE="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
mkdir -p frames
for f in frames-html/*.html; do
  name=$(basename "$f" .html)
  "$EDGE" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size=1920,1080 --screenshot="$(pwd -W 2>/dev/null || pwd)/frames/$name.png" \
    "file:///$(cd "$(dirname "$f")" && pwd -W 2>/dev/null || pwd)/$(basename "$f")" 2>/dev/null
  echo "shot: frames/$name.png"
done
