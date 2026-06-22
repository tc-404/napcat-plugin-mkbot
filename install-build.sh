#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

echo "[MKbot] 1/2 npm install ..."
npm install

echo "[MKbot] 2/2 pnpm run build ..."
pnpm run build

echo "[MKbot] build done"
read -r -p "Press Enter to exit..." _
