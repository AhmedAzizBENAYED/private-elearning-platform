"""Shared, bounded pagination contracts."""

from typing import Generic, TypeVar

from pydantic import BaseModel, Field

Item = TypeVar("Item")


class Pagination(BaseModel):
    page: int = Field(default=1, ge=1, le=1_000_000)
    page_size: int = Field(default=20, ge=1, le=100)


class Page(Pagination, Generic[Item]):
    items: list[Item]
    total: int = Field(ge=0)
