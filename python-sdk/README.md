# Shadow Threads Python SDK v0

The Shadow Threads Python SDK is a thin convenience wrapper over the validated Shadow Threads HTTP API.

It wraps the current core endpoints for:

- artifact capture and inspection
- revision creation and inspection
- execution recording and replay
- migration export, verify, and import

This SDK is transport convenience, not local protocol authority.

This SDK is a thin convenience wrapper over the Shadow Threads HTTP API.
It does not implement local hashing, local replay semantics, or local protocol authority.

## Install

From the repository root:

```bash
pip install -e python-sdk
```

## Create a client

```python
from shadowthreads import ShadowClient

client = ShadowClient(base_url="http://localhost:3001")
```

If `base_url` is omitted, the client uses `SHADOW_SERVER` when it is set, otherwise `http://localhost:3001`.

## What it wraps

The SDK covers the currently validated HTTP API surface:

- `POST /api/v1/artifacts`
- `GET /api/v1/artifacts/:packageId/:bundleHash`
- `POST /api/v1/artifacts/:packageId/:bundleHash/verify`
- `POST /api/v1/revisions`
- `GET /api/v1/revisions/:revisionHash`
- `GET /api/v1/revisions/package/:packageId`
- `POST /api/v1/executions`
- `GET /api/v1/executions/:executionId`
- `POST /api/v1/executions/:executionId/replay`
- `POST /api/v1/migration/export`
- `POST /api/v1/migration/verify`
- `POST /api/v1/migration/import`

## Core example

```python
from shadowthreads import ArtifactReference, RevisionMetadata, ShadowClient

client = ShadowClient(base_url="http://localhost:3001")

artifact = client.capture_artifact(
    schema="demo.task",
    package_id="sdk-demo-package",
    payload={
        "task": "summarize logs",
        "input": "2026-03-09T09:00:00Z INFO startup complete",
    },
)

revision = client.create_revision(
    package_id="sdk-demo-package",
    artifacts=[
        ArtifactReference(bundle_hash=artifact.bundle_hash, role="task_state"),
    ],
    metadata=RevisionMetadata(
        author="SDK Demo",
        message="Initial task state",
        created_by="python-sdk",
        timestamp="2026-03-09T09:00:00+00:00",
        source="human",
        tags=["sdk", "demo"],
    ),
)

execution = client.record_execution(
    package_id="sdk-demo-package",
    revision_hash=revision.revision_hash,
    provider="demo-script",
    model="sdk-example",
    prompt_hash="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    parameters={"temperature": 0},
    input_artifacts=[
        ArtifactReference(bundle_hash=artifact.bundle_hash, role="task_state"),
    ],
    output_artifacts=[
        ArtifactReference(bundle_hash=artifact.bundle_hash, role="task_state"),
    ],
    status="success",
    started_at="2026-03-09T09:00:00+00:00",
    finished_at="2026-03-09T09:00:02+00:00",
)

replay = client.replay_execution(execution.execution_id)

print(artifact.bundle_hash)
print(revision.revision_hash)
print(execution.result_hash)
print(replay.verified)
```

## Replay convenience

`client.replay_execution(execution_id)` can auto-load the current stored execution record and reconstruct the replay body from the validated fields already present in that record:

- `promptHash`
- `parameters`
- `inputArtifacts`
- `outputArtifacts`
- `status`

It does not add local replay logic or infer extra fields.

If you want full control, you can pass the replay fields explicitly.

## Migrations

Migration methods use the server's existing zip-path API shape:

```python
exported = client.export_migration(root_revision_hash)
verified = client.verify_migration(exported.zip_path)
imported = client.import_migration(exported.zip_path)
```

The SDK does not upload local files. It passes the server-visible `zipPath` expected by the current runtime.
