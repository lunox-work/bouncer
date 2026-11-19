#!/bin/sh
# The experiment archive the evidence/*.mjs scripts read as experiments/,
# kept in its own repository since 2026-11-20 (lunox-work/bouncer-evidence)
# so installing the skill does not clone it. Run from a bouncer checkout.
set -e
cd "$(dirname "$0")/.."
if [ -d experiments/.git ]; then
  git -C experiments pull --ff-only
elif [ -e experiments ]; then
  echo "experiments/ exists and is not a clone of lunox-work/bouncer-evidence; move it aside first." >&2
  exit 1
else
  git clone --depth 1 https://github.com/lunox-work/bouncer-evidence.git experiments
fi
echo "Files over 5 MiB: sh experiments/fetch-large-files.sh"
