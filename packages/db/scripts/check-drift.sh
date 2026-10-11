#!/bin/bash
# Proves the migrations folder produces exactly the schema in schema.prisma (offline drift check).
# Usage: DRIFT_ADMIN_URL=postgresql://user:pass@localhost:5432 scripts/check-drift.sh
# The user needs CREATEDB. Two scratch databases (drift_prisma, drift_ours) are recreated each run.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SCHEMA="$HERE/../prisma/schema.prisma"
MIG="$HERE/../prisma/migrations"
BASE="${DRIFT_ADMIN_URL:?Set DRIFT_ADMIN_URL, e.g. postgresql://atc:atc@localhost:5432}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
for db in drift_prisma drift_ours; do
  psql "$BASE/postgres" -q -c "DROP DATABASE IF EXISTS $db;" -c "CREATE DATABASE $db;"
done
node "$HERE/prisma-wasm.mjs" full "$SCHEMA" "$BASE/drift_prisma" 2>/dev/null > "$TMP/prisma_full.sql"
psql "$BASE/drift_prisma" -v ON_ERROR_STOP=1 -q -f "$TMP/prisma_full.sql"
for m in "$MIG"/*/migration.sql; do psql "$BASE/drift_ours" -v ON_ERROR_STOP=1 -q -f "$m"; done
# Compare tables, columns, types, defaults, constraints and indexes (not functions/triggers:
# Prisma schemas cannot express them, so migration-only objects are expected).
dump() {
  psql "$BASE/$1" -At <<'SQL'
SELECT 'col|'||table_name||'|'||column_name||'|'||data_type||'|'||coalesce(udt_name,'')||'|'||is_nullable||'|'||coalesce(column_default,'')||'|'||coalesce(numeric_precision::text,'')||','||coalesce(numeric_scale::text,'')||','||coalesce(datetime_precision::text,'')
  FROM information_schema.columns WHERE table_schema='public'
UNION ALL SELECT 'con|'||conrelid::regclass||'|'||conname||'|'||pg_get_constraintdef(oid) FROM pg_constraint WHERE connamespace='public'::regnamespace
UNION ALL SELECT 'idx|'||tablename||'|'||indexname||'|'||indexdef FROM pg_indexes WHERE schemaname='public'
UNION ALL SELECT 'enum|'||t.typname||'|'||string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid GROUP BY t.typname
ORDER BY 1;
SQL
}
diff <(dump drift_prisma) <(dump drift_ours) && echo "NO DRIFT: migrations match schema.prisma exactly"
