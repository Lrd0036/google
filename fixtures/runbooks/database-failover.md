# Primary Database Disaster Recovery Failover

**Runbook ID:** `database-failover`  
**Tenant:** `royal-duke-demo`
**Version:** 3  

## Trigger Condition
When primary database cluster reports unrecoverable hardware fault or primary heartbeat loss exceeding 300 seconds.

## Procedures

1. **Verify Replica Health**
   Check that standby read-replica lag is under 5 seconds using `check_replica_lag`.

2. **Acquire Human Approval**
   Promoting a standby replica to primary is a destructive mutation with operational risk tier `R3_DESTRUCTIVE_HIGH`.
   The system must halt autonomous execution and obtain an asymmetric cryptographic approval assertion from an authenticated `INCIDENT_COMMANDER` before proceeding.

3. **Execute Promotion**
   Upon receiving valid `RB-APPROVAL-ASSERTION`, execute `promote_replica_to_primary`.

4. **Verify Mutation**
   Execute `verify_cluster_master_elected` to ensure read/write traffic is accepted.
