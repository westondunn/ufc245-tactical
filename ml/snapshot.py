"""Immutable data snapshot: build from the main app, load + verify offline.

Snapshot schema (single JSON object):
    events: list[event]                      # each has id, date, name
    cards:  {str(event_id): {event, card}}   # card is list[bout]
    career_stats: {"<fighter_id>@<as_of>": {fighter, stats}}

Building requires the main app; loading and everything downstream does not.
"""
from __future__ import annotations

import json
from pathlib import Path

from ml.manifest import sha256_of_bytes


def snapshot_hash(data: bytes) -> str:
    return sha256_of_bytes(data)


def build_snapshot(base_url: str, *, client) -> dict:
    """Fetch events, cards, and point-in-time career stats into one dict.

    `client` is an httpx.Client (injected so tests can pass a fake). Only
    events with a date and bouts with a winner_id are included, and career
    stats are requested with ?as_of=<event_date> for point-in-time vintage.
    """
    def _get(path):
        r = client.get(f"{base_url}{path}", timeout=30.0)
        r.raise_for_status()
        return r.json()

    events = [e for e in (_get("/api/events") or []) if e.get("date")]
    cards, career_stats = {}, {}
    for ev in events:
        card = _get(f"/api/events/{ev['id']}/card") or {}
        cards[str(ev["id"])] = card
        for bout in card.get("card", []):
            if not bout.get("winner_id"):
                continue
            for side in ("red", "blue"):
                fid = bout.get(f"{side}_id")
                if fid is None:
                    continue
                key = f"{fid}@{ev['date']}"
                if key not in career_stats:
                    career_stats[key] = _get(
                        f"/api/fighters/{fid}/career-stats?as_of={ev['date']}"
                    )
    return {"events": events, "cards": cards, "career_stats": career_stats}


def write_snapshot(snapshot: dict, path: Path) -> str:
    """Serialize deterministically and return the recorded SHA-256."""
    data = json.dumps(snapshot, sort_keys=True, separators=(",", ":")).encode("utf-8")
    Path(path).write_bytes(data)
    return snapshot_hash(data)


def load_snapshot(path: Path) -> dict:
    raw = Path(path).read_bytes()
    try:
        snap = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"snapshot at {path} is not valid JSON: {e}") from e
    # Re-hash the exact on-disk bytes so downstream manifests can cite it.
    snap["_hash"] = snapshot_hash(raw)
    return snap


def iter_labeled_bouts(snapshot: dict):
    """Yield labeled bouts in chronological event order with attached stats."""
    events = sorted(snapshot["events"], key=lambda e: e["date"])
    career = snapshot["career_stats"]
    for ev in events:
        card = snapshot["cards"].get(str(ev["id"]), {})
        for bout in card.get("card", []):
            if not bout.get("winner_id"):
                continue
            red_key = f"{bout['red_id']}@{ev['date']}"
            blue_key = f"{bout['blue_id']}@{ev['date']}"
            red_career = career.get(red_key)
            blue_career = career.get(blue_key)
            if not red_career or not blue_career:
                continue
            yield {
                "event_id": ev["id"],
                "event_date": ev["date"],
                "bout": bout,
                "red_career": red_career,
                "blue_career": blue_career,
            }
