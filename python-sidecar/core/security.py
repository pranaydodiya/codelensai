from __future__ import annotations

from fastapi import Header, HTTPException, status

from core.config import get_settings


async def verify_api_key(x_api_key: str = Header(..., alias="x-api-key")) -> None:
    """Dependency: validate the shared secret between Next.js and this sidecar."""
    settings = get_settings()
    if x_api_key != settings.python_ai_api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key",
        )
