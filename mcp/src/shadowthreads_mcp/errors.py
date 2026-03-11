from __future__ import annotations

from typing import Any

from mcp.types import CallToolResult, TextContent
from shadowthreads.errors import (
    ShadowThreadsClientError,
    ShadowThreadsError,
    ShadowThreadsNetworkError,
    ShadowThreadsResponseError,
    ShadowThreadsServerError,
)


def error_payload_from_exception(error: Exception) -> dict[str, Any]:
    if isinstance(error, ShadowThreadsError):
        return {
            "error_type": error.__class__.__name__,
            "status_code": error.status_code,
            "api_code": error.code,
            "message": error.message,
        }

    return {
        "error_type": error.__class__.__name__,
        "status_code": None,
        "api_code": None,
        "message": str(error),
    }


def tool_error_result(error: Exception) -> CallToolResult:
    payload = error_payload_from_exception(error)
    return CallToolResult(
        isError=True,
        structuredContent=payload,
        content=[TextContent(type="text", text=payload["message"])],
    )


def tool_success_result(payload: dict[str, Any]) -> CallToolResult:
    return CallToolResult(
        structuredContent=payload,
        content=[],
    )


def is_sdk_error(error: Exception) -> bool:
    return isinstance(
        error,
        (
            ShadowThreadsClientError,
            ShadowThreadsServerError,
            ShadowThreadsNetworkError,
            ShadowThreadsResponseError,
        ),
    )
