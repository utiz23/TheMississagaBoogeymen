"""One-shot setup for the screen-classifier-v2 Label Studio project.

Talks to a running Label Studio instance (started via docker run in
HANDOFF.md), creates the project with our labeling config + hotkey layout,
attaches the bind-mounted `_inbox/` as a local-files storage, and syncs it
so all 254 candidate PNGs land as tasks ready to label.

Idempotent: re-running detects an existing project by title and bails
cleanly. If you need to recreate, delete the project via the UI first.

Usage:
    python3 tools/game_ocr/scripts/setup_label_studio_project.py
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request

LS_URL = os.environ.get("LABEL_STUDIO_URL", "http://localhost:8080")
LS_TOKEN = os.environ.get("LABEL_STUDIO_TOKEN", "eanhl-local-token-12345")
PROJECT_TITLE = "screen-classifier-v2"

# Mounted in the container at /label-studio/files/inbox (read-only). Mirrors
# the host's tools/game_ocr/calibration/extras/_inbox/ directory tree. LS
# refuses storage paths that equal LOCAL_FILES_DOCUMENT_ROOT, hence the
# /inbox subdirectory.
STORAGE_PATH = "/label-studio/files/inbox"

LABELING_CONFIG = """<View>
  <Image name="image" value="$image" zoom="true" zoomControl="true"/>
  <Choices name="screen_state" toName="image" choice="single" showInLine="false">
    <!-- Wave-A priority: tightening targets -->
    <Choice value="pre_game_lobby_state_2" hotkey="1"/>
    <Choice value="player_loadout_view" hotkey="2"/>
    <Choice value="loading_or_intro" hotkey="3"/>
    <Choice value="unknown_or_transition" hotkey="4"/>
    <!-- Wave-A priority: NEW classes (home row) -->
    <Choice value="menu_club_management" hotkey="a"/>
    <Choice value="player_loadout_landing" hotkey="s"/>
    <Choice value="menu_world_of_chel" hotkey="d"/>
    <!-- Other classes -->
    <Choice value="in_game_clock" hotkey="5"/>
    <Choice value="in_game_goal_state_1" hotkey="6"/>
    <Choice value="in_game_goal_state_2" hotkey="7"/>
    <Choice value="pre_game_lobby_state_1" hotkey="8"/>
    <Choice value="end_of_video" hotkey="9"/>
    <Choice value="post_game_player_summary" hotkey="0"/>
    <Choice value="post_game_box_score_goals" hotkey="q"/>
    <Choice value="post_game_box_score_shots" hotkey="w"/>
    <Choice value="post_game_box_score_faceoffs" hotkey="e"/>
    <Choice value="post_game_events" hotkey="r"/>
    <Choice value="post_game_action_tracker" hotkey="t"/>
    <Choice value="post_game_faceoff_map" hotkey="y"/>
    <Choice value="post_game_net_chart" hotkey="u"/>
  </Choices>
</View>
"""


def _req(method: str, path: str, body: dict | None = None) -> dict | list:
    url = f"{LS_URL}{path}"
    data = None
    headers = {"Authorization": f"Token {LS_TOKEN}"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        body_text = e.read().decode("utf-8", errors="replace")
        print(f"[ls] HTTP {e.code} on {method} {path}: {body_text}", file=sys.stderr)
        raise


def _wait_ready(timeout_s: int = 120) -> None:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"{LS_URL}/health", timeout=3) as r:
                if r.status == 200:
                    print("[ls] healthy", file=sys.stderr)
                    return
        except Exception:
            pass
        time.sleep(2)
    raise RuntimeError(f"Label Studio did not become healthy within {timeout_s}s")


def _find_existing_project() -> dict | None:
    res = _req("GET", "/api/projects/?page_size=100")
    if isinstance(res, dict):
        items = res.get("results", [])
    elif isinstance(res, list):
        items = res
    else:
        items = []
    for p in items:
        if p.get("title") == PROJECT_TITLE:
            return p
    return None


def main() -> int:
    print(f"[ls] connecting to {LS_URL}", file=sys.stderr)
    _wait_ready()

    existing = _find_existing_project()
    if existing:
        pid = existing["id"]
        print(f"[ls] project '{PROJECT_TITLE}' already exists (id={pid}); skipping create", file=sys.stderr)
    else:
        created = _req(
            "POST",
            "/api/projects/",
            {
                "title": PROJECT_TITLE,
                "description": (
                    "Phase-A screen-classifier-v2 labeling. 20 classes "
                    "(17 sm.states + 3 new). Hotkeys: 1234 tighten, asd new, "
                    "5-9/0/qwerty rest. Enable auto-submit-on-hotkey in "
                    "project settings for one-keypress-per-frame UX."
                ),
                "label_config": LABELING_CONFIG,
            },
        )
        if not isinstance(created, dict):
            print(f"[ls] unexpected create response: {created!r}", file=sys.stderr)
            return 1
        pid = created["id"]
        print(f"[ls] created project id={pid}", file=sys.stderr)

    storages = _req("GET", f"/api/storages/localfiles?project={pid}")
    if isinstance(storages, list) and storages:
        sid = storages[0]["id"]
        print(f"[ls] localfiles storage already attached (id={sid})", file=sys.stderr)
    else:
        sres = _req(
            "POST",
            "/api/storages/localfiles/",
            {
                "title": "inbox",
                "path": STORAGE_PATH,
                "regex_filter": r".*cand-t\d+\.png$",
                "use_blob_urls": True,
                "recursive_scan": True,
                "project": pid,
            },
        )
        sid = sres["id"]
        print(f"[ls] created localfiles storage id={sid}", file=sys.stderr)

    sync_res = _req("POST", f"/api/storages/localfiles/{sid}/sync", {})
    print(f"[ls] sync response: {json.dumps(sync_res, indent=2)[:400]}", file=sys.stderr)

    tasks = _req("GET", f"/api/projects/{pid}/tasks/?page_size=1")
    if isinstance(tasks, dict):
        total = tasks.get("total", "?")
    else:
        total = len(tasks) if isinstance(tasks, list) else "?"
    print(f"[ls] project now has {total} task(s)", file=sys.stderr)

    print("", file=sys.stderr)
    print(f"Project ready: {LS_URL}/projects/{pid}/data", file=sys.stderr)
    print(f"  Login: admin@eanhl.local / eanhl1234", file=sys.stderr)
    print(f"  After labeling: Export → JSON → save to repo root, run", file=sys.stderr)
    print(f"  python3 tools/game_ocr/scripts/import_label_studio_export.py <export.json>", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
