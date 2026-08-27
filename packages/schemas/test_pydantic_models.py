import unittest

from pydantic import ValidationError

from pydantic_models import ActionGrant, CapabilityDefinition, CapabilityManifest, CompilerDiagnostic, DiagnosticArtifact


SHA = "sha256:" + "a" * 64


def capability(capability_id: str = "observe_job") -> dict:
    return {
        "id": capability_id,
        "version": 1,
        "description": "Observe one job.",
        "semantic_actions": ["observe job"],
        "mode": "READ",
        "risk": "R0_OBSERVE",
        "transport": {
            "type": "HTTP",
            "service": "worker",
            "method": "GET",
            "path": "/capabilities/job",
            "audience": "https://worker.example",
            "allowed_host": "worker.example",
        },
        "input_schema": {"type": "object"},
        "output_schema": {"type": "object"},
        "timeout_ms": 1000,
        "idempotency": {"strategy": "NATIVE_KEY", "header": "Idempotency-Key"},
        "approval_floor": "PREAPPROVED_RUNBOOK",
        "credential_profile": "worker-read-v1",
    }


class ContractTests(unittest.TestCase):
    def test_manifest_rejects_duplicate_ids(self):
        with self.assertRaises(ValidationError):
            CapabilityManifest(
                manifest_version="rb-capabilities/v0.1",
                id="worker",
                version=1,
                capabilities=[capability(), capability()],
            )

    def test_grant_requires_context_hashes_and_valid_lifetime(self):
        with self.assertRaises(ValidationError):
            ActionGrant(
                typ="RB-ACTION-GRANT", version="0.1", iss="rb-control", aud="rb-broker",
                jti="grant-1", iat=10, exp=10, execution_id="exec", node_id="node",
                node_attempt=1, capability="observe_job", params_sha256=SHA,
                runbook_ir_sha256=SHA, manifest_sha256=SHA, trigger_sha256=SHA,
                lease_generation=1, control_epoch=1,
            )

    def test_contracts_reject_unknown_fields_and_type_coercion_boundaries(self):
        value = capability()
        value["timeout_ms"] = "1000"
        with self.assertRaises(ValidationError):
            CapabilityDefinition(**value)
        value = capability()
        value["unexpected"] = True
        with self.assertRaises(ValidationError):
            CapabilityDefinition(**value)

    def test_diagnostic_rejects_invalid_confidence_and_empty_resolution(self):
        source = {"uri": "fixture.md", "start": {"line": 1, "column": 1, "byte": 0}, "end": {"line": 1, "column": 2, "byte": 1}}
        diagnostic = {"code": "RBK-114", "severity": "ERROR", "category": "AMBIGUOUS_PREDICATE", "message": "ambiguous", "statement_id": "stmt-1", "source": source, "required_resolution": ["human review"], "suggested_fix": {"kind": "HUMAN_ESCALATION", "advisory_only": True, "replacement": "review", "confidence": 1.1}}
        with self.assertRaises(ValidationError):
            CompilerDiagnostic(**diagnostic)
        diagnostic.pop("suggested_fix")
        diagnostic["required_resolution"] = []
        with self.assertRaises(ValidationError):
            CompilerDiagnostic(**diagnostic)

    def test_diagnostic_artifact_is_strict(self):
        with self.assertRaises(ValidationError):
            DiagnosticArtifact(diagnostic_version="rb-diagnostic/v0.1", diagnostics=[], extra=True)


if __name__ == "__main__":
    unittest.main()
