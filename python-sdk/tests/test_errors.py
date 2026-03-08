from __future__ import annotations

import pathlib
import sys
import unittest
from unittest.mock import Mock

import requests

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "src"))

from shadowthreads import (
    ShadowClient,
    ShadowThreadsClientError,
    ShadowThreadsNetworkError,
    ShadowThreadsResponseError,
    ShadowThreadsServerError,
)


class FakeResponse:
    def __init__(self, status_code: int, payload: object, *, text: str | None = None) -> None:
        self.status_code = status_code
        self._payload = payload
        self.text = text or ""

    def json(self) -> object:
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload


class ShadowClientErrorTests(unittest.TestCase):
    def make_session(self) -> Mock:
        session = Mock()
        session.headers = {}
        return session

    def test_client_error_preserves_api_code_and_message(self) -> None:
        session = self.make_session()
        session.request.return_value = FakeResponse(
            404,
            {
                "ok": False,
                "error": {
                    "code": "ERR_EXECUTION_NOT_FOUND",
                    "message": "Execution record not found",
                },
            },
        )
        client = ShadowClient(base_url="http://localhost:3001", session=session)

        with self.assertRaises(ShadowThreadsClientError) as ctx:
            client.get_execution("missing")

        self.assertEqual(ctx.exception.code, "ERR_EXECUTION_NOT_FOUND")
        self.assertEqual(ctx.exception.status_code, 404)
        self.assertEqual(ctx.exception.message, "Execution record not found")

    def test_server_error_maps_to_server_exception(self) -> None:
        session = self.make_session()
        session.request.return_value = FakeResponse(
            500,
            {
                "ok": False,
                "error": {
                    "code": "ERR_INTERNAL",
                    "message": "Internal server error",
                },
            },
        )
        client = ShadowClient(base_url="http://localhost:3001", session=session)

        with self.assertRaises(ShadowThreadsServerError):
            client.get_revision("a" * 64)

    def test_network_error_maps_to_network_exception(self) -> None:
        session = self.make_session()
        session.request.side_effect = requests.ConnectionError("connection refused")
        client = ShadowClient(base_url="http://localhost:3001", session=session)

        with self.assertRaises(ShadowThreadsNetworkError):
            client.get_revision("a" * 64)

    def test_invalid_api_envelope_raises_response_error(self) -> None:
        session = self.make_session()
        session.request.return_value = FakeResponse(
            200,
            {
                "success": True,
                "data": {},
            },
        )
        client = ShadowClient(base_url="http://localhost:3001", session=session)

        with self.assertRaises(ShadowThreadsResponseError):
            client.get_revision("a" * 64)


if __name__ == "__main__":
    unittest.main()
