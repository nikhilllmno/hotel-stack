"""Checks for a proposed change, run in a scratch copy of the repo with the change applied. Only the checks that match
the areas a change touches run (owner decision): hotel files -> render + evals, code -> pytest, migrations -> SQL in
a rolled-back transaction, dashboard -> next build."""

import os
import shutil
import subprocess
import sys
import tempfile
from contextlib import contextmanager
from datetime import date
from pathlib import Path

from hotelcore.config import load_hotel

REPO = Path(__file__).resolve().parents[2]
SCRATCH_IGNORE = shutil.ignore_patterns(".venv", "node_modules", ".next", "data", ".env", ".git", "__pycache__", "*.pyc")


def areas_for(paths: list[str]) -> list[str]:
    """Which parts of the stack a change touches, from its file paths (deterministic, not the model's opinion)."""
    found = set()
    for p in paths:
        if p.startswith("hotels/"):
            name = p.split("/", 2)[2] if p.count("/") >= 2 else p
            found.add("voice" if name.startswith(("prompts/voice", "voice.yaml")) else
                      "text" if name.startswith("prompts/text") else
                      "kb" if name.startswith(("kb/", "policies/")) else
                      "facts" if name == "facts.yaml" else
                      "templates" if name == "sms_templates.yaml" else
                      "evals" if name.startswith("evals/") else "tools" if name == "tools.yaml" else "hotel")
        elif p.startswith("db/migrations/"):
            found.add("migrations")
        elif p.startswith("dashboard/"):
            found.add("dashboard")
        else:
            found.add("code")
    return sorted(found)


@contextmanager
def scratch_repo(files: list[dict]):
    """A temporary copy of the repo with the change's files written (after=None deletes)."""
    with tempfile.TemporaryDirectory(prefix="change-") as tmp:
        root = Path(tmp) / "repo"
        shutil.copytree(REPO, root, ignore=SCRATCH_IGNORE)
        if (REPO / "dashboard" / "node_modules").exists():
            (root / "dashboard" / "node_modules").symlink_to(REPO / "dashboard" / "node_modules")
        for f in files:
            target = root / f["path"]
            if f["after"] is None:
                target.unlink(missing_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(f["after"])
        yield root


def check_render(hotel_root: Path) -> dict:
    """Hotel config loads, tools.yaml matches the code, both prompts and every non-booking SMS template render."""
    from hotelcore.prompts import build_text_prompt, build_voice_prompt
    from hotelcore.sms import compose, load_templates
    from hotelcore.tools import ToolContext, load_specs
    hotel = load_hotel(hotel_root)
    load_specs(hotel)
    build_voice_prompt(hotel)
    build_text_prompt(hotel, date.today().strftime("%A, %B %d, %Y"), "+12025550123")
    ctx = ToolContext(hotel=hotel, pms=None, data_dir=hotel_root)
    rendered = [compose(ctx, n) for n, t in load_templates(ctx).items() if not t.get("needs_booking")]
    return {"ok": True, "detail": f"config, tools, prompts and {len(rendered)} templates render"}


def check_evals(hotel_root: Path, channel: str) -> dict:
    """Evals in-process: the proposed hotel files with the current code."""
    from hotelcore.evals import run
    results = run(load_hotel(hotel_root), channel=channel)
    failed = [f"{r['name']}: {r['reason']}" for r in results if not r["passed"]]
    return {"ok": not failed, "detail": f"{len(results) - len(failed)}/{len(results)} passed", "failed": failed}


def check_evals_with_code(root: Path, channel: str) -> dict:
    """Evals in a subprocess of the scratch copy, so proposed code (tools, prompts builder) is what gets tested."""
    env = {"PYTHONPATH": f"{root / 'src'}:{root}", "DATABASE_URL": ""}  # no DATABASE_URL: don't save to eval history
    out = run_cmd([sys.executable, "-m", "hotelcore.evals", "--channel", channel], root, 900, env)
    summary = next((line for line in reversed(out["detail"].splitlines()) if line.endswith("passed")), "")
    passed, _, total = summary.partition(" ")[0].partition("/")
    return {"ok": out["ok"] and bool(summary) and passed == total, "detail": summary or out["detail"],
            "failed": [line for line in out["detail"].splitlines() if line.startswith("FAIL")]}


def run_cmd(cmd: list[str], cwd: Path, timeout: int, env: dict | None = None) -> dict:
    done = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout, env={**os.environ, **(env or {})})
    tail = (done.stdout + done.stderr).strip().splitlines()[-15:]
    return {"ok": done.returncode == 0, "detail": "\n".join(tail)}


def check_pytest(root: Path) -> dict:
    """The scratch copy's code wins over the installed package because PYTHONPATH comes first."""
    return run_cmd([sys.executable, "-m", "pytest", "-q", "-x"], root, 600, {"PYTHONPATH": f"{root / 'src'}:{root}"})


def check_dashboard(root: Path) -> dict:
    return run_cmd(["pnpm", "build"], root / "dashboard", 600)


def check_migrations(db, paths: list[str], root: Path) -> dict:
    """New migration SQL must run cleanly; it is rolled back here and only applied on approval."""
    with db.connection() as conn, conn.transaction(force_rollback=True):
        for p in paths:
            conn.execute((root / p).read_text())
    return {"ok": True, "detail": f"{len(paths)} migration(s) ran in a rolled-back transaction"}


def run_checks(files: list[dict], areas: list[str], hotel_rel: str, db) -> dict:
    """Run the checks for these areas; each check's exception becomes a failed check with its message."""
    checks: dict[str, dict] = {}
    with scratch_repo(files) as root:
        hotel_root = root / hotel_rel
        plan = []
        hotel_areas = set(areas) - {"code", "dashboard", "migrations"}
        if hotel_areas:
            plan.append(("render", lambda: check_render(hotel_root)))
        evals = (lambda ch: lambda: check_evals_with_code(root, ch)) if "code" in areas else (lambda ch: lambda: check_evals(hotel_root, ch))
        if hotel_areas - {"text"} or "code" in areas:
            plan.append(("voice evals", evals("voice")))
        if hotel_areas - {"voice"} or "code" in areas:
            plan.append(("text evals", evals("text")))
        if "code" in areas or "migrations" in areas:
            plan.append(("tests", lambda: check_pytest(root)))
        if "migrations" in areas:
            new = [f["path"] for f in files if f["path"].startswith("db/migrations/") and f["after"] is not None]
            plan.append(("migrations", lambda: check_migrations(db, new, root)))
        if "dashboard" in areas:
            plan.append(("dashboard build", lambda: check_dashboard(root)))
        for name, check in plan:
            try:
                checks[name] = check()
            except Exception as e:  # a broken proposal must come back as a failed check, never crash the engine
                checks[name] = {"ok": False, "detail": f"{type(e).__name__}: {e}"}
            if not checks[name]["ok"] and name == "render":
                break  # nothing else can work if the hotel config does not load
    return checks
