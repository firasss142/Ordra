#!/usr/bin/env bash
#
# Lance les tests SQL contre la base LOCALE.
#
#   supabase/tests/run.sh                  → tous les fichiers *_test.sql
#   supabase/tests/run.sh stock_variant_axis_test.sql
#
# JAMAIS contre la production : ces tests écrivent pour de vrai et ne
# nettoient pas (inventory_log et order_history sont en écriture seule, donc
# un test propre est impossible sur une base qui compte). La base locale est
# jetable — `supabase db reset` la remet à neuf.
#
# La pile locale doit tourner. Le conteneur storage échoue sur le CLI 2.48.3
# (« Migration optimize-existing-functions-again not found »), sans rapport
# avec notre schéma, d'où la liste d'exclusion :
#
#   supabase start -x storage-api,imgproxy,studio,logflare,vector,supavisor,edge-runtime,realtime,mailpit

set -euo pipefail

DB_URL="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
cd "$(dirname "$0")"

if ! psql "$DB_URL" -tAc 'SELECT 1' >/dev/null 2>&1; then
  echo "✗ Pas de base locale sur $DB_URL — lancez d'abord 'supabase start'." >&2
  exit 1
fi

files=("$@")
if [ ${#files[@]} -eq 0 ]; then
  # shellcheck disable=SC2207
  files=($(ls -1 ./*_test.sql))
fi

failed=0
for f in "${files[@]}"; do
  echo "▶ $f"
  # ON_ERROR_STOP est dans le fichier ; une assertion ratée lève une exception
  # et psql sort en erreur. -q pour ne garder que les NOTICE des assertions.
  if psql "$DB_URL" -q -v ON_ERROR_STOP=1 -f "$f"; then
    echo ""
  else
    echo "✗ $f a échoué"
    failed=1
  fi
done

exit "$failed"
