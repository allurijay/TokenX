#!/usr/bin/env bash
set -euo pipefail
mkdir -p backups docs/evidence
drill_db="tokenex_drill_$(date -u +%s)"
start_seconds=$SECONDS
docker compose exec -T db pg_dump -U tokenex -d tokenex -Fc --no-owner --no-acl > backups/drill.dump
docker compose exec -T db createdb -U tokenex "$drill_db"
docker compose exec -T db pg_restore -U tokenex -d "$drill_db" --no-owner --no-acl < backups/drill.dump
result=$(docker compose exec -T db psql -U tokenex -d "$drill_db" -Atc "SELECT count(*) FROM (SELECT transaction_id FROM journal_line GROUP BY transaction_id HAVING sum(debit_minor-credit_minor)<>0) x")
if [ "$result" != "0" ]; then printf 'Restore ledger invariant failed\n'; exit 1; fi
original=$(docker compose exec -T db psql -U tokenex -d tokenex -Atc 'SELECT count(*) FROM customer_order')
restored=$(docker compose exec -T db psql -U tokenex -d "$drill_db" -Atc 'SELECT count(*) FROM customer_order')
if [ "$original" != "$restored" ]; then printf 'Concurrent writes occurred; rerun in a quiet window\n'; exit 1; fi
printf '{"result":"passed","elapsedSeconds":%s,"ordersRestored":%s,"unbalancedTransactions":0,"scope":"Local PostgreSQL dump/restore; not managed-service PITR or production RPO certification"}\n' "$((SECONDS-start_seconds))" "$restored" > docs/evidence/restore.json
docker compose exec -T db dropdb -U tokenex "$drill_db"
printf 'Isolated restore drill passed. Source database unchanged.\n'
