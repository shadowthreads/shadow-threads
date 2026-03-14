from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, TypeAlias

from .errors import ShadowThreadsResponseError

JSONPrimitive: TypeAlias = str | int | float | bool | None
JSONValue: TypeAlias = JSONPrimitive | dict[str, "JSONValue"] | list["JSONValue"]
ExecutionStatus: TypeAlias = Literal["success", "failure"]
RevisionSource: TypeAlias = Literal["human", "ai", "migration", "system"]


def _require_mapping(value: Any, *, context: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ShadowThreadsResponseError(f"Expected object for {context}", body=value)
    return value


def _require_string(mapping: dict[str, Any], key: str, *, context: str) -> str:
    value = mapping.get(key)
    if not isinstance(value, str) or not value:
        raise ShadowThreadsResponseError(f"Expected non-empty string for {context}.{key}", body=mapping)
    return value


def _require_boolean(mapping: dict[str, Any], key: str, *, context: str) -> bool:
    value = mapping.get(key)
    if not isinstance(value, bool):
        raise ShadowThreadsResponseError(f"Expected boolean for {context}.{key}", body=mapping)
    return value


def _require_list(mapping: dict[str, Any], key: str, *, context: str) -> list[Any]:
    value = mapping.get(key)
    if not isinstance(value, list):
        raise ShadowThreadsResponseError(f"Expected list for {context}.{key}", body=mapping)
    return value


def _optional_string(mapping: dict[str, Any], key: str) -> str | None:
    value = mapping.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise ShadowThreadsResponseError(f"Expected string or null for {key}", body=mapping)
    return value


def _as_status(value: Any, *, context: str) -> ExecutionStatus:
    if value not in ("success", "failure"):
        raise ShadowThreadsResponseError(f"Expected execution status for {context}", body=value)
    return value


@dataclass(frozen=True, slots=True)
class ArtifactReference:
    bundle_hash: str
    role: str

    def to_payload(self) -> dict[str, str]:
        return {
            "bundleHash": self.bundle_hash,
            "role": self.role,
        }

    @classmethod
    def from_dict(cls, raw: dict[str, Any], *, context: str = "artifactReference") -> "ArtifactReference":
        mapping = _require_mapping(raw, context=context)
        return cls(
            bundle_hash=_require_string(mapping, "bundleHash", context=context),
            role=_require_string(mapping, "role", context=context),
        )


@dataclass(frozen=True, slots=True)
class ArtifactIdentity:
    package_id: str
    revision_id: str | None = None
    revision_hash: str | None = None

    def to_payload(self) -> dict[str, str | None]:
        return {
            "packageId": self.package_id,
            "revisionId": self.revision_id,
            "revisionHash": self.revision_hash,
        }

    @classmethod
    def from_dict(cls, raw: dict[str, Any], *, context: str = "artifactIdentity") -> "ArtifactIdentity":
        mapping = _require_mapping(raw, context=context)
        return cls(
            package_id=_require_string(mapping, "packageId", context=context),
            revision_id=_optional_string(mapping, "revisionId"),
            revision_hash=_optional_string(mapping, "revisionHash"),
        )


@dataclass(frozen=True, slots=True)
class ArtifactBundle:
    schema: str
    identity: ArtifactIdentity
    payload: JSONValue
    references: list[ArtifactReference] = field(default_factory=list)

    def to_payload(self) -> dict[str, Any]:
        return {
            "schema": self.schema,
            "identity": self.identity.to_payload(),
            "payload": self.payload,
            "references": [reference.to_payload() for reference in self.references],
        }

    @classmethod
    def from_dict(cls, raw: dict[str, Any], *, context: str = "artifactBundle") -> "ArtifactBundle":
        mapping = _require_mapping(raw, context=context)
        references = [
            ArtifactReference.from_dict(item, context=f"{context}.references[{index}]")
            for index, item in enumerate(_require_list(mapping, "references", context=context))
        ]
        return cls(
            schema=_require_string(mapping, "schema", context=context),
            identity=ArtifactIdentity.from_dict(
                _require_mapping(mapping.get("identity"), context=f"{context}.identity"),
                context=f"{context}.identity",
            ),
            payload=mapping.get("payload"),
            references=references,
        )


@dataclass(frozen=True, slots=True)
class ArtifactCaptureResult:
    id: str
    bundle_hash: str
    created_at: str

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "ArtifactCaptureResult":
        mapping = _require_mapping(raw, context="artifactCaptureResult")
        return cls(
            id=_require_string(mapping, "id", context="artifactCaptureResult"),
            bundle_hash=_require_string(mapping, "bundleHash", context="artifactCaptureResult"),
            created_at=_require_string(mapping, "createdAt", context="artifactCaptureResult"),
        )


@dataclass(frozen=True, slots=True)
class ArtifactRecord:
    id: str
    bundle_hash: str
    created_at: str
    artifact_bundle: ArtifactBundle

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "ArtifactRecord":
        mapping = _require_mapping(raw, context="artifactRecord")
        return cls(
            id=_require_string(mapping, "id", context="artifactRecord"),
            bundle_hash=_require_string(mapping, "bundleHash", context="artifactRecord"),
            created_at=_require_string(mapping, "createdAt", context="artifactRecord"),
            artifact_bundle=ArtifactBundle.from_dict(
                _require_mapping(mapping.get("artifactBundle"), context="artifactRecord.artifactBundle"),
                context="artifactRecord.artifactBundle",
            ),
        )


@dataclass(frozen=True, slots=True)
class ArtifactVerifyResult:
    bundle_hash: str
    verified: bool

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "ArtifactVerifyResult":
        mapping = _require_mapping(raw, context="artifactVerifyResult")
        return cls(
            bundle_hash=_require_string(mapping, "bundleHash", context="artifactVerifyResult"),
            verified=_require_boolean(mapping, "verified", context="artifactVerifyResult"),
        )


@dataclass(frozen=True, slots=True)
class RevisionMetadata:
    author: str
    message: str
    created_by: str
    timestamp: str
    source: RevisionSource
    tags: list[str] = field(default_factory=list)

    def to_payload(self) -> dict[str, Any]:
        return {
            "author": self.author,
            "message": self.message,
            "createdBy": self.created_by,
            "timestamp": self.timestamp,
            "source": self.source,
            "tags": list(self.tags),
        }

    @classmethod
    def from_dict(cls, raw: dict[str, Any], *, context: str = "revisionMetadata") -> "RevisionMetadata":
        mapping = _require_mapping(raw, context=context)
        tags_raw = mapping.get("tags", [])
        if not isinstance(tags_raw, list) or not all(isinstance(item, str) for item in tags_raw):
            raise ShadowThreadsResponseError(f"Expected list of strings for {context}.tags", body=mapping)
        source = mapping.get("source")
        if source not in ("human", "ai", "migration", "system"):
            raise ShadowThreadsResponseError(f"Expected revision source for {context}.source", body=mapping)
        return cls(
            author=_require_string(mapping, "author", context=context),
            message=_require_string(mapping, "message", context=context),
            created_by=_require_string(mapping, "createdBy", context=context),
            timestamp=_require_string(mapping, "timestamp", context=context),
            source=source,
            tags=list(tags_raw),
        )


@dataclass(frozen=True, slots=True)
class RevisionRecord:
    revision_hash: str
    package_id: str
    parent_revision_hash: str | None
    author: str
    message: str
    created_by: str
    timestamp: str
    source: str
    metadata: dict[str, JSONValue] | JSONValue
    created_at: str
    artifacts: list[ArtifactReference]

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "RevisionRecord":
        mapping = _require_mapping(raw, context="revisionRecord")
        artifacts = [
            ArtifactReference.from_dict(item, context=f"revisionRecord.artifacts[{index}]")
            for index, item in enumerate(_require_list(mapping, "artifacts", context="revisionRecord"))
        ]
        return cls(
            revision_hash=_require_string(mapping, "revisionHash", context="revisionRecord"),
            package_id=_require_string(mapping, "packageId", context="revisionRecord"),
            parent_revision_hash=_optional_string(mapping, "parentRevisionHash"),
            author=_require_string(mapping, "author", context="revisionRecord"),
            message=_require_string(mapping, "message", context="revisionRecord"),
            created_by=_require_string(mapping, "createdBy", context="revisionRecord"),
            timestamp=_require_string(mapping, "timestamp", context="revisionRecord"),
            source=_require_string(mapping, "source", context="revisionRecord"),
            metadata=mapping.get("metadata"),
            created_at=_require_string(mapping, "createdAt", context="revisionRecord"),
            artifacts=artifacts,
        )


@dataclass(frozen=True, slots=True)
class RevisionCreateResult:
    revision_hash: str
    revision: RevisionRecord

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "RevisionCreateResult":
        mapping = _require_mapping(raw, context="revisionCreateResult")
        return cls(
            revision_hash=_require_string(mapping, "revisionHash", context="revisionCreateResult"),
            revision=RevisionRecord.from_dict(
                _require_mapping(mapping.get("revision"), context="revisionCreateResult.revision"),
            ),
        )


@dataclass(frozen=True, slots=True)
class ExecutionRecord:
    execution_id: str
    package_id: str
    revision_hash: str
    provider: str
    model: str
    prompt_hash: str
    parameters: JSONValue
    input_artifacts: list[ArtifactReference]
    output_artifacts: list[ArtifactReference]
    result_hash: str
    status: ExecutionStatus
    started_at: str
    finished_at: str
    created_at: str

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "ExecutionRecord":
        mapping = _require_mapping(raw, context="executionRecord")
        input_artifacts = [
            ArtifactReference.from_dict(item, context=f"executionRecord.inputArtifacts[{index}]")
            for index, item in enumerate(_require_list(mapping, "inputArtifacts", context="executionRecord"))
        ]
        output_artifacts = [
            ArtifactReference.from_dict(item, context=f"executionRecord.outputArtifacts[{index}]")
            for index, item in enumerate(_require_list(mapping, "outputArtifacts", context="executionRecord"))
        ]
        return cls(
            execution_id=_require_string(mapping, "executionId", context="executionRecord"),
            package_id=_require_string(mapping, "packageId", context="executionRecord"),
            revision_hash=_require_string(mapping, "revisionHash", context="executionRecord"),
            provider=_require_string(mapping, "provider", context="executionRecord"),
            model=_require_string(mapping, "model", context="executionRecord"),
            prompt_hash=_require_string(mapping, "promptHash", context="executionRecord"),
            parameters=mapping.get("parameters"),
            input_artifacts=input_artifacts,
            output_artifacts=output_artifacts,
            result_hash=_require_string(mapping, "resultHash", context="executionRecord"),
            status=_as_status(mapping.get("status"), context="executionRecord.status"),
            started_at=_require_string(mapping, "startedAt", context="executionRecord"),
            finished_at=_require_string(mapping, "finishedAt", context="executionRecord"),
            created_at=_require_string(mapping, "createdAt", context="executionRecord"),
        )


@dataclass(frozen=True, slots=True)
class ExecutionCreateResult:
    execution_id: str
    result_hash: str
    execution: ExecutionRecord

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "ExecutionCreateResult":
        mapping = _require_mapping(raw, context="executionCreateResult")
        return cls(
            execution_id=_require_string(mapping, "executionId", context="executionCreateResult"),
            result_hash=_require_string(mapping, "resultHash", context="executionCreateResult"),
            execution=ExecutionRecord.from_dict(
                _require_mapping(mapping.get("execution"), context="executionCreateResult.execution"),
            ),
        )


@dataclass(frozen=True, slots=True)
class ReplayExecutionResult:
    execution_id: str
    verified: bool
    result_hash: str

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "ReplayExecutionResult":
        mapping = _require_mapping(raw, context="replayExecutionResult")
        return cls(
            execution_id=_require_string(mapping, "executionId", context="replayExecutionResult"),
            verified=_require_boolean(mapping, "verified", context="replayExecutionResult"),
            result_hash=_require_string(mapping, "resultHash", context="replayExecutionResult"),
        )


@dataclass(frozen=True, slots=True)
class MigrationManifest:
    root_revision_hash: str
    artifact_count: int
    revision_count: int

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "MigrationManifest":
        mapping = _require_mapping(raw, context="migrationManifest")
        artifact_count = mapping.get("artifactCount")
        revision_count = mapping.get("revisionCount")
        if not isinstance(artifact_count, int):
            raise ShadowThreadsResponseError("Expected integer for migrationManifest.artifactCount", body=mapping)
        if not isinstance(revision_count, int):
            raise ShadowThreadsResponseError("Expected integer for migrationManifest.revisionCount", body=mapping)
        return cls(
            root_revision_hash=_require_string(mapping, "rootRevisionHash", context="migrationManifest"),
            artifact_count=artifact_count,
            revision_count=revision_count,
        )


@dataclass(frozen=True, slots=True)
class MigrationExportResult:
    zip_path: str
    manifest: MigrationManifest

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "MigrationExportResult":
        mapping = _require_mapping(raw, context="migrationExportResult")
        return cls(
            zip_path=_require_string(mapping, "zipPath", context="migrationExportResult"),
            manifest=MigrationManifest.from_dict(
                _require_mapping(mapping.get("manifest"), context="migrationExportResult.manifest"),
            ),
        )


@dataclass(frozen=True, slots=True)
class MigrationVerifyResult:
    ok: bool
    root_revision_hash: str
    artifact_count: int
    revision_count: int
    matches: bool

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "MigrationVerifyResult":
        mapping = _require_mapping(raw, context="migrationVerifyResult")
        artifact_count = mapping.get("artifactCount")
        revision_count = mapping.get("revisionCount")
        if not isinstance(artifact_count, int):
            raise ShadowThreadsResponseError("Expected integer for migrationVerifyResult.artifactCount", body=mapping)
        if not isinstance(revision_count, int):
            raise ShadowThreadsResponseError("Expected integer for migrationVerifyResult.revisionCount", body=mapping)
        return cls(
            ok=_require_boolean(mapping, "ok", context="migrationVerifyResult"),
            root_revision_hash=_require_string(mapping, "rootRevisionHash", context="migrationVerifyResult"),
            artifact_count=artifact_count,
            revision_count=revision_count,
            matches=_require_boolean(mapping, "matches", context="migrationVerifyResult"),
        )


@dataclass(frozen=True, slots=True)
class MigrationImportResult:
    ok: bool
    root_revision_hash: str
    artifact_count: int
    revision_count: int

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "MigrationImportResult":
        mapping = _require_mapping(raw, context="migrationImportResult")
        artifact_count = mapping.get("artifactCount")
        revision_count = mapping.get("revisionCount")
        if not isinstance(artifact_count, int):
            raise ShadowThreadsResponseError("Expected integer for migrationImportResult.artifactCount", body=mapping)
        if not isinstance(revision_count, int):
            raise ShadowThreadsResponseError("Expected integer for migrationImportResult.revisionCount", body=mapping)
        return cls(
            ok=_require_boolean(mapping, "ok", context="migrationImportResult"),
            root_revision_hash=_require_string(mapping, "rootRevisionHash", context="migrationImportResult"),
            artifact_count=artifact_count,
            revision_count=revision_count,
        )
