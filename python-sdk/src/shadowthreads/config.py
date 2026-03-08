from __future__ import annotations

import os

DEFAULT_BASE_URL = "http://localhost:3001"
ENV_BASE_URL = "SHADOW_SERVER"


def resolve_base_url(base_url: str | None = None) -> str:
    resolved = base_url or os.getenv(ENV_BASE_URL) or DEFAULT_BASE_URL
    normalized = resolved.strip()
    if not normalized:
        raise ValueError("base_url must not be empty")
    return normalized.rstrip("/")
