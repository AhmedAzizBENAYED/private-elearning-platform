"""Compatibility entry point for existing ``uvicorn main:app`` configurations."""

from app.main import app

__all__ = ["app"]
