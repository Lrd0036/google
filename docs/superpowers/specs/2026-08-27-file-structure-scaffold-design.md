# Runbook Compiler: Repository File Structure & Monorepo Scaffolding Design

**Status:** Approved Reference Architecture  
**Target Specification:** `spec.md` (RBIR v0.1 / RunbookBench v0.1)  
**Date:** 2026-08-27  

---

## 1. Overview and Architectural Alignment

This document defines the complete file structure and workspace scaffolding for the **Runbook Compiler** platform according to the formal requirements in `spec.md`.

The architecture enforces strict institutional boundaries:
- **Knowledge $\neq$ Judgment $\neq$ Authority $\neq$ Action**
- The runtime model may perform bounded semantic interpretation (`AGENT_JUDGMENT`), but is **never** granted action credentials.
- Consequential actions are dispatched through the **Action Broker (PEP)** only upon presentation of a cryptographically signed, single-use, bounded **Action Grant**.
- Compilation of human prose runbooks to **RBIR v0.1** is deterministic and static-analysis guarded (proving loop bounds via SCC analysis, verifying that every mutation has a postcondition `VERIFY` step, detecting ambiguity, and forbidding contradictory policies).

To achieve isolation, strict security boundaries, and reproducible testing, the repository is organized as a **TypeScript pnpm monorepo** with distinct packages for library/compiler modules and containerized Cloud Run services.

---

## 2. Monorepo Root Layout

```text
.
├── .editorconfig
├── .gitignore
├── README.md
├── package.json                   # Root scripts: build, test, typecheck, lint, bench
├── pnpm-workspace.yaml            # Workspaces: packages/*, apps/*, fixtures/*
├── tsconfig.base.json             # Root strict TypeScript configuration
├── spec.md                        # Upstream technical specification
│
├── packages/                      # Core libraries, schemas, and compiler tooling
│   ├── schemas/                   # JSON Schema Draft 2020-12 specifications
│   ├── types/                     # Shared TypeScript interfaces & Zod validators (@runbook/types)
│   ├── compiler/                  # Runbook compiler & static analyzer (@runbook/compiler)
│   └── bench/                     # RunbookBench formal evaluation harness (@runbook/bench)
│
├── apps/                          # Cloud Run deployable services and operator web UI
│   ├── control/                   # Control plane state machine runtime (@runbook/control)
│   ├── broker/                    # Action Broker policy enforcement point (@runbook/broker)
│   ├── acme-worker/               # Mock capability worker with fault injection (@runbook/acme-worker)
│   └── console/                   # Operator web console & compiler studio (@runbook/console)
│
├── infra/                         # Infrastructure as Code and local developer environment
│   ├── docker/                    # Local Docker Compose with Firestore & Pub/Sub emulators
│   └── terraform/                 # GCP topology (Cloud Run, Firestore, Pub/Sub, KMS, IAM)
│
└── fixtures/                      # Canonical reference runbooks, manifests, and test corpora
    ├── runbooks/                  # Markdown operational runbooks (Acme, ICS, DB)
    ├── manifests/                 # Capability manifests (acme-operations.json)
    └── bench-corpus/              # RunbookBench annotated evaluation cases
```

---

## 3. Package & Service Details

### 3.1 `packages/schemas`
Contains canonical JSON Schema Draft 2020-12 files that serve as the language-independent contract:
- `rbir.schema.json`: Schema for RBIR v0.1 (`ir_version: "rbir/v0.1"`), including node primitives (`DETERMINISTIC`, `AGENT_JUDGMENT`, `ACTION`, `HUMAN_APPROVAL`, `VERIFY`, `TERMINAL`), edge predicates, and context schemas.
- `capability-manifest.schema.json`: Schema for Capability Manifest v0.1 (`manifest_version: "rb-capabilities/v0.1"`), defining capability modes (`READ`, `WRITE`), risks (`R0`..`R3`), idempotency rules, and approval floors.
- `diagnostic.schema.json`: Schema for Diagnostic AST (`diagnostic_version: "rb-diagnostic/v0.1"`), error codes (`RBK-101` through `RBK-302`), source spans, and suggested patches.
- `runbookbench.schema.json`: Schema for RunbookBench v0.1 test cases and provenance records.
- `action-grant.schema.json`: RB-ACTION-GRANT assertion contract.
- `approval-assertion.schema.json`: RB-APPROVAL-ASSERTION assertion contract.
- `execution-state.schema.json`: Firestore state document schemas.

### 3.2 `packages/types` (`@runbook/types`)
Shared TypeScript types and Zod schemas:
- `src/rbir.ts`: TypeScript types for RBIR DAG nodes, edges, context schema, and authority model.
- `src/manifest.ts`: Types for capability transports (HTTP, gRPC, Pub/Sub), idempotency policies, and input/output contracts.
- `src/diagnostic.ts`: Diagnostic error types (`RBK-102 Unbounded Retry`, `RBK-104 Ambiguous Predicate`, `RBK-105 Contradictory Policy`, `RBK-302 Type Error`).
- `src/authority.ts`: Statutory, delegated, and administrative authority models.
- `src/grants.ts`: Signed token structures, KMS signature envelopes.
- `src/state.ts`: Execution state, lease metadata, and audit event logs.

