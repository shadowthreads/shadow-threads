from __future__ import annotations

from typing import Any

import requests

from .errors import (
    ShadowThreadsClientError,
    ShadowThreadsNetworkError,
    ShadowThreadsResponseError,
    ShadowThreadsServerError,
)


class ShadowHTTPTransport:
    def __init__(
        self,
        *,
        base_url: str,
        timeout: float,
        session: requests.Session | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.session = session or requests.Session()
        self._owns_session = session is None

        headers = getattr(self.session, "headers", None)
        if headers is not None:
            headers.setdefault("Accept", "application/json")
            headers.setdefault("Content-Type", "application/json")

    def request(
        self,
        method: str,
        path: str,
        *,
        json_body: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        url = f"{self.base_url}{path}"
        try:
            response = self.session.request(
                method=method,
                url=url,
                json=json_body,
                params=params,
                timeout=self.timeout,
            )
        except requests.RequestException as error:
            raise ShadowThreadsNetworkError(str(error)) from error

        return self._unwrap_response(response)

    def close(self) -> None:
        if self._owns_session:
            self.session.close()

    def _unwrap_response(self, response: requests.Response) -> Any:
        try:
            payload = response.json()
        except ValueError as error:
            raise ShadowThreadsResponseError(
                "Invalid JSON response from Shadow Threads server",
                status_code=response.status_code,
                body=response.text,
            ) from error

        if not isinstance(payload, dict) or not isinstance(payload.get("ok"), bool):
            raise ShadowThreadsResponseError(
                "Invalid API envelope from Shadow Threads server",
                status_code=response.status_code,
                body=payload,
            )

        if payload["ok"] is True:
            if "data" not in payload:
                raise ShadowThreadsResponseError(
                    "Successful API response is missing data",
                    status_code=response.status_code,
                    body=payload,
                )
            return payload["data"]

        error_payload = payload.get("error")
        if not isinstance(error_payload, dict):
            raise ShadowThreadsResponseError(
                "Error API response is missing error details",
                status_code=response.status_code,
                body=payload,
            )

        code = error_payload.get("code")
        message = error_payload.get("message")
        if not isinstance(code, str) or not isinstance(message, str):
            raise ShadowThreadsResponseError(
                "Error API response has invalid error details",
                status_code=response.status_code,
                body=payload,
            )

        if 500 <= response.status_code:
            raise ShadowThreadsServerError(message, code=code, status_code=response.status_code, body=payload)
        raise ShadowThreadsClientError(message, code=code, status_code=response.status_code, body=payload)
