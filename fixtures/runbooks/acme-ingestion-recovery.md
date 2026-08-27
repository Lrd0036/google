# Acme Data Ingestion Recovery Runbook

**Runbook ID:** `acme-ingestion-recovery`  
**Tenant:** `acme-demo`  
**Version:** 7  

## Trigger Condition
When an ingestion pipeline failure alert `INGESTION_JOB_STALLED` or `UPSTREAM_503` is received.

## Procedures

1. **Classify Failure Mode**
   The on-call engineer or automated classifier must inspect the recent ingestion telemetry and categorize the failure into one of the following exact categories:
   - `TRANSIENT_UPSTREAM_FAILURE`
   - `SCHEMA_MISMATCH`
   - `CORRUPTED_BATCH`

2. **Remediation Actions**
   - If classified as `TRANSIENT_UPSTREAM_FAILURE`:
     The operator must execute the `retry_job` capability with the provided `job_id`.
     The retry count must not exceed 3 attempts.
   - If classified as `SCHEMA_MISMATCH`:
     The operator must drain the ingestion queue using `drain_queue` and escalate to the data engineering lead.
   - If classified as `CORRUPTED_BATCH`:
     The operator must halt processing immediately and request human approval from the Operations Lead before discarding any records.

3. **Post-Action Verification**
   Following any retry action, the operator must execute `verify_job_completion` to confirm that the pipeline resumed normal processing.
   If verification fails after 3 attempts, escalate to on-call incident command.
