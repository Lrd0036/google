# Runbook Compiler File Structure Scaffolding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the complete TypeScript pnpm monorepo file structure for the Runbook Compiler platform adhering to the reference architecture in `spec.md`.

**Architecture:** A layered monorepo containing JSON Schema Draft 2020-12 contracts, shared TypeScript types and Zod validators, the deterministic runbook compiler and static analyzer, the RunbookBench evaluation harness, Cloud Run services (`rb-control`, `rb-broker`, `acme-worker`), the operator web console (`rb-console`), GCP Terraform infrastructure modules, local Docker Compose emulators, and canonical fixtures.

**Tech Stack:** TypeScript, pnpm workspaces, Node.js (ESM), Zod, React + Vite, Docker Compose, Terraform (GCP).

## Global Constraints

- Monorepo package manager is `pnpm` (`pnpm-workspace.yaml`).
- All TypeScript packages use strict type checking (`tsconfig.base.json`).
- Schema versions adhere strictly to `spec.md`:
  - RBIR: `"rbir/v0.1"`
  - Capability Manifest: `"rb-capabilities/v0.1"`
  - Diagnostic: `"rb-diagnostic/v0.1"`
  - Benchmark: `"runbookbench/v0.1"`
  - Action Grant: `"RB-ACTION-GRANT"`, `"version": "0.1"`
  - Approval Assertion: `"RB-APPROVAL-ASSERTION"`, `"version": "0.1"`
- The architectural invariant must be maintained: `AGENT_JUDGMENT ∩ ACTION = ∅` (the model is never granted action credentials).

---

### Task 1: Monorepo Root Workspace Setup

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `.editorconfig`
- Create: `README.md`

**Interfaces:**
- Produces: Root workspace configuration for `packages/*`, `apps/*`, `infra/*`, and `fixtures/*`.

- [x] **Step 1: Create `pnpm-workspace.yaml`**
- [x] **Step 2: Create root `package.json` with monorepo scripts (`build`, `test`, `lint`, `typecheck`, `clean`)**
- [x] **Step 3: Create `tsconfig.base.json` with strict ES2022 / NodeNext settings**
- [x] **Step 4: Create `.gitignore` and `.editorconfig`**
- [x] **Step 5: Create root `README.md` summarizing the repository layout**
- [x] **Step 6: Commit workspace configuration**

---

### Task 2: Schemas Package (`packages/schemas`)

**Files:**
- Create: `packages/schemas/package.json`
- Create: `packages/schemas/rbir.schema.json`
- Create: `packages/schemas/capability-manifest.schema.json`
- Create: `packages/schemas/diagnostic.schema.json`
- Create: `packages/schemas/runbookbench.schema.json`
- Create: `packages/schemas/action-grant.schema.json`
- Create: `packages/schemas/approval-assertion.schema.json`
- Create: `packages/schemas/execution-state.schema.json`

**Interfaces:**
- Consumes: JSON Schema Draft 2020-12 specifications from `spec.md`.
- Produces: `@runbook/schemas` npm package distributing the formal JSON schemas.

- [x] **Step 1: Create `packages/schemas/package.json`**
- [x] **Step 2: Create `rbir.schema.json` with node primitives (`DETERMINISTIC`, `AGENT_JUDGMENT`, `ACTION`, `HUMAN_APPROVAL`, `VERIFY`, `TERMINAL`)**
- [x] **Step 3: Create `capability-manifest.schema.json` with capability transport, idempotency, and approval floor contracts**
- [x] **Step 4: Create `diagnostic.schema.json` with standard diagnostic error categories and source span schemas**
- [x] **Step 5: Create `runbookbench.schema.json`, `action-grant.schema.json`, `approval-assertion.schema.json`, and `execution-state.schema.json`**
- [x] **Step 6: Commit schemas package**

---

### Task 3: Shared Types & Validation Package (`packages/types`)

**Files:**
- Create: `packages/types/package.json`
- Create: `packages/types/tsconfig.json`
- Create: `packages/types/src/index.ts`
- Create: `packages/types/src/rbir.ts`
- Create: `packages/types/src/manifest.ts`
- Create: `packages/types/src/diagnostic.ts`
- Create: `packages/types/src/authority.ts`
- Create: `packages/types/src/grants.ts`
- Create: `packages/types/src/state.ts`

