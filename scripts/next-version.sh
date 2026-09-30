#!/usr/bin/env bash
# พิมพ์เลขเวอร์ชันถัดไป (vX.Y.Z) จาก commit ตั้งแต่ tag ล่าสุด ตามรูปแบบ Conventional Commits
#   มี "!:" หลัง type หรือ "BREAKING CHANGE:"  -> major
#   มี commit ขึ้นต้น "feat:" / "feat(scope):" -> minor
#   อื่น ๆ (fix:, chore:, ไม่มี prefix ฯลฯ)     -> patch
# ยังไม่มี tag เลย -> v1.0.0   ·   ไม่มี commit ใหม่หลัง tag ล่าสุด -> ไม่พิมพ์อะไร
set -euo pipefail

last=$(git describe --tags --abbrev=0 --match 'v[0-9]*.[0-9]*.[0-9]*' 2>/dev/null || true)
if [ -z "$last" ]; then
  echo "v1.0.0"
  exit 0
fi
if [ -z "$(git rev-list "$last"..HEAD)" ]; then
  exit 0
fi

log=$(git log --format='%s%n%b' "$last"..HEAD)
IFS=. read -r major minor patch <<<"${last#v}"
patch=${patch%%[^0-9]*}

if grep -Eq '^[a-zA-Z]+(\([^)]*\))?!:|^BREAKING[ -]CHANGE:' <<<"$log"; then
  major=$((major + 1)); minor=0; patch=0
elif grep -Eq '^feat(\([^)]*\))?:' <<<"$log"; then
  minor=$((minor + 1)); patch=0
else
  patch=$((patch + 1))
fi
echo "v$major.$minor.$patch"
