from __future__ import annotations

from dataclasses import asdict
from typing import Any, Callable, Protocol

from mcp.server.fastmcp import FastMCP
from mcp.types import CallToolResult
from pydantic import BaseModel, Field
from shadowthreads import ArtifactReference, RevisionMetadata, ShadowClient
from shadowthreads.errors import ShadowThreadsError

from .config import resolve_base_url
from .errors import tool_error_result, tool_success_result


class ArtifactReferenceInput(BaseModel):
    bundle_hash: str = Field(..., description="Artifact bundle hash")
    role: str = Field(..., description="Artifact role in the workflow")


class RevisionMetadataInput(BaseModel):
    author: str
    message: str
    created_by: str
    timestamp: str
    source: str
    tags: list[str] = Field(default_factory=list)


class ClientFactory(Protocol):
    def __call__(self, *, base_url: str) -> Any:
        ...


def register_tools(server: FastMCP, client_factory: ClientFactory = ShadowClient) -> None:
    def with_client(callback: Callable[[Any], dict[str, Any]]) -> CallToolResult:
        client = client_factory(base_url=resolve_base_url())
        try:
            return tool_success_result(callback(client))
        except ShadowThreadsError as error:
            return tool_error_result(error)
        except Exception as error:  # pragma: no cover - defensive fallback
            return tool_error_result(error)
        finally:
            close = getattr(client, "close", None)
            if callable(close):
                close()

    @server.tool(name="shadow_capture_artifact")
    def shadow_capture_artifact(
        schema: str,
        package_id: str,
        payload: dict[str, Any],
        references: list[ArtifactReferenceInput] | None = None,
    ) -> CallToolResult:
        def run(client: ShadowClient) -> dict[str, Any]:
            result = client.capture_artifact(
                schema=schema,
                package_id=package_id,
                payload=payload,
                references=[
                    ArtifactReference(bundle_hash=reference.bundle_hash, role=reference.role)
                    for reference in (references or [])
                ],
            )
            return asdict(result)

        return with_client(run)

    @server.tool(name="shadow_get_artifact")
    def shadow_get_artifact(package_id: str, bundle_hash: str) -> CallToolResult:
        def run(client: ShadowClient) -> dict[str, Any]:
            return asdict(client.get_artifact(package_id, bundle_hash))

        return with_client(run)

    @server.tool(name="shadow_create_revision")
    def shadow_create_revision(
        package_id: str,
        artifacts: list[ArtifactReferenceInput],
        metadata: RevisionMetadataInput,
        parent_revision_hash: str | None = None,
    ) -> CallToolResult:
        def run(client: ShadowClient) -> dict[str, Any]:
            created = client.create_revision(
                package_id=package_id,
                parent_revision_hash=parent_revision_hash,
                artifacts=[
                    ArtifactReference(bundle_hash=artifact.bundle_hash, role=artifact.role)
                    for artifact in artifacts
                ],
                metadata=RevisionMetadata(
                    author=metadata.author,
                    message=metadata.message,
                    created_by=metadata.created_by,
                    timestamp=metadata.timestamp,
                    source=metadata.source,  # type: ignore[arg-type]
                    tags=list(metadata.tags),
                ),
            )
            return asdict(created.revision)

        return with_client(run)

    @server.tool(name="shadow_get_revision")
    def shadow_get_revision(revision_hash: str) -> CallToolResult:
        def run(client: ShadowClient) -> dict[str, Any]:
            return asdict(client.get_revision(revision_hash))

        return with_client(run)

    @server.tool(name="shadow_list_revisions")
    def shadow_list_revisions(package_id: str, limit: int | None = None) -> CallToolResult:
        def run(client: ShadowClient) -> dict[str, Any]:
            return {"items": [asdict(item) for item in client.list_revisions(package_id, limit=limit)]}

        return with_client(run)

    @server.tool(name="shadow_record_execution")
    def shadow_record_execution(
        package_id: str,
        revision_hash: str,
        provider: str,
        model: str,
        prompt_hash: str,
        parameters: dict[str, Any],
        input_artifacts: list[ArtifactReferenceInput],
        output_artifacts: list[ArtifactReferenceInput],
        status: str,
        started_at: str,
        finished_at: str,
    ) -> CallToolResult:
        def run(client: ShadowClient) -> dict[str, Any]:
            created = client.record_execution(
                package_id=package_id,
                revision_hash=revision_hash,
                provider=provider,
                model=model,
                prompt_hash=prompt_hash,
                parameters=parameters,
                input_artifacts=[
                    ArtifactReference(bundle_hash=artifact.bundle_hash, role=artifact.role)
                    for artifact in input_artifacts
                ],
                output_artifacts=[
                    ArtifactReference(bundle_hash=artifact.bundle_hash, role=artifact.role)
                    for artifact in output_artifacts
                ],
                status=status,  # type: ignore[arg-type]
                started_at=started_at,
                finished_at=finished_at,
            )
            return asdict(created.execution)

        return with_client(run)

    @server.tool(name="shadow_get_execution")
    def shadow_get_execution(execution_id: str) -> CallToolResult:
        def run(client: ShadowClient) -> dict[str, Any]:
            return asdict(client.get_execution(execution_id))

        return with_client(run)

    @server.tool(name="shadow_replay_execution")
    def shadow_replay_execution(execution_id: str) -> CallToolResult:
        def run(client: ShadowClient) -> dict[str, Any]:
            return asdict(client.replay_execution(execution_id))

        return with_client(run)
