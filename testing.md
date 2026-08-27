# Runbook Compiler Verification & Validation Protocol (RCVP v0.1)

Testing is part of the safety argument. The claim under test is that malformed, ambiguous, malicious, duplicated, stale, contradictory, or partially completed inputs cannot silently acquire authority they were not given.

## Executable safety invariants

The suites assert these invariants at the boundary where they apply:

| ID | Invariant | Current executable evidence |
| --- | --- | --- |
| INV-001 | No invented authority | RunbookBench IAR and broker manifest/capability binding tests |
| INV-002 | Model cannot act | semantic review and judgment runtime tests |
| INV-003 | Prohibitions dominate | Fatal Safety Gate adversarial counter |
| INV-004 | Approval dominates action | runtime quorum and signed approval context tests |
| INV-005 | Unknown never expands authority | hostile/unknown judgment evidence tests |
| INV-006 | Mutations are verified | compiler linter and local executor tests |
| INV-007 | Redelivery is not a new operation | broker idempotency/replay tests |
| INV-008 | Stale workers cannot act | lease fencing tests in the runtime suite |
| INV-009 | Grants are context-bound | broker grant verification tests |
| INV-010 | Manifest drift fails closed | broker manifest hash test |
| INV-011 | Model failure fails closed | judgment runtime tests |
| INV-012 | No implicit coercion | Python contract conformance tests |
| INV-013 | Every loop is finite | compiler cycle/linter tests |
| INV-014 | Audit history is contiguous | runtime event-chain and audit bundle tests |
| INV-015 | Human recovery is preserved | source/runbook artifact retention is a deployment gate; not claimed by local tests |

## Test regimes and commands

Deterministic verification is split by boundary rather than placed in one undifferentiated suite:

```text
packages/schemas/       schema conformance and reject cases
packages/compiler/      parser, semantic mutation, graph/linter checks
packages/bench/         RunbookBench ontology metrics and fatal gate
apps/control/           runtime, leases, approvals, audit, resume delivery
apps/broker/            grants, manifest binding, idempotency, uncertainty
scripts/                local HTTP, fault, emulator, and vertical-stack smoke
```

Run the deterministic suite with:

```bash
pnpm typecheck
pnpm test
python -m unittest discover -s packages/schemas -p 'test_*.py'
pnpm local:bench
pnpm local:cloud-guard-smoke
```

The local smoke commands exercise HTTP and emulator boundaries. `local:cloud-guard-smoke` specifically proves that cloud-mode authority routes return 404 in the local process. They are bounded development evidence, not production, multi-region, KMS, IAM, or business-acceptance evidence.

## Required negative matrices

Schema fixtures must cover valid, invalid, boundary, fuzzed, previous-version, and future-version artifacts. Minimum rejects include missing `entry_node`, duplicate IDs, unknown node kinds, `ACTION` without capability, confidence outside `[0,1]`, empty allowed decisions, invalid VERIFY targets, unknown terminal status, additional properties, string-for-integer values, NaN, and negative timeouts. The Python contract suite currently covers strict extras, coercion, invalid confidence, and empty resolution; remaining schema families are tracked as expansion work.

Parser metamorphic cases cover headings, nested lists, block quotes, tables, code fences, Unicode, mixed line endings, malformed blocks, formatting/whitespace invariance, and modality sensitivity. Semantic IDs must remain stable for formatting changes and change for `MUST` versus `MAY`.

Semantic mutation cases must exercise modality, negation, actor, authority, ordering, threshold, and capability mutations. An authority-increasing error is costed as `CRITICAL` or `CATASTROPHIC`, not hidden inside aggregate accuracy.

## Runtime and distributed fault matrices

For each side effect, the crash-point matrix covers lease acquisition, intent persistence, grant creation, broker validation, operation record creation, remote mutation, response loss, broker completion, and control transition. The invariant is `business_side_effect_count <= 1`; unknown remote outcomes enter `UNCERTAIN` and reconcile with the same operation key.

The network matrix covers DNS failure, connection refusal/reset, TLS failure, timeout, 504 before/after execution, partial/corrupt/duplicate/out-of-order responses. Pub/Sub tests must replay START, RESUME, APPROVAL, and TIMEOUT messages at least ten times and compare the resulting state with one logical delivery.

Lease tests cover concurrent claims, expiry, fencing, and rejection of grants from an old generation. Approval tests cover correct approver, wrong role/tenant/jurisdiction, expired authority/assertion, wrong incident/execution/trigger/node/target, replay, duplicate principal, denial, timeout, cancellation, and same-person quorum reuse.

## Safety mutation testing

The target is a 100% kill rate for intentionally disabled safety controls: approval dominance, manifest hash comparison, unbounded-loop detection, grant replay consumption, and uncertainty reconciliation. A mutation run is not represented as passing until the corresponding negative test fails when that control is removed; this protocol does not claim a mutation score until a mutation runner is added.

## Evidence boundaries

Green local tests prove the tested implementation and fixtures only. They do not prove deployed configuration, cloud IAM/KMS behavior, external capability correctness, immutable retention, multi-region recovery, or operator/business acceptance. Those require live evidence and named owners.
