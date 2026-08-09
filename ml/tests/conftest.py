import json

import pytest

# A tiny but internally-consistent snapshot: 3 events, 2 bouts each, chronological.
# career_stats keyed "<fighter_id>@<as_of>"; profile fields live under "fighter".
_FIGHTER = lambda fid, reach: {  # noqa: E731
    "id": fid, "reach_cm": reach, "height_cm": 180,
    "slpm": 3.5, "str_def": 55, "td_def": 60,
}
_STATS = lambda tf: {  # noqa: E731
    "avg_sig_per_fight": 40.0, "sig_accuracy_pct": 45.0,
    "total_td_landed": 8, "total_fights": tf, "td_accuracy_pct": 40.0,
    "total_control_sec": 200, "total_knockdowns": 1, "total_sub_attempts": 1,
    "win_pct_last3": 0.5,
}


def _career(fid, as_of, total_fights, reach):
    return {"fighter": _FIGHTER(fid, reach), "stats": _STATS(total_fights)}


@pytest.fixture
def synthetic_snapshot():
    events = [
        {"id": 1, "date": "2024-01-01", "name": "Card 1"},
        {"id": 2, "date": "2024-02-01", "name": "Card 2"},
        {"id": 3, "date": "2024-03-01", "name": "Card 3"},
    ]
    cards = {}
    career_stats = {}
    fid = 100
    for ev in events:
        bouts = []
        for b in range(2):
            red_id, blue_id = fid, fid + 1
            fid += 2
            bouts.append({
                "id": ev["id"] * 10 + b,
                "red_id": red_id, "blue_id": blue_id,
                "red_name": f"Red {red_id}", "blue_name": f"Blue {blue_id}",
                "weight_class": "Lightweight",
                "is_title": 1 if b == 0 else 0,
                "is_main": 1 if b == 0 else 0,
                "round": 3,
                "winner_id": red_id if b == 0 else blue_id,
                "red_is_ufc_debut": 0, "blue_is_ufc_debut": 1 if b == 1 else 0,
            })
            career_stats[f"{red_id}@{ev['date']}"] = _career(red_id, ev["date"], 5, 190)
            career_stats[f"{blue_id}@{ev['date']}"] = _career(blue_id, ev["date"], 3 if b == 1 else 4, 183)
        cards[str(ev["id"])] = {"event": ev, "card": bouts}
    return {"events": events, "cards": cards, "career_stats": career_stats}


@pytest.fixture
def snapshot_file(tmp_path, synthetic_snapshot):
    p = tmp_path / "snapshot.json"
    p.write_text(json.dumps(synthetic_snapshot), encoding="utf-8")
    return p
