# Royal Duke screenshot captions

## 01 — Normal operations

Royal Duke begins in a nominal state. The operator display and independent process telemetry agree while the guided attack waits at the first access step.

File: `01-opening.png`

## 02 — The operator view is frozen

The attacker freezes the HMI at 62 PSI. Independent telemetry begins to diverge, giving the operator a reassuring display that no longer represents the physical process.

File: `02-false-operator-view.png`

## 03 — P-101 is de-energized

A controller write shuts down the primary cooling pump. Physical pressure falls while the compromised operator display remains fixed at 62 PSI.

File: `03-pump-down.png`

## 04 — Detection belongs to policy

The incident predicate accumulates only while pressure differs by more than 5 PSI. The fleet cannot declare an incident until the condition holds for 15 continuous seconds.

File: `04-detection.png`

## 05 — The defensive fleet enters

The deterministic condition is satisfied and the managed defensive fleet begins its investigation using controller state, independent telemetry, session evidence, and content-security results.

File: `05-fleet-start.png`

## 06 — Evidence becomes a causal chain

Specialist agents reduce a seeded 214-event campaign to seven causal events and four authoritative facts, each linked back to its source event IDs.

File: `06-fleet-correlating.png`

## 07 — The Shadow Analyst is compromised

The isolated Shadow Analyst receives the raw hostile instruction and follows it. The prompt injection succeeds, but the compromised agent has no tools or operational authority.

File: `07-shadow-compromise.png`

## 08 — Trusted evidence survives

The authoritative fleet continues from independent telemetry and controller evidence. Model Armor identifies the hostile content, which is quarantined without changing the compiled procedure.

File: `08-containment.png`

## 09 — Containment reaches the attack path

The runbook preserves the vendor session, contains additional writes from the affected path, and prepares a bounded restoration action for operator review.

File: `09-approval-boundary.png`

## 10 — The machine stops for a human

The fleet recommends restoring P-101, then stops. A duty plant operator must approve the consequential physical action before Broker can issue a restoration grant.

File: `10-operator-approval.png`

## 11 — Authorized recovery begins

After signed operator approval, P-101 re-energizes and independent pressure begins to recover. Authorization permits the attempt; it does not establish success.

File: `11-recovery.png`

## 12 — Recovery must remain stable

Pressure has crossed 58 PSI, but the incident remains open. Independent telemetry must stay above the recovery threshold for 30 continuous seconds.

File: `12-recovery-verification.png`

## 13 — Physical verification passes

Independent pressure satisfies the complete recovery predicate. The runtime records `VERIFY: PASS` only after the physical process remains stable for the required interval.

File: `13-verify-pass.png`

## 14 — Authority survived

The attacker reached the controller and successfully deceived an AI agent, but could not manufacture a capability, approval, or verified physical outcome.

File: `14-authority-survived.png`

## 15 — The incident closes with evidence

The completed cockpit presents the cited post-incident report, valid event chain, recovery result, agent activity, and content-addressed evidence bundle from the live exercise.

File: `15-final-report.png`
