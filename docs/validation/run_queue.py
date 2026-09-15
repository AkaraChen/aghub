#!/usr/bin/env python3
"""Run a pinned, finite workspace validation queue; never merge or push.

The JSON plan and output directory are local evidence, not public artifacts.
Run from a separate worktree: queue entries may check out another revision.
"""

import argparse
import datetime
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import time


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def write_json(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def git(root, *args):
    return subprocess.check_output(
        ["git", "-C", str(root), *args], text=True
    ).strip()


def process_live(pid):
    try:
        state = Path(f"/proc/{int(pid)}/stat").read_text()
    except FileNotFoundError:
        return False
    return state.rsplit(") ", 1)[1].split()[0] != "Z"


def require_clean(root, commit=None):
    if git(root, "status", "--porcelain"):
        raise RuntimeError(f"dirty workspace: {root}")
    if git(root, "rev-parse", "--abbrev-ref", "HEAD") != "HEAD":
        raise RuntimeError(f"workspace must be detached: {root}")
    if commit and git(root, "rev-parse", "HEAD") != commit:
        raise RuntimeError(f"workspace revision changed: {root}")


def run(plan, output):
    output.mkdir(parents=True, exist_ok=True)
    # Keep this fd alive for the entire queue, including predecessor wait.
    with (output / "queue.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if (output / "queue.json").exists():
            raise RuntimeError("output already used; inspect prior results")
        state = {"pid": os.getpid(), "started_at": now(),
                 "status": "starting", "results": [], "plan": plan}
        write_json(output / "queue.json", state)
        try:
            execute(plan, output, state)
            state["status"] = "finished"
        except Exception as error:
            state.update(status="blocked", error=str(error))
            raise
        finally:
            state["finished_at"] = now()
            write_json(output / "queue.json", state)


def execute(plan, output, state):
    deadline = time.monotonic() + plan.get("max_seconds", 21600)
    entries = plan["entries"]
    if not entries or len(entries) > 10:
        raise ValueError("queue must have 1 to 10 pinned entries")
    ids = set()
    expected = dict(plan["initial_commits"])
    for entry in entries:
        if not re.fullmatch(r"[a-zA-Z0-9_-]+", entry["id"]):
            raise ValueError("unsafe entry id")
        if entry["id"] in ids:
            raise ValueError("duplicate entry id")
        ids.add(entry["id"])
        if not re.fullmatch(r"[0-9a-f]{40}", entry["commit"]):
            raise ValueError("entry requires a full pinned commit")
        if entry["workspace"] not in expected:
            raise ValueError("entry workspace lacks initial revision")
    predecessor = plan.get("predecessor")
    if predecessor:
        state["status"] = "waiting_for_predecessor"
        write_json(output / "queue.json", state)
        metadata = json.loads(Path(predecessor["started"]).read_text())
        result_path = Path(predecessor["result"])
        while any(process_live(metadata[key])
                  for key in ("pid", "cargo_pid")):
            if time.monotonic() >= deadline:
                raise RuntimeError("deadline waiting for predecessor")
            time.sleep(5)
        if not result_path.is_file():
            raise RuntimeError("predecessor exited without a final result")
        result = json.loads(result_path.read_text())
        if any(result.get(key) != metadata.get(key)
               for key in ("commit", "started_at", "pid", "cargo_pid")):
            raise RuntimeError("predecessor result identity mismatch")
        if not isinstance(result.get("exit_code"), int):
            raise RuntimeError("predecessor has no final exit status")
        state["predecessor_result"] = result
    for entry in entries:
        if time.monotonic() >= deadline:
            raise RuntimeError("queue deadline reached")
        root = entry["workspace"]
        require_clean(root, expected[root])
        # No branch is moved, no dirty changes are discarded, no merge occurs.
        git(root, "checkout", "--detach", entry["commit"])
        require_clean(root, entry["commit"])
        env = os.environ.copy()
        env.update(RUSTC_WRAPPER="", CARGO_BUILD_JOBS="1",
                   CARGO_PROFILE_DEV_DEBUG="0", CARGO_PROFILE_TEST_DEBUG="0",
                   AGHUB_SKIP_SIDECAR="1", CARGO_TARGET_DIR=plan["target_dir"])
        record = dict(entry, started_at=now(), status="running",
                      command="cargo test --workspace",
                      environment={key: env[key] for key in (
                          "RUSTC_WRAPPER", "CARGO_BUILD_JOBS",
                          "CARGO_PROFILE_DEV_DEBUG", "CARGO_PROFILE_TEST_DEBUG",
                          "AGHUB_SKIP_SIDECAR", "CARGO_TARGET_DIR")})
        state.update(status="running", current=entry["id"])
        write_json(output / "queue.json", state)
        start = time.monotonic()
        log_path = output / (entry["id"] + ".log")
        with log_path.open("x") as log:
            process = subprocess.Popen(
                ["cargo", "test", "--workspace"], cwd=root, env=env,
                stdout=log, stderr=subprocess.STDOUT,
            )
            record["cargo_pid"] = process.pid
            write_json(output / (entry["id"] + ".started.json"), record)
            # Finish the active command; the deadline prevents another entry.
            # Killing a compiler just because a heartbeat ended wastes cache.
            code = process.wait()
        record.update(exit_code=code, elapsed_seconds=round(
            time.monotonic() - start, 2), finished_at=now())
        try:
            require_clean(root, entry["commit"])
        except RuntimeError as error:
            record.update(status="invalidated", error=str(error))
            write_json(output / (entry["id"] + ".result.json"), record)
            raise
        record["status"] = "passed" if code == 0 else "failed"
        write_json(output / (entry["id"] + ".result.json"), record)
        state["results"].append(record)
        write_json(output / "queue.json", state)
        expected[root] = entry["commit"]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    run(json.loads(args.plan.read_text()), args.output)
