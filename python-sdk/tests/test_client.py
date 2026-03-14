from __future__ import annotations

import json
import pathlib
import sys
import unittest
from unittest.mock import Mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "src"))

from shadowthreads import ArtifactReference, RevisionMetadata, ShadowClient


class FakeResponse:
    def __init__(self, status_code: int, payload: object, *, text: str | None = None) -> None:
        self.status_code = status_code
        self._payload = payload
        self.text = text if text is not None else json.dumps(payload)

    def json(self) -> object:
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload


class ShadowClientTests(unittest.TestCase):
    def make_session(self) -> Mock:
        session = Mock()
        session.headers = {}
        return session

    def test_capture_artifact_dispatches_payload_and_parses_response(self) -> None:
        session = self.make_session()
        session.request.return_value = FakeResponse(
            200,
            {
                "ok": True,
                "data": {
                    "id": "artifact-1",
                    "bundleHash": "a" * 64,
                    "createdAt": "2026-03-09T09:00:00.000Z",
                },
            },
        )
        client = ShadowClient(base_url="http://localhost:3001", session=session)

        result = client.capture_artifact(
            schema="demo.task",
            package_id="package-1",
            payload={"task": "demo"},
            references=[ArtifactReference(bundle_hash="b" * 64, role="source_task")],
        )

        self.assertEqual(result.bundle_hash, "a" * 64)
        call = session.request.call_args
        self.assertEqual(call.kwargs["method"], "POST")
        self.assertTrue(call.kwargs["url"].endswith("/api/v1/artifacts"))
        self.assertEqual(call.kwargs["json"]["identity"]["packageId"], "package-1")
        self.assertEqual(call.kwargs["json"]["references"][0]["role"], "source_task")

    def test_replay_execution_without_payload_reuses_stored_execution_fields(self) -> None:
        execution_id = "3f9f68c6-8c27-4f9e-8c0c-aab8bf885d77"
        session = self.make_session()
        session.request.side_effect = [
            FakeResponse(
                200,
                {
                    "ok": True,
                    "data": {
                        "executionId": execution_id,
                        "packageId": "package-1",
                        "revisionHash": "c" * 64,
                        "provider": "demo-script",
                        "model": "demo-model",
                        "promptHash": "d" * 64,
                        "parameters": {"temperature": 0},
                        "inputArtifacts": [{"bundleHash": "e" * 64, "role": "task_state"}],
                        "outputArtifacts": [{"bundleHash": "f" * 64, "role": "task_summary"}],
                        "resultHash": "1" * 64,
                        "status": "success",
                        "startedAt": "2026-03-09T09:00:00.000Z",
                        "finishedAt": "2026-03-09T09:00:02.000Z",
                        "createdAt": "2026-03-09T09:00:02.000Z",
                    },
                },
            ),
            FakeResponse(
                200,
                {
                    "ok": True,
                    "data": {
                        "executionId": execution_id,
                        "verified": True,
                        "resultHash": "1" * 64,
                    },
                },
            ),
        ]
        client = ShadowClient(base_url="http://localhost:3001", session=session)

        result = client.replay_execution(execution_id)

        self.assertTrue(result.verified)
        self.assertEqual(session.request.call_count, 2)
        get_call = session.request.call_args_list[0]
        replay_call = session.request.call_args_list[1]
        self.assertEqual(get_call.kwargs["method"], "GET")
        self.assertTrue(get_call.kwargs["url"].endswith(f"/api/v1/executions/{execution_id}"))
        self.assertEqual(
            replay_call.kwargs["json"],
            {
                "promptHash": "d" * 64,
                "parameters": {"temperature": 0},
                "inputArtifacts": [{"bundleHash": "e" * 64, "role": "task_state"}],
                "outputArtifacts": [{"bundleHash": "f" * 64, "role": "task_summary"}],
                "status": "success",
            },
        )

    def test_create_revision_accepts_metadata_object(self) -> None:
        session = self.make_session()
        session.request.return_value = FakeResponse(
            200,
            {
                "ok": True,
                "data": {
                    "revisionHash": "9" * 64,
                    "revision": {
                        "revisionHash": "9" * 64,
                        "packageId": "package-1",
                        "parentRevisionHash": None,
                        "author": "SDK Demo",
                        "message": "Initial state",
                        "createdBy": "sdk-test",
                        "timestamp": "2026-03-09T09:00:00+00:00",
                        "source": "human",
                        "metadata": {
                            "author": "SDK Demo",
                            "message": "Initial state",
                            "createdBy": "sdk-test",
                            "timestamp": "2026-03-09T09:00:00+00:00",
                            "source": "human",
                            "tags": ["sdk"],
                        },
                        "createdAt": "2026-03-09T09:00:01.000Z",
                        "artifacts": [{"bundleHash": "a" * 64, "role": "task_state"}],
                    },
                },
            },
        )
        client = ShadowClient(base_url="http://localhost:3001", session=session)

        result = client.create_revision(
            package_id="package-1",
            artifacts=[ArtifactReference(bundle_hash="a" * 64, role="task_state")],
            metadata=RevisionMetadata(
                author="SDK Demo",
                message="Initial state",
                created_by="sdk-test",
                timestamp="2026-03-09T09:00:00+00:00",
                source="human",
                tags=["sdk"],
            ),
        )

        self.assertEqual(result.revision_hash, "9" * 64)


if __name__ == "__main__":
    unittest.main()
