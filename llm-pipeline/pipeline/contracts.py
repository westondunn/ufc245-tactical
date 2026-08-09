"""Typed domain contracts for LLM pipeline boundaries."""
from __future__ import annotations

from enum import Enum
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator


class SignalType(str, Enum):
    INJURY = "injury"
    CAMP_CHANGE = "camp_change"
    WEIGHT_CUT_CONCERN = "weight_cut_concern"
    MOTIVATION = "motivation"
    STYLE_NOTE = "style_note"
    RECENT_FORM_NOTE = "recent_form_note"
    LAYOFF = "layoff"
    PERSONAL = "personal"
    OTHER = "other"


FighterName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
Evidence = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=1000),
]


class ExtractedSignal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fighter: FighterName | None
    type: SignalType
    severity: int = Field(ge=0, le=3)
    evidence: Evidence


class ExtractionResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fighters_mentioned: list[FighterName]
    signals: list[ExtractedSignal] = Field(max_length=8)
    irrelevant: bool

    @model_validator(mode="after")
    def irrelevant_has_no_signals(self) -> "ExtractionResult":
        if self.irrelevant and self.signals:
            raise ValueError("irrelevant extraction results cannot contain signals")
        return self
