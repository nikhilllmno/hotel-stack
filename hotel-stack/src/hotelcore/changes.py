"""The changes engine: Doss proposes, core checks, the owner approves, core applies (and can undo).

A proposal is a BAML ChangeProposal (baml_src/proposals.baml). Edits are resolved against the live repo into
before/after file contents, checked in a scratch copy (change_checks.py), reviewed by BAML ReviewChange, and stored in
the `changes` table. Nothing touches the live repo until apply(), which only the owner can trigger.
"""

import difflib
import hashlib
import re
import subprocess
import sys
import threading
from pathlib import Path, PurePosixPath

from psycopg.types.json import Jsonb

from hotelcore.baml_client import b
from hotelcore.baml_client.types import ChangeProposal
from hotelcore.change_checks import REPO, areas_for, run_checks

ALLOWED_PREFIXES = ("hotels/", "src/", "tests/", "db/migrations/", "dashboard/src/", "baml_src/")
ALLOWED_FILES = ("pyproject.toml", "dashboard/package.json")
FORBIDDEN = re.compile(r"(^|/)(\.env[^/]*|\.venv|node_modules|\.next|__pycache__|baml_client)(/|$)")
CHECK_LOCK = threading.Lock()  # one check run at a time: evals cost money and share the Anthropic rate limit


class ProposalError(ValueError):
    """A proposal that cannot be applied as written; the message goes back to Doss."""


def digest(text: str | None) -> str | None:
    return None if text is None else hashlib.sha256(text.encode()).hexdigest()


def clean_path(path: str) -> str:
    p = PurePosixPath(path.strip())  # normalises a leading ./
    rel = str(p)
    if p.is_absolute() or ".." in p.parts or FORBIDDEN.search(rel):
        raise ProposalError(f"{path}: not an allowed path")
    if not (rel.startswith(ALLOWED_PREFIXES) or rel in ALLOWED_FILES):
        raise ProposalError(f"{path}: changes may only touch {', '.join(ALLOWED_PREFIXES + ALLOWED_FILES)}")
    return rel


def read(repo: Path, rel: str) -> str | None:
    f = repo / rel
    return f.read_text() if f.exists() else None


def resolve(proposal: ChangeProposal, repo: Path = REPO) -> list[dict]:
    """Turn edits into [{path, before, after, before_hash}]; several edits to one file apply in order."""
    files: dict[str, dict] = {}
    for e in proposal.edits:
        rel = clean_path(e.path)
        f = files.setdefault(rel, {"path": rel, "before": read(repo, rel)})
        current = f.get("after", f["before"])
        if e.delete:
            f["after"] = None
        elif e.content is not None:
            f["after"] = e.content
        elif e.old_text is not None:
            if current is None:
                raise ProposalError(f"{rel}: file does not exist, use content to create it")
            count = current.count(e.old_text)
            if count != 1:
                raise ProposalError(f"{rel}: old_text must appear exactly once, found {count} times")
            f["after"] = current.replace(e.old_text, e.new_text or "", 1)
        else:
            raise ProposalError(f"{rel}: each edit needs content, old_text/new_text, or delete")
    changed = [{**f, "before_hash": digest(f["before"])} for f in files.values() if f.get("after", f["before"]) != f["before"]]
    if not changed:
        raise ProposalError("the proposal does not change any file")
    return changed


def unified_diff(files: list[dict]) -> str:
    return "\n".join("\n".join(difflib.unified_diff(
        (f["before"] or "").splitlines(), (f["after"] or "").splitlines(), f"a/{f['path']}", f"b/{f['path']}", lineterm="",
    )) for f in files)


def check_text(checks: dict) -> str:
    return "\n".join(f"{name}: {'ok' if c['ok'] else 'FAILED'} - {c['detail'][:400]}" for name, c in checks.items()) or "no checks"


def run_and_record(db, change_id: int, files: list[dict], areas: list[str], hotel_rel: str) -> None:
    """Background job: checks, then the BAML review; the row ends as ready or failed."""
    with CHECK_LOCK:
        checks = run_checks(files, areas, hotel_rel, db)
    try:
        review = b.ReviewChange(diff=unified_diff(files)[:60000], checks=check_text(checks)).model_dump(mode="json")
    except Exception as e:  # the review is a summary for the owner; its failure must not leave the change stuck
        review = {"error": f"{type(e).__name__}: {e}"[:500]}
    status = "ready" if all(c["ok"] for c in checks.values()) else "failed"
    with db.connection() as conn:
        conn.execute("update changes set status = %s, checks = %s where id = %s",
                     (status, Jsonb({**checks, "review": review}), change_id))


def propose(db, proposal: ChangeProposal, hotel_rel: str, created_by: str, kind: str = "files", wait: bool = False) -> dict:
    """Store a proposal and start its checks. Raises ProposalError if it cannot apply to the current repo."""
    files = resolve(proposal)
    areas = areas_for([f["path"] for f in files])
    with db.connection() as conn:
        row = conn.execute(
            "insert into changes (kind, title, reason, proposal, files, areas, created_by) values (%s, %s, %s, %s, %s, %s, %s) "
            "returning id", (kind, proposal.title, proposal.reason, Jsonb(proposal.model_dump(mode="json")),
                             Jsonb(files), Jsonb(areas), created_by)).fetchone()
    job = threading.Thread(target=run_and_record, args=(db, row["id"], files, areas, hotel_rel), daemon=True)
    job.start()
    if wait:
        job.join()
    return {"id": row["id"], "status": "checking", "areas": areas, "files": [f["path"] for f in files]}


