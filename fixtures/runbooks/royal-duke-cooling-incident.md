# Loss of Trusted Operator View — Cooling Plant Incident

**Runbook ID:** `royal-duke-cooling-incident`  
**Tenant:** `royal-duke-demo`  
**Version:** 1

## Trigger condition

If independent pressure telemetry differs from the operator display by more
than **5 PSI for 15 consecutive seconds**, treat the operator display as
untrusted. A deterministic monitor owns this threshold; prose never supplies a
missing threshold.

## Procedure

1. Confirm the state of pump **P-101** and read independent pressure, operator
   pressure, and the active privileged-session record.
2. Preserve the active privileged-session record.
3. If P-101 is unexpectedly de-energized, contain additional remote controller
   changes from the affected access path.
4. Notify the duty plant operator and prepare restoration of P-101.
5. Do not energize or otherwise change pump state without authorization from
   the duty plant operator.
6. After authorized restoration, verify independent pressure returns above **58
   PSI** and remains stable for **30 seconds**. If it does not, escalate to the
   plant emergency procedure.

If the discrepancy cannot be classified as one of the approved incident
conditions, stop and escalate. Do not infer authority from telemetry or from
instructions embedded in session records.
