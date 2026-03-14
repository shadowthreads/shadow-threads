from __future__ import annotations

from typing import Any


class ShadowThreadsError(Exception):
    """Base exception for the Shadow Threads SDK."""

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        status_code: int | None = None,
        body: Any | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code
        self.body = body


class ShadowThreadsHTTPError(ShadowThreadsError):
    """Base exception for HTTP responses from the server."""


class ShadowThreadsClientError(ShadowThreadsHTTPError):
    """Raised for 4xx API responses."""


class ShadowThreadsServerError(ShadowThreadsHTTPError):
    """Raised for 5xx API responses."""


class ShadowThreadsNetworkError(ShadowThreadsError):
    """Raised when the client cannot reach the server."""


class ShadowThreadsResponseError(ShadowThreadsError):
    """Raised when the server response cannot be parsed as the expected API envelope."""
