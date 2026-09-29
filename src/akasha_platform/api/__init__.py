from __future__ import annotations

from fastapi import APIRouter, Request

from ._common import settings_of
from .config import router as config_router
from .datasets import router as datasets_router
from .results import router as results_router
from .runs import router as runs_router
from .tasks import router as tasks_router

router = APIRouter()


@router.get("/api/health")
def health(request: Request) -> dict[str, object]:
    return {
        "ok": True,
        "settings": settings_of(request).redacted(),
        "startup": request.app.state.startup,
    }


for sub in (config_router, datasets_router, runs_router, results_router, tasks_router):
    router.include_router(sub)

__all__ = ["router"]
