"""Thin administrator member-management HTTP adapters."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response

from app.core.dependencies import MemberServiceDependency, require_role
from app.models.user import User, UserRole
from app.schemas.member import (
    MemberCreate, MemberCreated, MemberQuery, MemberResponse, MemberStatus, MemberUpdate,
)
from app.schemas.pagination import Page

Admin = Annotated[User, Depends(require_role(UserRole.ADMIN))]


def prevent_caching(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


router = APIRouter(
    prefix="/admin/members", tags=["member management"],
    dependencies=[Depends(require_role(UserRole.ADMIN)), Depends(prevent_caching)],
    responses={
        401: {"description": "Missing/invalid credentials or inactive account"},
        403: {"description": "Active ADMIN role required"},
        404: {"description": "Member not found"},
        409: {"description": "Duplicate email or prohibited state transition"},
        503: {"description": "Storage or activation delivery unavailable"},
    },
)


@router.post("", response_model=MemberCreated, response_model_exclude_none=True, status_code=201)
async def create_member(payload: MemberCreate, service: MemberServiceDependency) -> MemberCreated:
    """Create an active MEMBER awaiting password setup; never returns a password."""
    return await service.create(payload)


@router.get("", response_model=Page[MemberResponse])
async def list_members(query: Annotated[MemberQuery, Query()], service: MemberServiceDependency) -> Page[MemberResponse]:
    """List MEMBER accounts with database pagination, literal search and status filtering."""
    return await service.list(query)


@router.post("/{member_id}/activation", response_model=MemberCreated, response_model_exclude_none=True)
async def reissue_activation(member_id: UUID, service: MemberServiceDependency) -> MemberCreated:
    """Replace an invitation for a pending active member; never resets an existing password."""
    return await service.reissue_activation(member_id)


@router.get("/{member_id}", response_model=MemberResponse)
async def get_member(member_id: UUID, service: MemberServiceDependency) -> MemberResponse:
    return await service.get(member_id)


@router.patch("/{member_id}", response_model=MemberResponse)
async def update_member(member_id: UUID, payload: MemberUpdate, service: MemberServiceDependency) -> MemberResponse:
    return await service.update(member_id, payload)


@router.patch("/{member_id}/status", response_model=MemberResponse)
async def set_member_status(
    member_id: UUID, payload: MemberStatus, service: MemberServiceDependency, admin: Admin,
) -> MemberResponse:
    """Idempotent account status change; ADMIN targets retain last-active-admin protection."""
    return await service.set_status(member_id, payload.is_active, admin.id)
