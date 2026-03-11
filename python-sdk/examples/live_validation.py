from __future__ import annotations

import hashlib
import os
import sys
from datetime import datetime, timedelta, timezone

from shadowthreads import ArtifactReference, RevisionMetadata, ShadowClient
from shadowthreads.errors import ShadowThreadsError


PACKAGE_ID = "sdk-live-demo-package"
TASK_ROLE = "task_state"
BASE_URL = os.getenv("SHADOW_SERVER", "http://localhost:3001")


def compute_prompt_hash() -> str:
    return hashlib.sha256(b"shadowthreads-sdk-live-validation").hexdigest()


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def main() -> int:
    client = ShadowClient(base_url=BASE_URL)

    try:
        print(f"Using server: {client.base_url}")

        artifact = client.capture_artifact(
            schema="sdk.demo.task",
            package_id=PACKAGE_ID,
            payload={
                "task": "sdk live validation",
                "input": "validate Python SDK against live local server",
            },
        )
        print(f"Captured artifact: {artifact.bundle_hash}")

        started_at = utc_now()
        finished_at = started_at + timedelta(seconds=2)

        revision = client.create_revision(
            package_id=PACKAGE_ID,
            artifacts=[
                ArtifactReference(bundle_hash=artifact.bundle_hash, role=TASK_ROLE),
            ],
            metadata=RevisionMetadata(
                author="Python SDK Live Validation",
                message="Create revision for live SDK validation",
                created_by="python-sdk-live-validation",
                timestamp=started_at.isoformat(),
                source="human",
                tags=["sdk", "live-validation"],
            ),
        )
        print(f"Created revision: {revision.revision_hash}")

        execution = client.record_execution(
            package_id=PACKAGE_ID,
            revision_hash=revision.revision_hash,
            provider="python-sdk",
            model="live-validation",
            prompt_hash=compute_prompt_hash(),
            parameters={
                "mode": "live-validation",
                "temperature": 0,
            },
            input_artifacts=[
                ArtifactReference(bundle_hash=artifact.bundle_hash, role=TASK_ROLE),
            ],
            output_artifacts=[
                ArtifactReference(bundle_hash=artifact.bundle_hash, role=TASK_ROLE),
            ],
            status="success",
            started_at=started_at.isoformat(),
            finished_at=finished_at.isoformat(),
        )
        print(f"Recorded execution: {execution.execution_id}")

        replay = client.replay_execution(execution.execution_id)
        print(f"Replay verified: {str(replay.verified).lower()}")
        print("SDK live validation complete")
        return 0
    except ShadowThreadsError as error:
        print(f"SDK live validation failed: {error.message}", file=sys.stderr)
        if error.code:
            print(f"API code: {error.code}", file=sys.stderr)
        if error.status_code is not None:
            print(f"HTTP status: {error.status_code}", file=sys.stderr)
        return 1
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
