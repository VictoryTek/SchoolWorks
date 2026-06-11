#!/bin/sh
# backup.sh — nightly pg_dump to the mounted backup volume.
#
# Environment variables (all injected by docker-compose):
#   DB_USER             PostgreSQL username (default: techv2)
#   PGPASSWORD          PostgreSQL password (set by compose so pg_dump doesn't prompt)
#   BACKUP_RETAIN_COUNT How many backup files to keep (default: 7)
#   BACKUP_DIR          Directory to write backups (default: /backups)

set -e

DB_USER="${DB_USER:-techv2}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETAIN="${BACKUP_RETAIN_COUNT:-7}"
TIMESTAMP=$(date +%Y-%m-%d_%H%M%S)
FILE="${BACKUP_DIR}/tech_v2_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "[backup] starting pg_dump → $FILE"
pg_dump -h db -U "$DB_USER" --clean --if-exists tech_v2 | gzip > "$FILE"
echo "[backup] completed: $FILE ($(du -sh "$FILE" | cut -f1))"

# Prune: keep only the newest N files
COUNT=$(ls -1 "${BACKUP_DIR}"/tech_v2_*.sql.gz 2>/dev/null | wc -l)
if [ "$COUNT" -gt "$RETAIN" ]; then
  TO_DELETE=$(ls -1t "${BACKUP_DIR}"/tech_v2_*.sql.gz | tail -n +"$((RETAIN + 1))")
  echo "$TO_DELETE" | xargs -r rm -f
  echo "[backup] pruned $(echo "$TO_DELETE" | wc -l | tr -d ' ') old file(s), keeping newest $RETAIN"
else
  echo "[backup] retention ok ($COUNT/$RETAIN files)"
fi
