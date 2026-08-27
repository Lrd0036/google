"""Typed v0.1 contracts shared by compiler and runtime boundaries.

These models deliberately reject unknown fields.  A token's single-use property
is enforced by the broker's atomic ``jti`` consumption; it is represented here
by the required, replay-addressable ``jti`` and short validity window.
"""

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, model_validator


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class RiskTier(str, Enum):
    R0_OBSERVE = "R0_OBSERVE"
    R1_REVERSIBLE_LOW = "R1_REVERSIBLE_LOW"
    R2_STATEFUL = "R2_STATEFUL"
    R3_HIGH_IMPACT = "R3_HIGH_IMPACT"
    R4_IRREVERSIBLE = "R4_IRREVERSIBLE"


class Transport(ContractModel):
    type: Literal["HTTP", "GRPC", "PUBSUB", "CLOUD_FUNCTION"]
    service: str | None = None
    method: str | None = None
    path: str | None = None
    audience: str | None = None
    allowed_host: str | None = None

    @model_validator(mode="after")
    def validate_http_route(self) -> "Transport":
        if self.type == "HTTP":
            if not self.method or not self.path or not self.audience or not self.allowed_host:
                raise ValueError("HTTP transport requires method, path, audience, and allowed_host")
            if not self.path.startswith("/"):
                raise ValueError("HTTP transport path must start with '/'")
        return self


class IdempotencyPolicy(ContractModel):
    strategy: Literal["NATIVE_KEY", "RECONCILABLE", "TRANSACTIONAL_LOCAL", "NONE"]
    header: str | None = None
    same_key_replay_safe: bool | None = None
    reconcile_capability: str | None = None

    @model_validator(mode="after")
    def validate_strategy(self) -> "IdempotencyPolicy":
        if self.strategy == "RECONCILABLE" and not self.reconcile_capability:
            raise ValueError("RECONCILABLE requires reconcile_capability")
        if self.strategy == "NATIVE_KEY" and not self.header:
            raise ValueError("NATIVE_KEY requires header")
        if self.strategy == "NONE" and self.same_key_replay_safe:
            raise ValueError("NONE cannot be marked replay-safe")
        return self


class CapabilityDefinition(ContractModel):
    id: str = Field(pattern=r"^[a-z][a-z0-9_.-]*$")
    version: int = Field(ge=1)
    description: str = Field(min_length=1)
    semantic_actions: list[str] = Field(min_length=1)
    mode: Literal["READ", "WRITE"]
    risk: RiskTier
    transport: Transport
    input_schema: dict[str, Any]
    output_schema: dict[str, Any]
    timeout_ms: StrictInt = Field(ge=100)
    idempotency: IdempotencyPolicy
    approval_floor: Literal[
        "PREAPPROVED_RUNBOOK", "OPERATIONS_LEAD", "INCIDENT_COMMANDER", "MULTI_PARTY_QUORUM"
    ]
    credential_profile: str = Field(min_length=1)

    @model_validator(mode="after")
    def validate_risk_mode(self) -> "CapabilityDefinition":
        if self.risk == RiskTier.R0_OBSERVE and self.mode != "READ":
            raise ValueError("R0_OBSERVE capabilities must be READ")
        if self.mode == "READ" and self.risk != RiskTier.R0_OBSERVE:
            raise ValueError("READ capabilities must be R0_OBSERVE")
        return self


class CapabilityManifest(ContractModel):
    manifest_version: Literal["rb-capabilities/v0.1"]
    id: str = Field(min_length=1)
    version: int = Field(ge=1)
    capabilities: list[CapabilityDefinition]

    @model_validator(mode="after")
    def validate_unique_capability_ids(self) -> "CapabilityManifest":
        ids = [capability.id for capability in self.capabilities]
        if len(ids) != len(set(ids)):
            raise ValueError("capability ids must be unique within a manifest")
        return self


class SourcePosition(ContractModel):
    line: int = Field(ge=1)
    column: int = Field(ge=1)
    byte: int = Field(ge=0)


class SourceSpan(ContractModel):
    uri: str = Field(min_length=1)
    start: SourcePosition
    end: SourcePosition


class SuggestedFix(ContractModel):
    kind: Literal["SOURCE_PATCH", "CAPABILITY_UPGRADE", "HUMAN_ESCALATION"]
    advisory_only: Literal[True] = True
    replacement: str = Field(min_length=1)
    confidence: float = Field(ge=0, le=1)


class CompilerDiagnostic(ContractModel):
    code: str = Field(pattern=r"^RBK-(?:[1-4][0-9]{2}|50[0-5])$")
    severity: Literal["ERROR", "WARNING", "INFO"]
    category: Literal[
        "SYNTAX", "AMBIGUOUS_PREDICATE", "UNBOUNDED_RETRY", "CONTRADICTORY_POLICY",
        "UNVERIFIED_MUTATION", "DEAD_END_OR_UNREACHABLE", "UNKNOWN_CAPABILITY",
        "TYPE_MISMATCH", "AUTHORITY_ESCALATION",
    ]
    message: str = Field(min_length=1)
    statement_id: str = Field(min_length=1)
    related_node: str | None = None
    source: SourceSpan
    required_resolution: list[str] = Field(min_length=1)
    suggested_fix: SuggestedFix | None = None


class DiagnosticArtifact(ContractModel):
    diagnostic_version: Literal["rb-diagnostic/v0.1"]
    diagnostics: list[CompilerDiagnostic]


class SignedSingleUseEnvelope(ContractModel):
    jti: str = Field(min_length=1)
    iat: int
    exp: int

    @model_validator(mode="after")
    def validate_lifetime(self) -> "SignedSingleUseEnvelope":
        if self.exp <= self.iat:
            raise ValueError("exp must be later than iat")
        return self


class ActionGrant(SignedSingleUseEnvelope):
    typ: Literal["RB-ACTION-GRANT"]
    version: Literal["0.1"]
    iss: Literal["rb-control"]
    aud: Literal["rb-broker"]
    execution_id: str = Field(min_length=1)
    node_id: str = Field(min_length=1)
    node_attempt: int = Field(ge=1)
    capability: str = Field(min_length=1)
    params_sha256: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    runbook_ir_sha256: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    manifest_sha256: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    trigger_sha256: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    lease_generation: int
    control_epoch: int
    authority_assertion_ids: list[str] = Field(default_factory=list)


class ApprovalAssertion(SignedSingleUseEnvelope):
    typ: Literal["RB-APPROVAL-ASSERTION"]
    version: Literal["0.1"]
    iss: str = Field(min_length=1)
    sub: str = Field(min_length=1)
    aud: str = Field(min_length=1)
    tenant_id: str = Field(min_length=1)
    authority_id: str = Field(min_length=1)
    execution_id: str = Field(min_length=1)
    runbook_ir_sha256: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    node_id: str = Field(min_length=1)
    trigger_sha256: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    target_scope_sha256: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    decision: Literal["APPROVE", "REJECT"]
