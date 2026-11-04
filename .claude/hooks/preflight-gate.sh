#!/usr/bin/env bash
# Stop hook: blocks Claude from finishing while files have changed since the
# last successful preflight (scripts/preflight.ps1 writes .claude/.preflight-pass
# only when every check passes).
input="$(cat)"

# Claude was already sent back once by this gate. Let it stop and report instead of looping.
if echo "$input" | grep -Eq '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0

# Not a git repo, or nothing changed: nothing to gate.
[ -z "$(git status --porcelain 2>/dev/null)" ] && exit 0

stamp=".claude/.preflight-pass"
stamp_mtime=0
[ -f "$stamp" ] && stamp_mtime="$(stat -c %Y "$stamp" 2>/dev/null || echo 0)"

newest_file=""
newest_mtime=0
while IFS= read -r f; do
  [ -n "$f" ] && [ -f "$f" ] || continue
  m="$(stat -c %Y "$f" 2>/dev/null || echo 0)"
  if [ "$m" -gt "$newest_mtime" ]; then
    newest_mtime="$m"
    newest_file="$f"
  fi
done < <({ git diff --name-only HEAD; git ls-files -o --exclude-standard; } 2>/dev/null | sort -u)

# Only deleted files changed: no file to be newer than the stamp.
[ -z "$newest_file" ] && exit 0

if [ "$stamp_mtime" -ge "$newest_mtime" ]; then
  exit 0
fi

{
  if [ ! -f "$stamp" ]; then
    echo "Preflight has not passed in this working tree."
  else
    echo "Preflight is stale: $newest_file changed after the last passing preflight."
  fi
  echo "Run the final gate and report its real output before finishing:"
  echo "  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/preflight.ps1"
  echo "If this is a Tier 3 change, the independent reviewer must also have returned PASS."
} >&2
exit 2