def draft(request: str, paths: list[str]) -> ChangeProposal:
    """BAML DraftChange: a plain request plus the current contents of the relevant files -> exact edits."""
    shown = "\n\n".join(f"=== {clean_path(p)} ===\n{read(REPO, clean_path(p)) or '(new file)'}" for p in paths)
    return b.DraftChange(request=request, files=shown)


def rollback_proposal(db, version_id: int, hotel_rel: str) -> ChangeProposal:
    """Danny's hotel files as of a published version, expressed as edits against the current files."""
    with db.connection() as conn:
        row = conn.execute("select files, note from config_versions where id = %s", (version_id,)).fetchone()
    if row is None:
        raise ProposalError(f"no published version {version_id}")
    root = REPO / hotel_rel
    current = {str(p.relative_to(root)) for p in root.rglob("*") if p.is_file() and "__pycache__" not in p.parts}
    edits = [{"path": f"{hotel_rel}/{rel}", "content": text} for rel, text in row["files"].items()]
    edits += [{"path": f"{hotel_rel}/{rel}", "delete": True} for rel in current - set(row["files"])]
    return ChangeProposal.model_validate({"title": f"Roll Danny back to version {version_id}",
                                          "reason": f"Restore version {version_id} ({row['note'] or 'no note'})", "edits": edits})


def get(db, change_id: int) -> dict:
    with db.connection() as conn:
        row = conn.execute("select * from changes where id = %s", (change_id,)).fetchone()
    if row is None:
        raise ProposalError(f"no change {change_id}")
    return row


def write_files(files: list[dict], side: str) -> None:
    for f in files:
        target = REPO / f["path"]
        if f[side] is None:
            target.unlink(missing_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(f[side])


def after_write(files: list[dict], note: str, author: str) -> int | None:
    """Make written files take effect: migrations, dependencies, BAML client, and a Vapi publish for hotel files."""
    paths = [f["path"] for f in files]
    def run(cmd, cwd=REPO):
        done = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=600)
        if done.returncode != 0:
            raise RuntimeError(f"{' '.join(cmd)} failed: {(done.stderr or done.stdout).strip()[-500:]}")
        return done.stdout
    if any(p.startswith("db/migrations/") for p in paths):
        run([sys.executable, "-m", "hotelcore.db", "migrate"])
    if "pyproject.toml" in paths:
        run(["uv", "sync"])
    if "dashboard/package.json" in paths:
        run(["pnpm", "install"], REPO / "dashboard")
    if any(p.startswith("baml_src/") for p in paths):
        run(["uv", "run", "baml-cli", "generate"])
    if any(p.startswith("hotels/") for p in paths):
        out = run([sys.executable, "-m", "hotelcore.publish", "--author", author, "--note", note])
        found = re.search(r"version (\d+)", out)
        return int(found.group(1)) if found else None
    return None


def apply(db, change_id: int, decided_by: str) -> dict:
    """Owner approved: the files must be unchanged since the proposal; write them, make them live, record it."""
    c = get(db, change_id)
    if c["status"] != "ready":
        raise ProposalError(f"change {change_id} is {c['status']}; only a change whose checks passed can be applied")
    stale = [f["path"] for f in c["files"] if digest(read(REPO, f["path"])) != f["before_hash"]]
    if stale:
        raise ProposalError(f"these files changed since the proposal, ask Doss to propose again: {', '.join(stale)}")
    write_files(c["files"], "after")
    version = after_write(c["files"], f"change #{change_id}: {c['title']}", decided_by)
    with db.connection() as conn:
        conn.execute("update changes set status = 'applied', decided_by = %s, decided_at = now(), version_id = %s "
                     "where id = %s", (decided_by, version, change_id))
    return {"id": change_id, "status": "applied", "version_id": version}


def undo(db, change_id: int, decided_by: str) -> dict:
    """Restore the files as they were before the change (blocked if they changed again since)."""
    c = get(db, change_id)
    if c["kind"] == "guest_texts":
        raise ProposalError("texts that were sent cannot be unsent")
    if c["status"] != "applied":
        raise ProposalError(f"change {change_id} is {c['status']}; only an applied change can be undone")
    if any(f["path"].startswith("db/migrations/") for f in c["files"]):
        raise ProposalError("this change ran a database migration; undoing it needs a new migration, ask Doss to propose one")
    moved = [f["path"] for f in c["files"] if read(REPO, f["path"]) != f["after"]]
    if moved:
        raise ProposalError(f"these files changed after this change was applied: {', '.join(moved)}")
    write_files(c["files"], "before")
    after_write(c["files"], f"undo change #{change_id}: {c['title']}", decided_by)
    with db.connection() as conn:
        conn.execute("update changes set status = 'undone', decided_by = %s, decided_at = now() where id = %s",
                     (decided_by, change_id))
    return {"id": change_id, "status": "undone"}


def reject(db, change_id: int, decided_by: str) -> dict:
    c = get(db, change_id)
    if c["status"] not in ("checking", "ready", "failed", "scheduled"):  # scheduled texts can still be cancelled
        raise ProposalError(f"change {change_id} is {c['status']}")
    with db.connection() as conn:
        conn.execute("update changes set status = 'rejected', decided_by = %s, decided_at = now() where id = %s",
                     (decided_by, change_id))
    return {"id": change_id, "status": "rejected"}