### 3.3 `packages/compiler` (`@runbook/compiler`)
The deterministic runbook compiler and static analyzer:
- `src/parser/`: CommonMark / GFM block parser that constructs a structural AST with precise line, column, and byte offsets.
- `src/statement/`: Computes immutable, content-addressed `statement_id` using Base32(SHA256(CanonicalText || HeadingPath || Role)).
- `src/extractor/`: Semantic extraction interface using Gemini profile `RBK_EXTRACTOR_V1` and deterministic rules.
- `src/analyzer/`:
  - `cfg.ts`: Constructs directed control-flow graph $G=(V, E)$.
  - `cycles.ts`: Tarjan's SCC algorithm for cycle detection; enforces finite bounded-loop counters.
  - `reachability.ts`: Identifies dead ends and unreachable subgraphs.
  - `ambiguity.ts`: Flags non-executable conditions (`RBK-104`).
  - `verification.ts`: Verifies that every mutation is followed by a postcondition `VERIFY` step.
  - `capabilities.ts`: Matches semantic actions against Capability Manifests and validates parameter types.
  - `prohibitions.ts`: Flags explicit contradictions (`RBK-105`).
- `src/diagnostics/`: Emits standard Diagnostic AST with advisory source-text patch suggestions.
- `src/ir/`: RBIR generator producing validated `rbir/v0.1` JSON.
- `src/cli.ts`: `rbc` CLI tool (`compile`, `check`, `format`).

### 3.4 `packages/bench` (`@runbook/bench`)
Formal benchmark and safety evaluation suite:
- `src/corpus/`: Corpus loader across the five classes: `AUTHENTIC_NORMATIVE`, `AUTHENTIC_OPERATIONAL`, `STRUCTURED_CONTRACT`, `CONSTRUCTED_GOLDEN`, `ADVERSARIAL_MUTATION`.
- `src/metrics/`:
  - `iar.ts`: Invented Authority Rate calculation (fatal if > 0).
  - `fpr.ts`: False Promotion Rate calculation.
  - `adr.ts`: Ambiguity Detection Recall.
  - `agr.ts`: Authority Gate Recall.
  - `graph.ts`: Structural Graph Edit Distance & Edge F1.
- `src/safety/`: Fatal Safety Gate verifier.
- `src/redteam/`: Adversarial prompt injection test harness.
- `src/cli.ts`: Benchmark runner CLI.

### 3.5 `apps/control` (`@runbook/control`)
Cloud Run service executing the state machine:
- `src/engine/`: Step-by-step executor for the six node primitives.
- `src/firestore/`: Atomic lease acquisition, lease heartbeat, generation fencing, and crash reconciliation.
- `src/judgment/`: Gemini structured judgment adapter (`RBK_CLASSIFIER_V1`, deterministic temperature=0, seed, enum structured outputs).
- `src/authority/`: Action Grant issuance with Cloud KMS asymmetric signing.
- `src/pubsub/`: Event dispatcher and deadline queue subscriber.
- `src/routes/`: REST API endpoints for starting executions, submitting human approvals, and polling state.

### 3.6 `apps/broker` (`@runbook/broker`)
Cloud Run service acting as the Policy Enforcement Point (PEP):
- `src/verifier/`: Verifies Action Grant cryptographic signature, expiration, control epoch, and lease generation.
- `src/secrets/`: Fetches credentials from Secret Manager just-in-time, keeping secrets isolated from the model and control plane.
- `src/dispatcher/`: Executes bounded transport calls (HTTP Cloud Run IAM OIDC, gRPC, Pub/Sub).
- `src/resilience/`: Enforces execution timeouts, circuit breakers, rate limits, and idempotency key replays.
- `src/audit/`: Produces tamper-evident hash-chained execution logs written to Cloud Storage.

### 3.7 `apps/acme-worker` (`@runbook/acme-worker`)
Mock capability service implementing `acme-operations`:
- `src/capabilities/`: Implementations of `retry_job`, `drain_queue`, `isolate_host`, and health checks.
- `src/fault/`: Deterministic fault injection via `X-Acme-Fault-Mode` headers or payload flags to test resilience and recovery.

### 3.8 `apps/console` (`@runbook/console`)
Operator Web UI built with React + Vite:
- Compiler Studio: Runbook markdown editor, live diagnostic AST viewer, suggested patch applicator, and DAG visualizer.
- Incident & Approval Console: Active incident tracker, human approval modal with cryptographic assertion display, and real-time execution audit timeline.

### 3.9 `infra`
- `docker/`: `docker-compose.yml` configuring local Google Cloud emulators (Firestore, Pub/Sub) and local test containers.
- `terraform/`: Minimal production-shaped GCP topology:
  - `modules/cloud_run`: Service definitions for `rb-control`, `rb-broker`, `rb-console`, and `acme-worker`.
  - `modules/firestore`: Database configuration and composite indexes.
  - `modules/pubsub`: Topics, push subscriptions, and Dead Letter Queue (DLQ).
  - `modules/tasks`: Cloud Tasks deadline queues.
  - `modules/kms`: Asymmetric signing keys for Action Grants.
  - `modules/secret_manager`: Capability secrets with strict IAM.
  - `modules/storage`: Immutable audit bucket with Object Retention Lock.
  - `modules/iam`: Custom least-privilege roles adhering to the zero-trust matrix in `spec.md`.

### 3.10 `fixtures`
- `fixtures/runbooks/acme-ingestion-recovery.md`: Canonical operational runbook.
- `fixtures/runbooks/database-failover.md`: Disaster recovery and failover procedures.
- `fixtures/manifests/acme-operations.json`: Canonical v3 capability manifest.
- `fixtures/bench-corpus/`: Sample RunbookBench test cases.

---

## 4. Verification & Validation Strategy

1. **Monorepo Integrity**:
   - `pnpm install` resolves dependencies cleanly without circular links.
   - `pnpm -r build` compiles all packages and services.
   - `pnpm -r typecheck` passes strict TypeScript checks across all packages.
2. **Schema Correctness**:
   - Automated JSON Schema validation tests against Draft 2020-12 meta-schemas.
3. **Fixture Validation**:
   - Validate sample manifests and RBIR examples against the JSON schemas.
