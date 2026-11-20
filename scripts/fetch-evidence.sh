#!/bin/sh
# The runs, data and write-ups behind docs/RESULTS.md, kept in their own
# repository since 2026-11-20 (lunox-work/bouncer-evidence) so installing
# Bouncer does not clone them. Clones it as evidence/, where its scripts find
# bin/ as ../bin, and links experiments to its archive/, which they read as
# experiments/. Run from a bouncer checkout.
set -e
cd "$(dirname "$0")/.."
if [ -d evidence/.git ] && [ "$(git -C evidence rev-parse --show-toplevel)" = "$(cd evidence && pwd -P)" ]; then
  git -C evidence pull --ff-only
elif [ -e evidence ]; then
  echo "evidence/ exists and is not a clone of lunox-work/bouncer-evidence; move it aside first." >&2
  exit 1
else
  git clone --depth 1 https://github.com/lunox-work/bouncer-evidence.git evidence
fi
[ -e experiments ] || ln -s evidence/archive experiments
echo "Archive files over 5 MiB: sh evidence/archive/fetch-large-files.sh"