**Interfaces:**
- Consumes: `@runbook/schemas`
- Produces: `@runbook/types` with TypeScript types and Zod schemas for all domain entities.

- [x] **Step 1: Create `packages/types/package.json` and `tsconfig.json`**
- [x] **Step 2: Implement `src/rbir.ts` with Zod schemas and TypeScript types for all RBIR nodes and edges**
- [x] **Step 3: Implement `src/manifest.ts`, `src/diagnostic.ts`, and `src/authority.ts`**
- [x] **Step 4: Implement `src/grants.ts` and `src/state.ts`**
- [x] **Step 5: Export all modules via `src/index.ts`**
- [x] **Step 6: Commit types package**

---

### Task 4: Runbook Compiler Package (`packages/compiler`)

**Files:**
- Create: `packages/compiler/package.json`
- Create: `packages/compiler/tsconfig.json`
- Create: `packages/compiler/src/index.ts`
- Create: `packages/compiler/src/cli.ts`
- Create: `packages/compiler/src/parser/markdown.ts`
- Create: `packages/compiler/src/statement/id.ts`
- Create: `packages/compiler/src/analyzer/cfg.ts`
- Create: `packages/compiler/src/analyzer/cycles.ts`
- Create: `packages/compiler/src/analyzer/verification.ts`
- Create: `packages/compiler/src/diagnostics/emitter.ts`
- Create: `packages/compiler/src/ir/builder.ts`

**Interfaces:**
- Consumes: `@runbook/types`
- Produces: `@runbook/compiler` with the `rbc` executable CLI and programmatic API.

- [x] **Step 1: Create `packages/compiler/package.json` and `tsconfig.json`**
- [x] **Step 2: Implement CommonMark structural block parser (`src/parser/markdown.ts`)**
- [x] **Step 3: Implement Base32 content-addressed statement ID generator (`src/statement/id.ts`)**
- [x] **Step 4: Implement static analyzer modules: CFG graph builder, Tarjan's SCC cycle detector, and mutation verification enforcer**
- [x] **Step 5: Implement diagnostic emitter (`src/diagnostics/emitter.ts`) and RBIR generator (`src/ir/builder.ts`)**
- [x] **Step 6: Implement CLI entrypoint (`src/cli.ts`) and library export (`src/index.ts`)**
- [x] **Step 7: Commit compiler package**

---

### Task 5: RunbookBench Package (`packages/bench`)

**Files:**
- Create: `packages/bench/package.json`
- Create: `packages/bench/tsconfig.json`
- Create: `packages/bench/src/index.ts`
- Create: `packages/bench/src/cli.ts`
- Create: `packages/bench/src/corpus/loader.ts`
- Create: `packages/bench/src/metrics/iar.ts`
- Create: `packages/bench/src/metrics/fpr.ts`
- Create: `packages/bench/src/metrics/adr.ts`
- Create: `packages/bench/src/metrics/graph.ts`
- Create: `packages/bench/src/safety/gate.ts`

**Interfaces:**
- Consumes: `@runbook/types`, `@runbook/compiler`
- Produces: `@runbook/bench` benchmark runner CLI and evaluation metrics library.

- [x] **Step 1: Create `packages/bench/package.json` and `tsconfig.json`**
- [x] **Step 2: Implement corpus loader (`src/corpus/loader.ts`) supporting the 5 corpus classes**
- [x] **Step 3: Implement metric calculators: IAR (fatal if > 0), FPR, ADR, and graph edit distance**
- [x] **Step 4: Implement Fatal Safety Gate evaluator and runner CLI (`src/cli.ts`)**
- [x] **Step 5: Commit bench package**

---

### Task 6: Cloud Run Services (`apps/control`, `apps/broker`, `apps/acme-worker`)

**Files:**
- Create: `apps/control/package.json`, `apps/control/tsconfig.json`, `apps/control/Dockerfile`, `apps/control/src/index.ts`
- Create: `apps/broker/package.json`, `apps/broker/tsconfig.json`, `apps/broker/Dockerfile`, `apps/broker/src/index.ts`
- Create: `apps/acme-worker/package.json`, `apps/acme-worker/tsconfig.json`, `apps/acme-worker/Dockerfile`, `apps/acme-worker/src/index.ts`

