#!/bin/sh
set -eu

project_id=${1:?usage: firestore-restore-drill.sh PROJECT_ID BACKUP_NAME TEMP_DATABASE_ID}
backup_name=${2:?usage: firestore-restore-drill.sh PROJECT_ID BACKUP_NAME TEMP_DATABASE_ID}
temporary_database=${3:?usage: firestore-restore-drill.sh PROJECT_ID BACKUP_NAME TEMP_DATABASE_ID}

case "$temporary_database" in
  rb-restore-drill-*) ;;
  *) echo "Temporary database id must start with rb-restore-drill-" >&2; exit 2 ;;
esac

started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
gcloud firestore databases restore --project="$project_id" --source-backup="$backup_name" --destination-database="$temporary_database" --async
cat <<EOF
{"schema":"runbook-restore-drill/v0.1","project_id":"$project_id","backup":"$backup_name","temporary_database":"$temporary_database","started_at":"$started_at","status":"RESTORE_STARTED","required_follow_up":["wait for operation completion","compare document counts and sampled hashes","compare composite indexes","verify or reapply TTL policies","verify or reapply Security Rules","record RPO and RTO","delete temporary database only after evidence review"],"claim_boundary":"Same-location restore exercise; not multi-region DR proof."}
EOF
