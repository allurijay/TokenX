#!/usr/bin/env bash
set -euo pipefail
mkdir -p backups
backup_path="backups/tokenex-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose exec -T db pg_dump -U tokenex -d tokenex -Fc --no-owner --no-acl > "$backup_path"
printf 'Created %s\n' "$backup_path"
