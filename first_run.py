from hashlib import sha256
from shadowthreads import ArtifactReference, RevisionMetadata, ShadowClient

package_id = "readme-first-run"
prompt_hash = sha256(b"Summarize the current workflow state.").hexdigest()
started_at = "2026-03-12T09:00:00+00:00"
finished_at = "2026-03-12T09:00:01+00:00"

with ShadowClient(base_url="http://localhost:3001") as client:
    artifact = client.capture_artifact(
        schema="artifact.task.state.v1",
        package_id=package_id,
        payload={"task": "example", "state": "ready"},
    )

    ref = ArtifactReference(bundle_hash=artifact.bundle_hash, role="primary_state")

    revision = client.create_revision(
        package_id=package_id,
        artifacts=[ref],
        metadata=RevisionMetadata(
            author="README example",
            message="Initial task state",
            created_by="python-sdk",
            timestamp=started_at,
            source="human",
        ),
    )

    execution = client.record_execution(
        package_id=package_id,
        revision_hash=revision.revision_hash,
        provider="local-example",
        model="shadow-demo-model",
        prompt_hash=prompt_hash,
        parameters={"temperature": 0},
        input_artifacts=[ref],
        output_artifacts=[ref],
        status="success",
        started_at=started_at,
        finished_at=finished_at,
    )

    replay = client.replay_execution(execution.execution_id)
    print(replay.verified)