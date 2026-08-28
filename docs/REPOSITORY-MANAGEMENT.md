# Repository management

## Canonical source

The Runbook Compiler repository is the canonical source for the complete Royal
Duke demo. It owns both halves of the system:

- the compiler, RBIR runtime, broker, bounded worker, agent fleet, cloud
  configuration, tests, and evidence generation at the repository root; and
- the attack cockpit and executable OT simulation under
  `experience/royal-duke`.

The Royal Duke experience was imported from the local SCLC repository at commit
`b938d6b`, then the uncommitted cockpit and controller work from that checkout
was applied to the imported copy. The source SCLC checkout was not changed or
pushed during the import.

## Day-to-day development

Clone and work from this repository. Install once from the root with `pnpm
install`; do not maintain a second npm lockfile inside the experience package.
The root pnpm workspace includes `packages/*`, `apps/*`, and `experience/*`.

Useful commands:

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm demo:up
pnpm demo:range:smoke
pnpm demo:proof
pnpm demo:site
pnpm demo:down
```

`demo:up` attaches the range controller to the local Control service at
`http://host.docker.internal:8080` by default. Set `FLEET_API` before running
the command only when Control is intentionally hosted elsewhere. It also binds
the bounded Royal Duke worker back to the range controller at
`http://host.docker.internal:9400`; override `ROYAL_DUKE_CONTROLLER_URL` only
when the controller is intentionally hosted elsewhere.

Changes to the cockpit or range should be committed in this repository under
`experience/royal-duke`. The old SCLC repository is a historical source mirror,
not a second writable source of truth. Do not push new demo work there unless a
deliberate export or archival release is requested.

## History and future synchronization

The import used a squashed local Git subtree so the original source boundary is
recorded without merging an unrelated project history into every log entry.
The imported code is now ordinary monorepo code. Routine development does not
require subtree commands.

If a future one-time SCLC change must be recovered, inspect it first, apply only
the intended patch to `experience/royal-duke`, test from this repository root,
and record the source commit in the integrating commit. Do not configure an
automatic bidirectional sync; it would recreate split ownership.

## Publishing

No remote is currently configured for this combined repository. Adding a
remote and pushing this integration are separate release actions. The SCLC
remote must not be used as the destination for the monorepo.
