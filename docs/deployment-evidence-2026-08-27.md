# GCP Deployment Evidence — 2026-08-27

This record describes the bounded development deployment of Workstream 6 in
Google Cloud. It is deployment evidence for the named project and revisions;
it is not production acceptance, multi-region recovery evidence, or approval
to lock retention policies irreversibly.

## Deployment identity

| Field | Value |
| --- | --- |
| Project | `project-87ae1ae6-1a71-468d-943` (`248197109620`) |
| Region | `us-central1` |
| Build | Cloud Build `7f3eac14-aeda-4c06-bb7b-78ffac2d3397` (`SUCCESS`) |
| Image tag | `20260827-security3` (immutable) |
| Terraform state | `gs://project-87ae1ae6-1a71-468d-943-runbook-tfstate/runbook-compiler/dev` |

## Deployed services

| Service | URL | Access boundary | Image digest |
| --- | --- | --- | --- |
| `rb-console` | <https://rb-console-3a6a4r2mpq-uc.a.run.app> | Public static demo UI | `sha256:5821156bb970201510056fd3ccfa9249fc8a07e9d956b37afa36b9be2b3f73fd` |
| `rb-control` | <https://rb-control-3a6a4r2mpq-uc.a.run.app> | IAM authenticated; health-only containment | `sha256:d65984799582c926b52bafa529f952331e60b69c1020beb04a4819b9f7d2e01a` |
| `rb-broker` | <https://rb-broker-3a6a4r2mpq-uc.a.run.app> | IAM authenticated; no Control invoker binding | `sha256:76e4ad98a4bfa9b41e24f3cbb30ec016b781c39154f29440179325922b775b2c` |
| `acme-worker` | <https://acme-worker-3a6a4r2mpq-uc.a.run.app> | `rb-broker` invoker only | `sha256:04df5490a777af4a3f30c7b55c104b3ef427fa9aa57cb06f7bdaf63a512eeb83` |

Unauthenticated requests returned `200` for the console and `403` for Control,
Broker, and Worker. Authenticated Control health returned `200` and identified
the service as `rb-control`. Authenticated requests to `/executions`,
`/local/execute`, `/local/approve`, and `/events/resume` returned `404`.

Artifact Analysis reported no known package vulnerabilities for any of the
four `20260827-security3` images at verification time. The runtime stages use
a digest-pinned Node base, remove npm/Corepack build tooling, install only
production dependencies, run as the non-root `node` user, and upgrade Alpine
runtime packages during the build.

## Historical live execution proof

Before security containment was applied, execution
`exec-cloud-1787812205375` completed through:

```text
classify_failure -> retry_job -> verify_job_completion -> resolved
```

The path exercised an authenticated caller, private Control, a Cloud
KMS-signed action grant, private Broker, private Worker, and a VERIFY step.
Firestore recorded completed `retry_job@1` and `get_job_status@1` operations,
with the resulting job status `COMPLETED`. This is historical evidence for the
superseded `20260827-rcvp1` revision, not a claim that cloud execution remains
enabled in the current revision.

The signing key is KMS key version
`projects/project-87ae1ae6-1a71-468d-943/locations/us-central1/keyRings/runbook-keyring/cryptoKeys/action-grant-signer/cryptoKeyVersions/1`,
using `RSA_SIGN_PSS_3072_SHA256`. KMS and Secret Manager DATA_READ and
DATA_WRITE audit logging is enabled. At evidence-capture time, the new KMS
data-access entries had not yet appeared in Cloud Logging, so this record does
not claim direct log-level proof of the signing principal.

## Supporting controls

- Artifact Registry: `us-central1-docker.pkg.dev/project-87ae1ae6-1a71-468d-943/runbook-compiler`.
- The Pub/Sub resume topic/subscription and dead-letter policy remain
  provisioned, but Pub/Sub no longer has a Control invoker binding while the
  cloud resume route is contained.
- Cloud Tasks queue `rb-deadlines` is `RUNNING`, with ten attempts, 5-second
  minimum backoff, and 300-second maximum backoff.
- The Cloud Run 5xx monitoring policy is enabled. It has no notification
  channel, so it records incidents but does not page an operator.
- The audit and Terraform-state buckets enforce public-access prevention,
  uniform bucket-level access, and object versioning.
- The audit bucket has a one-year retention policy. It is deliberately not
  locked because locking is irreversible; set `lock_audit_retention=true`
  only under separately recorded authority.
- Secret Manager secret `rb-broker-credentials` exists without a secret
  version. No credential value was invented or uploaded.
- Artifact Registry enforces immutable tags; Terraform rejects `latest` and
  requires an explicit image tag.
- Control and Broker custom roles are limited to required Firestore operations;
  Broker has public-key view permission only on the exact signing key.
- Terraform reconciliation after the final deployment reported no changes.

## Known boundaries

- This is a single-region development/demo deployment with one warm instance
  per Cloud Run service, not a production or disaster-recovery topology.
- Cloud execution is deliberately disabled. Restoring it requires a trusted
  admission path for tenant identity, authoritative stored RBIR, approval-key
  registration, KMS signing, and immutable audit delivery. The removed
  Pub/Sub-to-Control and Control-to-Broker invoker edges must not be restored
  before those controls exist.
- The console is a public demo surface and has no SSO integration.
- The mock Acme worker is not an external operational system, and this run is
  not business acceptance of a real capability provider.
- Permanent retention lock, notification routing, multi-region recovery,
  external credentials, and production ownership remain explicit gates.
