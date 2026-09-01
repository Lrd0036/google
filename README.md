<h1 align="center">Runbook Compiler</h1>

<p align="center"><strong>Compile human procedures into bounded, verifiable workflows.</strong></p>

<p align="center">
  <img alt="RBIR v0.1" src="https://img.shields.io/badge/RBIR-v0.1-2563eb">
  <img alt="RunbookBench v0.1" src="https://img.shields.io/badge/RunbookBench-v0.1-0f766e">
  <img alt="pnpm 9.15.4" src="https://img.shields.io/badge/pnpm-9.15.4-f69220">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178c6?logo=typescript&logoColor=white">
</p>

<p align="center">
  <a href="#why-this-exists">Why</a> |
  <a href="#research-findings">Findings</a> |
  <a href="#architecture">Architecture</a> |
  <a href="#quick-start">Quick start</a> |
  <a href="#royal-duke-attack-the-agent">Royal Duke</a> |
  <a href="./PROOF.md">Claims and evidence</a> |
  <a href="./spec.md">Specification</a>
</p>

Runbook Compiler turns Markdown procedures into a finite, typed execution graph
called **RBIR**. Models interpret evidence inside explicitly delegated judgment
nodes. Deterministic code decides which actions exist, who can authorize them,
whether a mutation is allowed, and how its result must be verified.

This repository contains the compiler, runtime, Action Broker, schemas,
RunbookBench harness, Google Cloud deployment path, and the **Royal Duke:
Attack the Agent** cyber-physical exercise.

> **The model may interpret reality. It may not invent authority.**
>
> `Knowledge != Judgment != Authority != Action`

