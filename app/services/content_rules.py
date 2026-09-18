"""Shared content transaction and parent-course edit invariants."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import BusinessError
from app.models.course import Course, CourseStatus


@asynccontextmanager
async def content_write(session: AsyncSession, conflict: str) -> AsyncIterator[None]:
    """Services own commits, including transactions autobegun by authentication."""
    try:
        yield
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise BusinessError(409, conflict) from None
    except SQLAlchemyError:
        await session.rollback()
        raise BusinessError(503, "Content storage temporarily unavailable") from None
    except Exception:
        await session.rollback()
        raise


def require_draft(course: Course) -> None:
    if course.status != CourseStatus.DRAFT:
        raise BusinessError(409, "Only DRAFT courses can be edited")
