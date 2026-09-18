"""Shared content input constraints, without lifecycle/business decisions."""

from typing import Annotated, ClassVar

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Description = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20000)]
Position = Annotated[int, Field(strict=True, ge=1, le=2147483647)]


class ContentInput(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ContentPatch(ContentInput):
    _nullable_fields: ClassVar[frozenset[str]] = frozenset()

    @model_validator(mode="after")
    def validate_patch(self) -> "ContentPatch":
        if not self.model_fields_set:
            raise ValueError("Provide at least one field to update")
        for name in self.model_fields_set:
            if getattr(self, name) is None and name not in self._nullable_fields:
                raise ValueError(f"{name} cannot be null")
        return self
