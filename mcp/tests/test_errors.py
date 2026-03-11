from __future__ import annotations

import pathlib
import sys
import unittest

import anyio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "src"))

from shadowthreads.errors import ShadowThreadsClientError  # type: ignore[import-not-found]
from shadowthreads_mcp.errors import error_payload_from_exception, tool_error_result
from shadowthreads_mcp.tools import register_tools


class ErrorClient:
    def __init__(self, *, base_url: str) -> None:
        self.base_url = base_url

    def close(self) -> None:
        pass

    def get_revision(self, revision_hash: str):
        raise ShadowThreadsClientError(
            "Revision not found",
            code="ERR_REVISION_NOT_FOUND",
            status_code=404,
        )


class MCPErrorTests(unittest.TestCase):
    def test_error_payload_is_structured_and_concise(self) -> None:
        payload = error_payload_from_exception(
            ShadowThreadsClientError(
                "Revision not found",
                code="ERR_REVISION_NOT_FOUND",
                status_code=404,
            )
        )
        self.assertEqual(
            payload,
            {
                "error_type": "ShadowThreadsClientError",
                "status_code": 404,
                "api_code": "ERR_REVISION_NOT_FOUND",
                "message": "Revision not found",
            },
        )

    def test_tool_returns_structured_mcp_error_result(self) -> None:
        from mcp.server.fastmcp import FastMCP

        server = FastMCP("test-shadow-mcp", json_response=True)
        register_tools(server, client_factory=ErrorClient)

        async def run():
            return await server.call_tool("shadow_get_revision", {"revision_hash": "a" * 64})

        result = anyio.run(run)
        self.assertTrue(result.isError)
        self.assertEqual(result.structuredContent["error_type"], "ShadowThreadsClientError")
        self.assertEqual(result.structuredContent["status_code"], 404)
        self.assertEqual(result.structuredContent["api_code"], "ERR_REVISION_NOT_FOUND")
        self.assertEqual(result.structuredContent["message"], "Revision not found")
        self.assertEqual(result.content[0].text, "Revision not found")


if __name__ == "__main__":
    unittest.main()
