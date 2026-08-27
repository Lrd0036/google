# Controlled Cloud Re-enablement Status

Evidence snapshot: 2026-08-27, project `project-87ae1ae6-1a71-468d-943`, region `us-central1`.

## Current authorization decision

`CLOUD_EXECUTION_ALLOWED = false`.

The corpus is structurally valid but non-publishable because all 12 cases remain `ANNOTATION_PENDING`. No human annotator or adjudicator identity was fabricated. There is no active `v1_release_state/controlled-cloud-reenable-v0.1` record. Broker mutations and Control cloud execution are explicitly disabled, and all service-to-service execution invoker bindings are absent.

## Deployed containment

- Console: revision `rb-console-00005-s2x`, image `sha256:507c12a7ee79baccb38a606c708a1a742f23ac3d7082674df51ed3bbf0cbc0ee`, direct IAP enabled, no `allUsers`, `CONSOLE_DATA_MODE=DEMO`.
- Control: revision `rb-control-00004-jc8`, image `sha256:50d71c461b59d1e8826f76d51efbeffc596029d3492c7eb224ceca1f43ef62de`, `CLOUD_EXECUTION_ENABLED=false`.
- Broker: revision `rb-broker-00004-pjd`, image `sha256:7c5b85f4bbbea32bebefe8574390510f9537713efb5ddff31fbd9478ceb024f3`, `BROKER_MUTATIONS_ENABLED=false`, `STATE_SCHEMA=runtime/v1`.
- Authority: private revision `rb-authority-00001-wqt`, image `sha256:1454ceb272ae5c5476c82f1ac1505cf9df9c0ae0b34f6498c2374796d0ecbd05`, no Console invoker binding.
- Audit Writer: private revision `rb-audit-writer-00001-bjl`, image `sha256:a54a3b20bf3c7c853ab79939a597f9360b888db596aa047e83835de5eedfcfb4`, no invoker binding.
- Acme Worker remains at the `security3` image and has no Broker invoker binding.

## Provisioned but not release-authorizing

- Separate `rb-authority`, `rb-audit-writer`, and `rb-release-gate` service accounts.
- Dedicated `approval-assertion-signer` and `release-attestation-signer` asymmetric KMS keys.
- Private `runbook-artifacts` and `runbook-release-attestations` buckets.
- Existing audit bucket remains an unlocked, retention-protected audit archive.
- Daily Firestore backup schedule with seven-day retention.
- `rb-ops-alerts` Pub/Sub topic and Monitoring Pub/Sub notification channel.

These resources establish boundaries; they do not prove backup restoration, alert delivery, negative runtime behavior, current benchmark PASS, or an eligible release.

## Remaining external evidence

1. Two independent human annotation files and adjudicated gold for every corpus item.
2. Actual compiler submissions for all 12 cases and a current passing report.
3. Runtime-negative suite against the deployed identities and exact artifact generations.
4. Console authenticated-render test after an operator signs into IAP; unauthenticated redirect is verified.
5. Audit delivery drill, Firestore restore-to-new-database drill, and alert-delivery drill.
6. Terraform import/adoption of the pre-existing and manually provisioned project resources, followed by review of the full 7.45.0 upgrade plan.

Only after those produce current evidence should the release-gate identity issue and activate an eligible attestation and the invocation edges be restored in the specified order.
