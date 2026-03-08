from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any
from urllib.parse import quote

import requests

from ._http import ShadowHTTPTransport
from .config import resolve_base_url
from .errors import ShadowThreadsResponseError
from .models import (
    ArtifactCaptureResult,
    ArtifactRecord,
    ArtifactReference,
    ArtifactVerifyResult,
    ExecutionCreateResult,
    ExecutionRecord,
    ExecutionStatus,
    MigrationExportResult,
    MigrationImportResult,
    MigrationVerifyResult,
    ReplayExecutionResult,
    RevisionCreateResult,
    RevisionMetadata,
    RevisionRecord,
)

ArtifactReferenceInput = ArtifactReference | Mapping[str, Any]
RevisionMetadataInput = RevisionMetadata | Mapping[str, Any]


class ShadowClient:
    def __init__(
        self,
        *,
        base_url: str | None = None,
        timeout: float = 30.0,
        session: requests.Session | None = None,
    ) -> None:
        self.base_url = resolve_base_url(base_url)
        self.timeout = timeout
        self._transport = ShadowHTTPTransport(base_url=self.base_url, timeout=timeout, session=session)

    def close(self) -> None:
        self._transport.close()

    def __enter__(self) -> "ShadowClient":
        return self

    def __exit__(self, exc_type: object, exc: object, tb: object) -> None:
        self.close()

    def capture_artifact(
        self,
        *,
        schema: str,
        package_id: str,
        payload: Any,
        references: Sequence[ArtifactReferenceInput] = (),
        revision_id: str | None = None,
        revision_hash: str | None = None,
    ) -> ArtifactCaptureResult:
        data = self._transport.request(
            "POST",
            "/api/v1/artifacts",
            json_body={
                "schema": schema,
                "identity": {
                    "packageId": package_id,
                    "revisionId": revision_id,
                    "revisionHash": revision_hash,
                },
                "payload": payload,
                "references": self._serialize_artifact_references(references),
            },
        )
        return ArtifactCaptureResult.from_dict(data)

    def get_artifact(self, package_id: str, bundle_hash: str) -> ArtifactRecord:
        data = self._transport.request(
            "GET",
            f"/api/v1/artifacts/{quote(package_id, safe='')}/{quote(bundle_hash, safe='')}",
        )
        return ArtifactRecord.from_dict(data)

    def verify_artifact(self, package_id: str, bundle_hash: str) -> ArtifactVerifyResult:
        data = self._transport.request(
            "POST",
            f"/api/v1/artifacts/{quote(package_id, safe='')}/{quote(bundle_hash, safe='')}/verify",
            json_body={},
        )
        return ArtifactVerifyResult.from_dict(data)

    def create_revision(
        self,
        *,
        package_id: str,
        artifacts: Sequence[ArtifactReferenceInput],
        metadata: RevisionMetadataInput,
        parent_revision_hash: str | None = None,
    ) -> RevisionCreateResult:
        data = self._transport.request(
            "POST",
            "/api/v1/revisions",
            json_body={
                "packageId": package_id,
                "parentRevisionHash": parent_revision_hash,
                "artifacts": self._serialize_artifact_references(artifacts),
                "metadata": self._serialize_revision_metadata(metadata),
            },
        )
        return RevisionCreateResult.from_dict(data)

    def get_revision(self, revision_hash: str) -> RevisionRecord:
        data = self._transport.request(
            "GET",
            f"/api/v1/revisions/{quote(revision_hash, safe='')}",
        )
        return RevisionRecord.from_dict(data)

    def list_revisions(self, package_id: str, *, limit: int | None = None) -> list[RevisionRecord]:
        params = {"limit": limit} if limit is not None else None
        data = self._transport.request(
            "GET",
            f"/api/v1/revisions/package/{quote(package_id, safe='')}",
            params=params,
        )
        if not isinstance(data, dict):
            raise ShadowThreadsResponseError("Invalid revision list response", body=data)
        items = data.get("items")
        if not isinstance(items, list):
            raise ShadowThreadsResponseError("Revision list response is missing items", body=data)
        return [RevisionRecord.from_dict(item) for item in items]

    def record_execution(
        self,
        *,
        package_id: str,
        revision_hash: str,
        provider: str,
        model: str,
        prompt_hash: str,
        parameters: Any,
        input_artifacts: Sequence[ArtifactReferenceInput],
        output_artifacts: Sequence[ArtifactReferenceInput],
        status: ExecutionStatus,
        started_at: str,
        finished_at: str,
    ) -> ExecutionCreateResult:
        data = self._transport.request(
            "POST",
            "/api/v1/executions",
            json_body={
                "packageId": package_id,
                "revisionHash": revision_hash,
                "provider": provider,
                "model": model,
                "promptHash": prompt_hash,
                "parameters": parameters,
                "inputArtifacts": self._serialize_artifact_references(input_artifacts),
                "outputArtifacts": self._serialize_artifact_references(output_artifacts),
                "status": status,
                "startedAt": started_at,
                "finishedAt": finished_at,
            },
        )
        return ExecutionCreateResult.from_dict(data)

    def get_execution(self, execution_id: str) -> ExecutionRecord:
        data = self._transport.request(
            "GET",
            f"/api/v1/executions/{quote(execution_id, safe='')}",
        )
        return ExecutionRecord.from_dict(data)

    def replay_execution(
        self,
        execution_id: str,
        *,
        prompt_hash: str | None = None,
        parameters: Any | None = None,
        input_artifacts: Sequence[ArtifactReferenceInput] | None = None,
        output_artifacts: Sequence[ArtifactReferenceInput] | None = None,
        status: ExecutionStatus | None = None,
    ) -> ReplayExecutionResult:
        replay_body = self._build_replay_payload(
            execution_id=execution_id,
            prompt_hash=prompt_hash,
            parameters=parameters,
            input_artifacts=input_artifacts,
            output_artifacts=output_artifacts,
            status=status,
        )
        data = self._transport.request(
            "POST",
            f"/api/v1/executions/{quote(execution_id, safe='')}/replay",
            json_body=replay_body,
        )
        return ReplayExecutionResult.from_dict(data)

    def export_migration(self, root_revision_hash: str) -> MigrationExportResult:
        data = self._transport.request(
            "POST",
            "/api/v1/migration/export",
            json_body={"rootRevisionHash": root_revision_hash},
        )
        return MigrationExportResult.from_dict(data)

    def verify_migration(self, zip_path: str) -> MigrationVerifyResult:
        data = self._transport.request(
            "POST",
            "/api/v1/migration/verify",
            json_body={"zipPath": zip_path},
        )
        return MigrationVerifyResult.from_dict(data)

    def import_migration(self, zip_path: str) -> MigrationImportResult:
        data = self._transport.request(
            "POST",
            "/api/v1/migration/import",
            json_body={"zipPath": zip_path},
        )
        return MigrationImportResult.from_dict(data)

    def _build_replay_payload(
        self,
        *,
        execution_id: str,
        prompt_hash: str | None,
        parameters: Any | None,
        input_artifacts: Sequence[ArtifactReferenceInput] | None,
        output_artifacts: Sequence[ArtifactReferenceInput] | None,
        status: ExecutionStatus | None,
    ) -> dict[str, Any]:
        explicit_values = [prompt_hash, parameters, input_artifacts, output_artifacts, status]
        if all(value is None for value in explicit_values):
            execution = self.get_execution(execution_id)
            return {
                "promptHash": execution.prompt_hash,
                "parameters": execution.parameters,
                "inputArtifacts": [artifact.to_payload() for artifact in execution.input_artifacts],
                "outputArtifacts": [artifact.to_payload() for artifact in execution.output_artifacts],
                "status": execution.status,
            }

        if any(value is None for value in explicit_values):
            raise ValueError(
                "Explicit replay execution requires prompt_hash, parameters, input_artifacts, output_artifacts, and status."
            )

        return {
            "promptHash": prompt_hash,
            "parameters": parameters,
            "inputArtifacts": self._serialize_artifact_references(input_artifacts or ()),
            "outputArtifacts": self._serialize_artifact_references(output_artifacts or ()),
            "status": status,
        }

    def _serialize_artifact_references(
        self,
        references: Sequence[ArtifactReferenceInput],
    ) -> list[dict[str, Any]]:
        serialized: list[dict[str, Any]] = []
        for reference in references:
            if isinstance(reference, ArtifactReference):
                serialized.append(reference.to_payload())
                continue

            bundle_hash = reference.get("bundle_hash", reference.get("bundleHash"))
            role = reference.get("role")
            if not isinstance(bundle_hash, str) or not isinstance(role, str):
                raise ValueError("Artifact references require bundle_hash/bundleHash and role.")
            serialized.append(
                {
                    "bundleHash": bundle_hash,
                    "role": role,
                }
            )
        return serialized

    def _serialize_revision_metadata(self, metadata: RevisionMetadataInput) -> dict[str, Any]:
        if isinstance(metadata, RevisionMetadata):
            return metadata.to_payload()

        author = metadata.get("author")
        message = metadata.get("message")
        created_by = metadata.get("created_by", metadata.get("createdBy"))
        timestamp = metadata.get("timestamp")
        source = metadata.get("source")
        tags = metadata.get("tags", [])

        if not isinstance(author, str) or not isinstance(message, str) or not isinstance(created_by, str):
            raise ValueError("Revision metadata requires author, message, and created_by/createdBy.")
        if not isinstance(timestamp, str) or not isinstance(source, str):
            raise ValueError("Revision metadata requires timestamp and source.")
        if not isinstance(tags, Sequence) or isinstance(tags, (str, bytes)):
            raise ValueError("Revision metadata tags must be a sequence of strings.")
        if not all(isinstance(tag, str) for tag in tags):
            raise ValueError("Revision metadata tags must be a sequence of strings.")

        return {
            "author": author,
            "message": message,
            "createdBy": created_by,
            "timestamp": timestamp,
            "source": source,
            "tags": list(tags),
        }