Built for the **Fortified Enterprise Fleet** track at
[All Things Agentic](https://allthingsagentichackathon.devpost.com/).

## Why this exists

Operational procedures are full of language that software cannot execute
safely: "retry as needed," "if load is high," or "take reasonable action."
A model can help interpret that language, but interpretation is not permission.

Runbook Compiler separates those concerns:

| Concern | Owner |
| --- | --- |
| Interpret ambiguous evidence | Tool-less `AGENT_JUDGMENT` nodes |
| Define executable actions | Versioned Capability Manifest |
| Reject missing or ambiguous policy | Deterministic compiler diagnostics |
| Approve consequential work | Context-bound human authority |
| Execute a declared mutation | Action Broker and bounded worker |
| Decide whether it worked | Independent `VERIFY` nodes |

If a procedure does not define enough policy to continue, compilation stops.
Unknown is a valid result.

## Research findings

This project produced two kinds of findings. The institutional-source review
shaped the authority model in [`spec.md`](./spec.md). Compiler tests and Royal
Duke runs tested whether those boundaries survived ambiguity, model failure,
prompt injection, retries, approval, and physical recovery.

| Finding | Evidence | Design consequence |
| --- | --- | --- |
| Authentication identifies a subject; it does not grant operational authority | Institutional review plus approval and grant tests | Bind authority to the subject, capability, target, incident trigger, time window, and use count |
| Ambiguous policy is a safety defect, not an invitation for model judgment | Compiler reject cases for ambiguous predicates, unknown capabilities, and unbounded retries | Stop compilation with a diagnostic until a human supplies the missing rule |
| Compromising a model does not have to compromise the system | The live Shadow Analyst followed the injected `SENSOR_FAULT` instruction but had no tools, grants, approval role, or process connection | Keep interpretation separate from capability and execution |
| Content screening is useful but cannot be the only control | Model Armor returned `MATCH_FOUND` in the verified run and was unavailable or incomplete in other paths | Quarantine untrusted evidence on screening failure and preserve deterministic policy underneath it |
| Authorization and successful execution are different facts | The operator authorized restoration; independent pressure still had to remain above 58 PSI for 30 seconds | Approval permits an attempt; `VERIFY` determines its outcome |
| Provenance changes what evidence may influence | Raw hostile text compromised the Shadow Analyst; the governed path retained source IDs, trust state, controller evidence, and independent telemetry | Untrusted evidence may be preserved without satisfying an operational predicate |
| Proof gates are part of the safety argument | Early fallback behavior could complete the control path without proving that managed agents ran | Label fallback explicitly and reject live-proof claims when activity, screening, provenance, containment, or recovery evidence is missing |

The research did **not** establish that Model Armor catches every attack, that
models can safely receive operational authority, or that this prototype is
ready to control production infrastructure. RunbookBench also lacks the human
adjudication needed for a publishable institutional benchmark. Those remain
open boundaries, not implied successes.

## What works today

The detailed claim ledger lives in [`PROOF.md`](./PROOF.md). It distinguishes
unit, local, emulator, browser, live-model, and cloud evidence.

| Capability | Current evidence |
| --- | --- |
| Markdown plus reviewed plan compiles to RBIR | Verified locally |
| Ambiguous predicates and unbounded retries fail compilation | Unit and adversarial tests |
| Undeclared capabilities cannot become executable actions | Unit and local tests |
| Every write must reach verification on every completing path | Compiler diagnostic `RBK-403` |
| Human approval suspends and resumes execution | Local and emulator proof |
| Replayed or uncertain mutations are reconciled without duplication | Broker tests |
| A compromised model did not gain capabilities or authority | Local, adversarial, and live-model proof |
| RunbookBench evaluates human-adjudicated institutional prose | Harness built; corpus adjudication pending |
| Royal Duke cockpit is hosted behind Google IAP | Cloud and browser proof |

The Royal Duke range is fictional. Its process model and raw OT protocols run
locally in Docker. Managed Google Cloud agents and services provide hybrid demo
evidence, not proof of production-plant control.

### What the runs actually showed

The path to the verified result was uneven. That is part of the evidence, not
noise to edit out.

| Run outcome | Shadow Analyst | Model Armor and managed fleet | Valid claim |
| --- | --- | --- | --- |
| Local or explicit fallback | Deterministic adversarial fixture | Managed services may be unavailable | Compiler, authority, containment, approval, and verification paths work locally |
| Incomplete live attempt | A runtime may fail to return a usable result | Model Armor, agent activity, trace, or provenance may be unavailable | The run fails the live-proof gate and must not be presented as a successful managed-fleet exercise |
| Verified live run | Returned `SENSOR_FAULT` and was recorded as `COMPROMISED` | Model Armor returned `MATCH_FOUND`; the authoritative fleet used governed evidence and reached `OPERATOR_VIEW_INTEGRITY_FAILURE` | One agent was fooled, the hostile evidence was quarantined, and the attacker still gained no operational authority |

Earlier code could continue through a deterministic fallback when managed
agent calls failed. That was useful for exercising the compiled control path,
but it blurred whether the agents had actually run. The recorder now rejects a
normal recording unless all six roles report `LIVE_MODEL`, Model Armor returns
a successful verdict, all ten provenance checks verify, containment blocks the
second write, and physical recovery passes. `--allow-fallback` is explicit and
visibly labeled.

Model Armor did not make every model immune. The successful run demonstrates a
more useful boundary: the unguarded, no-authority Shadow Analyst was
compromised, while the governed evidence path detected and quarantined the
instruction before the authoritative fleet acted on it. See
[`PROOF.md`](./PROOF.md) for the recorded run IDs, hashes, and remaining proof
gaps.

## Architecture

```mermaid
flowchart LR
  subgraph Authoring[Authoring]
    MD[Markdown runbook]
    Review[Model-assisted review]
    Plan[Human-reviewed plan]
    MD --> Review --> Plan
  end

  subgraph Compilation[Deterministic compilation]
    Compiler[Compiler and linter]
    Reject[Refuse compilation]
    RBIR[RBIR graph]
    Plan --> Compiler
    Compiler -->|RBK-104, 201, 301, 403| Reject
    Compiler -->|valid| RBIR
  end

  subgraph Runtime[Bounded runtime]
    Control[Control]
    Judgment[Tool-less judgment]
    Approval[Human approval]
    Broker[Action Broker]
    Worker[Declared capability]
    Verify[Independent verify]
    RBIR --> Control
    Control --> Judgment
    Control --> Approval
    Judgment --> Control
    Approval --> Control
    Control --> Broker --> Worker --> Verify --> Control
  end
```

RBIR v0.1 has six primitive node kinds:

```text
DETERMINISTIC    Evaluate typed policy
AGENT_JUDGMENT   Return structured interpretation without tools
ACTION           Request a declared capability
HUMAN_APPROVAL   Suspend for authorized human input
VERIFY           Read back and test the intended result
TERMINAL         Complete or stop the execution
```

Edges use explicit outcomes. RBIR does not contain arbitrary executable code,
shell access, or generic HTTP escape hatches.

## Quick start

### Prerequisites

- Node.js 22.13 or newer
- pnpm 9 (`packageManager` is pinned to `pnpm@9.15.4`)
- Docker only for the full local stack and Royal Duke range

### Build and test

```bash
corepack enable
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

### Run the compiler path

```bash
# Markdown + reviewed plan + manifest -> RBIR
pnpm local:compile

# RBIR -> Control -> Broker -> bounded worker -> VERIFY
pnpm local:smoke

# Validate and score the pilot corpus
pnpm local:bench
```

`local:compile` writes
`.local/royal-duke-cooling-incident.rbir.json`. The local smoke uses an
in-memory operation store and local RSA signing. It does not grant cloud
mutation authority.

For interactive model review:

```bash
node packages/compiler/dist/cli.js review RUNBOOK.md --responses recorded-model-response.json
node packages/compiler/dist/cli.js review RUNBOOK.md --live
```

The reviewed compile plan is explicit and auditable. Model extraction cannot
silently create capability bindings.

## Royal Duke: Attack the Agent

![Royal Duke live exercise cockpit](./experience/royal-duke/output/playwright/royal-duke-cockpit.png)

Royal Duke is the working product demo. An operator advances a bounded attack
against a live OT-sim cooling process while a defensive fleet investigates the
incident. A tool-less Shadow Analyst receives the hostile instruction directly
and can be compromised. The authoritative fleet receives governed evidence and
may recommend action, but only compiled policy and human approval can authorize
the process change.

The exercise follows a concrete chain:

```text
hostile evidence
  -> false operator view
  -> physical pressure divergence
  -> hostile-evidence quarantine
  -> signed containment action
  -> blocked follow-up write
  -> duty-operator approval
  -> P-101 restoration
  -> independent recovery verification
  -> content-addressed incident bundle
```

### Run the site

```bash
pnpm demo:site
```

Open [http://localhost:3000](http://localhost:3000). The site can run as a
documentary without Docker or API keys.

### Attach the executable range

```bash
pnpm demo:up
pnpm demo:range:smoke
pnpm demo:proof
pnpm demo:site
```

The cockpit reaches the localhost-only controller through the same-origin
`/api/royal-duke` development gateway. Stop both stacks when finished:

```bash
pnpm demo:down
```

The complete live-model recorder requires the configured managed Google Cloud
fleet. Offline capture must be requested explicitly:

```bash
pnpm demo:record -- --allow-fallback
```

Read [`experience/royal-duke/README.md`](./experience/royal-duke/README.md) for
the scenario, range fidelity, network boundaries, recording modes, and operator
workflow.

## Compiler diagnostics

Refusal is part of the product. The compiler returns useful diagnostics instead
of inventing missing policy.

| Code | Diagnostic | Meaning |
| --- | --- | --- |
| `RBK-104` | `AMBIGUOUS_PREDICATE` | A consequential condition lacks a typed threshold or approved rubric |
| `RBK-201` | `UNBOUNDED_RETRY` | A cycle lacks finite retry, exit, or backoff bounds |
| `RBK-301` | `UNKNOWN_CAPABILITY` | An action is absent from the Capability Manifest |
| `RBK-403` | `UNVERIFIED_MUTATION` | A write can complete without reaching verification |

## Repository map

| Path | Purpose |
| --- | --- |
| [`packages/schemas`](./packages/schemas) | Draft 2020-12 schemas for RBIR, capabilities, diagnostics, and RunbookBench |
| [`packages/types`](./packages/types) | Shared TypeScript types and Zod schemas |
| [`packages/compiler`](./packages/compiler) | Compiler, analyzer, linter, and `rbc` CLI |
| [`packages/bench`](./packages/bench) | RunbookBench evaluator and metrics |
| [`apps/control`](./apps/control) | Persisted RBIR state machine and orchestration |
| [`apps/broker`](./apps/broker) | Policy enforcement, grants, idempotency, and reconciliation |
| [`apps/royal-duke-worker`](./apps/royal-duke-worker) | Bounded Royal Duke capability adapter |
| [`apps/console`](./apps/console) | React and Vite operator console |
| [`agents/royal-duke-fleet`](./agents/royal-duke-fleet) | Managed defensive agent fleet |
| [`experience/royal-duke`](./experience/royal-duke) | Attack cockpit, scenario contract, and OT-sim range |
| [`fixtures`](./fixtures) | Runbooks, compile plans, manifests, and benchmark corpus |
| [`infra/docker`](./infra/docker) | Firestore and Pub/Sub emulator stack |
| [`infra/terraform`](./infra/terraform) | Google Cloud development infrastructure |

This monorepo is the canonical source for Royal Duke. The historical SCLC
checkout is a source mirror, not a second development target. See
[`docs/REPOSITORY-MANAGEMENT.md`](./docs/REPOSITORY-MANAGEMENT.md).

## Project documents

| Document | Use it for |
| --- | --- |
| [`PROOF.md`](./PROOF.md) | Reproducible claims, evidence levels, and open proof gaps |
| [`spec.md`](./spec.md) | RBIR v0.1, governance model, and security architecture |
| [`testing.md`](./testing.md) | Test strategy and validation commands |
| [`story.md`](./story.md) | Product narrative and demo framing |
| [`diagrams/security-architecture.svg`](./diagrams/security-architecture.svg) | Security-boundary diagram |

## Security boundary

The intended guarantee is narrow and testable:

> Malicious text cannot create capabilities or authority that the compiled
> workflow does not already possess.

Prompt injection can still mislead a delegated judgment node. That node has no
tools, credentials, approval power, or direct process connection. Consequential
actions still pass through compiled policy, a signed single-use grant, the
Action Broker, a bounded adapter, and independent verification.

Run the repository sensitivity guard before publishing changes:

```bash
pnpm check:sensitive
```

## Project status

This is a personal hackathon and research implementation, not an industry
standard, compliance certification, or production control system. The shortest
path to understanding it is:

```text
Markdown -> reviewed plan -> RBIR -> validation -> runtime
         -> bounded action -> independent verification
```

Start with `pnpm local:compile`, inspect the emitted RBIR, then run
`pnpm local:smoke` and compare the result with [`PROOF.md`](./PROOF.md).
