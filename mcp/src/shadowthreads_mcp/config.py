from __future__ import annotations

import os

DEFAULT_BASE_URL = "http://localhost:3001"
ENV_BASE_URL = "SHADOW_SERVER"


def resolve_base_url() -> str:
    value = os.getenv(ENV_BASE_URL, DEFAULT_BASE_URL).strip()
    if not value:
        raise ValueError("SHADOW_SERVER must not be empty")
    return value.rstrip("/")
