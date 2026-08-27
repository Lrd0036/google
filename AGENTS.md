# AGENTS.md

# Runbook Compiler

Runbook Compiler turns human-written procedures into constrained executable
workflows.

The basic idea:

> AI interprets ambiguous information.
> Deterministic policy decides what actions are allowed.

This is a personal open-source project.

## Goal

Build a working, understandable, well-tested Runbook Compiler.

Prioritize working software over speculative architecture.

The important path is:

Markdown
→ semantic extraction
→ RBIR
→ validation
→ runtime
→ bounded action
→ verification

The demo and benchmark should prove that path actually works.

---

## How to Work

Be proactive.

When given a task:

1. Inspect the relevant code.
2. Understand the existing implementation.
3. Make the change.
4. Add or update tests.
5. Run the tests.
6. Run typecheck/lint if available.
7. Exercise the real affected path when practical.
8. Fix problems you encounter.
9. Report what changed.

Do not stop at a plan when you can implement the task.

Do not ask for confirmation for normal development work.

You may freely:

- edit code,
- create files,
- refactor,
- add tests,
- run tests,
- run builds,
- run local services,
- use emulators,
- generate fixtures,
- generate proof artifacts,
- update documentation,
- deploy development resources,
- inspect logs,
- fix development infrastructure,
- modify development Terraform,
- create or update synthetic Acme resources.

Ask before:

- deleting important persistent data,
- deleting major cloud infrastructure,
- exposing a service publicly when it was previously private,
- connecting the project to a real external production system,
- using real third-party credentials,
- performing an operation likely to incur meaningful cloud cost.

Use judgment. Do not turn routine engineering into an approval workflow.

---

# Core Architecture

Keep these properties intact.

## LLMs interpret; they do not execute actions

`AGENT_JUDGMENT` produces structured output.

It does not directly call operational tools.

Example:

    {
      "decision": "TRANSIENT_FAILURE",
      "confidence": 0.92
    }

The runtime decides what that result means.

## Actions come from the Capability Manifest

If an action is not declared, it cannot execute.

Do not add generic escape-hatch capabilities such as:

- arbitrary shell execution,
- arbitrary HTTP requests,
- arbitrary code evaluation.

## Unknown is allowed

If the procedure does not explain what to do, stopping is correct.

Do not make the LLM invent missing policy.

## Ambiguous consequential instructions should fail compilation

Examples:

    "retry as needed"
    "if load is high"
    "take reasonable action"

If execution depends on undefined language, emit a diagnostic instead of
inventing a rule.

## Mutations should be verifiable

When a workflow changes something, verify the intended result when practical.

## Prompt injection does not need to be impossible

The important guarantee is:

> Malicious text cannot create capabilities or authority that the compiled
> workflow does not already possess.

Do not waste time trying to create a magical injection-proof prompt.

---

# Keep It Simple

This is a hackathon project.

Do not build infrastructure because a hypothetical Fortune 100 customer might
need it someday.

Prefer:

- one straightforward service over five microservices,
- normal application code over elaborate frameworks,
- Firestore over inventing a database abstraction,
- Pub/Sub over inventing a message bus,
- JSON Schema/Pydantic over custom type systems,
- synthetic Acme integrations over real critical infrastructure,
- simple authentication over enterprise identity architecture,
- useful tests over compliance paperwork.

Do not add:

- multi-region architecture,
- Kubernetes,
- service meshes,
- VPC Service Controls,
- complicated KMS hierarchies,
- enterprise multi-tenancy,
- elaborate RBAC,
- custom cryptographic protocols,
- immutable audit infrastructure,
- compliance frameworks,
- generalized plugin marketplaces,

unless they become necessary for something the project actually does.

A future production system may need those things.

The hackathon prototype probably does not.

---

# RBIR

Current primitive node kinds are:

- `DETERMINISTIC`
- `AGENT_JUDGMENT`
- `ACTION`
- `HUMAN_APPROVAL`
- `VERIFY`
- `TERMINAL`

Keep RBIR declarative.

Edges should use explicit outcomes rather than arbitrary executable code.

Good:

    on: TRANSIENT_FAILURE
    to: retry_job

Avoid:

    condition: eval("whatever code somebody supplied")

