#!/usr/bin/env bash
# Assemble the portfolio video: brand frames + generated VO -> sam-demo.mp4
# Usage: FFMPEG=/path/to/ffmpeg bash portfolio/build-video.sh
set -euo pipefail
cd "$(dirname "$0")"
FFMPEG="${FFMPEG:-ffmpeg}"
# Relative work dir + relative names inside concat lists: the Windows
# ffmpeg binary cannot resolve MSYS /tmp paths written into list files.
WORK=".vwork"
rm -rf "$WORK"; mkdir -p "$WORK"
trap 'rm -rf "$WORK"' EXIT

vid() { # vid <img> <dur> <out>  — silent video part
  "$FFMPEG" -y -loglevel error -loop 1 -t "$2" -i "frames/$1" \
    -f lavfi -t "$2" -i anullsrc=r=48000:cl=stereo \
    -c:v libx264 -preset medium -tune stillimage -pix_fmt yuv420p -r 30 \
    -c:a aac -b:a 160k -shortest "$WORK/$3"
}

beat() { # beat <out> <wav> <img:dur> [img:dur...] — frames + narration
  local out=$1 wav=$2; shift 2
  local list="$WORK/list-$out.txt"; : > "$list"
  local i=0
  for spec in "$@"; do
    vid "${spec%%:*}" "${spec##*:}" "part-$out-$i.mp4"
    echo "file 'part-$out-$i.mp4'" >> "$list"
    i=$((i+1))
  done
  "$FFMPEG" -y -loglevel error -f concat -safe 0 -i "$list" -c copy "$WORK/vid-$out.mp4"
  "$FFMPEG" -y -loglevel error -i "$WORK/vid-$out.mp4" -i "vo/$wav" \
    -map 0:v -map 1:a -c:v copy \
    -af "aresample=48000,aformat=channel_layouts=stereo,apad" -shortest \
    -c:a aac -b:a 160k "$WORK/$out.mp4"
}

echo "building segments…"
vid  f0-title.png 4.0 seg0.mp4
beat seg1 beat1.wav f1-briefing.png:22.0
beat seg2 beat2.wav f2a-heartbeat.png:18.0 f2b-gate.png:17.5
beat seg3 beat3.wav f3a-duplicate.png:12.0 f3b-escalation.png:17.6
beat seg4 beat4.wav f4-killswitch.png:15.0
beat seg5 beat5.wav f5-eval.png:23.0
vid  f6-end.png 6.0 seg6.mp4
mv "$WORK/seg0.mp4" "$WORK/z0.mp4"; mv "$WORK/seg6.mp4" "$WORK/z6.mp4"

FINAL="$WORK/final-list.txt"; : > "$FINAL"
for s in z0 seg1 seg2 seg3 seg4 seg5 z6; do echo "file '$s.mp4'" >> "$FINAL"; done
"$FFMPEG" -y -loglevel error -f concat -safe 0 -i "$FINAL" -c copy sam-demo.mp4
"$FFMPEG" -loglevel error -i sam-demo.mp4 -f null - 2>&1 | tail -1 || true
echo "done: portfolio/sam-demo.mp4"