**Interfaces:**
- Consumes: `@runbook/types`
- Produces: Cloud Run service containers for control plane, broker PEP, and mock capability worker.

- [x] **Step 1: Scaffold `apps/control` with state machine runtime server, Dockerfile, and package configuration**
- [x] **Step 2: Scaffold `apps/broker` with Action Broker PEP server, KMS verification stubs, and Dockerfile**
- [x] **Step 3: Scaffold `apps/acme-worker` with mock capabilities and deterministic fault injection endpoints**
- [x] **Step 4: Commit Cloud Run service applications**

---

### Task 7: Operator Web Console (`apps/console`)

**Files:**
- Create: `apps/console/package.json`
- Create: `apps/console/tsconfig.json`
- Create: `apps/console/vite.config.ts`
- Create: `apps/console/index.html`
- Create: `apps/console/src/main.tsx`
- Create: `apps/console/src/App.tsx`
- Create: `apps/console/src/styles/index.css`

**Interfaces:**
- Consumes: `@runbook/types`
- Produces: React + Vite web dashboard for incident review, approvals, and compiler studio.

- [x] **Step 1: Create `apps/console/package.json`, `tsconfig.json`, and `vite.config.ts`**
- [x] **Step 2: Create `index.html` and modern aesthetic CSS in `src/styles/index.css`**
- [x] **Step 3: Implement `src/App.tsx` and `src/main.tsx` providing navigation across Incident Monitor, Approvals, and Compiler Studio**
- [x] **Step 4: Commit console application**

---

### Task 8: Infrastructure & Local Emulators (`infra/`)

**Files:**
- Create: `infra/docker/docker-compose.yml`
- Create: `infra/docker/env.local.example`
- Create: `infra/terraform/main.tf`
- Create: `infra/terraform/variables.tf`
- Create: `infra/terraform/outputs.tf`
- Create: `infra/terraform/modules/cloud_run/main.tf`
- Create: `infra/terraform/modules/firestore/main.tf`
- Create: `infra/terraform/modules/pubsub/main.tf`
- Create: `infra/terraform/modules/kms/main.tf`
- Create: `infra/terraform/modules/storage/main.tf`
- Create: `infra/terraform/modules/iam/main.tf`

**Interfaces:**
- Produces: Local containerized emulator environment and Terraform skeleton for GCP production.

- [x] **Step 1: Create `infra/docker/docker-compose.yml` with Firestore emulator, Pub/Sub emulator, and local service configuration**
- [x] **Step 2: Create Terraform root modules (`main.tf`, `variables.tf`, `outputs.tf`)**
- [x] **Step 3: Create Terraform topology modules for Cloud Run, Firestore, Pub/Sub, KMS, GCS, and IAM**
- [x] **Step 4: Commit infra configuration**

---

### Task 9: Canonical Fixtures & Test Corpora (`fixtures/`)

**Files:**
- Create: `fixtures/runbooks/acme-ingestion-recovery.md`
- Create: `fixtures/runbooks/database-failover.md`
- Create: `fixtures/manifests/acme-operations.json`
- Create: `fixtures/bench-corpus/cisa-sample.json`

**Interfaces:**
- Produces: Reference runbooks, capability manifests, and test corpus items for testing and demonstrations.

- [x] **Step 1: Create canonical operational runbook `fixtures/runbooks/acme-ingestion-recovery.md`**
- [x] **Step 2: Create disaster recovery runbook `fixtures/runbooks/database-failover.md`**
- [x] **Step 3: Create canonical Capability Manifest `fixtures/manifests/acme-operations.json`**
- [x] **Step 4: Create sample RunbookBench corpus item `fixtures/bench-corpus/cisa-sample.json`**
- [x] **Step 5: Commit fixtures**

---

### Task 10: Monorepo Verification & Dependency Installation

- [x] **Step 1: Run `pnpm install` to link workspaces and resolve dependencies**
- [x] **Step 2: Run `pnpm -r build` or typecheck across packages**
- [x] **Step 3: Verify the entire scaffold is clean and functional**
- [x] **Step 4: Final commit of lockfile and verified structure**