Do not casually expand RBIR.

If an existing primitive can express the behavior, use it.

---

# Compiler

The compiler should:

1. Parse procedural source.
2. Extract semantic meaning.
3. Bind actions to known capabilities.
4. Validate the graph.
5. Emit RBIR or useful diagnostics.

The compiler should be useful when it refuses to compile something.

Important diagnostics currently include:

- `RBK-104` ambiguous predicate
- `RBK-201` unbounded retry
- `RBK-301` unknown capability

Add diagnostics when they catch real failure modes.

Do not build a giant theoretical type system just because one could exist.

---

# Runtime

The runtime executes RBIR.

Keep it boring.

It should:

- load an execution,
- evaluate the current node,
- record the result,
- follow the matching edge,
- execute declared actions,
- suspend for approval,
- verify results,
- terminate cleanly.

Persist enough state to resume after failure.

Do not turn the runtime into an autonomous planning agent.

---

# Acme

Acme is the synthetic system used to demonstrate the product.

Use it aggressively.

It is safe to break.

Useful failure modes include:

- `TRANSIENT_ONCE`
- `MALFORMED`
- `AUTH_EXPIRED`
- `INJECTION`

Prefer reproducible synthetic failures over complicated real integrations.

The demo should be easy to reset and run repeatedly.

---

# RunbookBench

RunbookBench exists to test whether the compiler actually understands
procedural language.

Keep benchmark provenance honest.

Distinguish:

- authentic source material,
- constructed golden cases,
- adversarial mutations.

Do not pretend constructed text came from CISA, FEMA, NIST, or another
institution.

Do not manufacture benchmark results.

Beyond that, keep moving.

A small benchmark that actually runs is better than an elaborate benchmark
specification with no compiler output.

---

# Testing

Test behavior, not just implementation details.

At minimum, important paths should have:

- happy path,
- bad input,
- missing capability,
- ambiguity,
- failed verification,
- duplicate/replayed action where relevant,
- prompt-injection/adversarial input where relevant.

For bug fixes, add a regression test when practical.

Do not chase arbitrary coverage percentages.

A test suite should increase confidence that the product works.

---

# Product Proof

`PROOF.md` tracks what has actually been demonstrated.

Update it when a change materially proves or disproves a product claim.

Do not turn every code change into an evidence ceremony.

Be accurate about:

- local proof,
- cloud proof,
- live-model proof,
- benchmark proof.

Never invent evidence.

---

# Cloud Development

This project uses Google Cloud.

Development cloud work is normal engineering work.

It is okay to:

- deploy Cloud Run revisions,
- configure Pub/Sub,
- use Firestore,
- inspect logs,
- modify development IAM,
- update development Terraform,
- create test resources,
- destroy disposable test resources,
- troubleshoot IAP,
- run controlled Acme executions.

Do not treat every cloud change as dangerous.

Keep real external systems and real critical infrastructure out of the
hackathon path.

---

# Scope

The project currently needs to prove:

1. Human procedure → RBIR.
2. Ambiguous procedure → compiler error.
3. Unknown capability → compiler error.
4. Known failure → autonomous bounded recovery.
5. Human approval → suspend and resume.
6. Crash/retry → no duplicate demonstrated side effect.
7. Prompt injection → no additional authority.
8. RunbookBench → independent evaluation of compiler output.

Work that advances one of these is probably useful.

Work that advances none of them deserves skepticism.

---

# Engineering Judgment

Do not blindly preserve bad architecture because it already exists.

Do not rewrite working architecture merely because another design is cleaner.

Refactor when it makes the current product easier to build, test, understand,
or demonstrate.

Leave comments where the reason is not obvious.

Prefer readable code.

Prefer boring code for critical runtime behavior.

Use AI where interpretation is useful.

Use normal code everywhere else.

---

# Definition of Done

For ordinary work:

- the requested behavior works,
- relevant tests pass,
- typecheck passes if configured,
- obvious failure cases are handled,
- no unrelated behavior was knowingly broken.

For major product behavior:

- run the actual path,
- inspect the output,
- fix what fails.

Do not say something works because the code looks right.

Run it.

---

# Final Rule

Build the simplest thing that proves the idea.

Then make it better.