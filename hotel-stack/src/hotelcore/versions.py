"""Config snapshots: what went live on each publish (hotels/<id>/ files + Vapi payload), for diff and rollback."""

from pathlib import Path

from psycopg.types.json import Jsonb

SNAPSHOT_SUFFIXES = {".yaml", ".yml", ".md"}


def read_files(root: Path) -> dict[str, str]:
    """Every config file under the hotel folder, keyed by path relative to it."""
    return {str(p.relative_to(root)): p.read_text() for p in sorted(root.rglob("*"))
            if p.is_file() and p.suffix in SNAPSHOT_SUFFIXES}


def save_version(conn, root: Path, assistant: dict, author: str, note: str) -> int:
    row = conn.execute(
        "insert into config_versions (author, note, files, assistant) values (%s, %s, %s, %s) returning id",
        (author, note, Jsonb(read_files(root)), Jsonb(assistant)),
    ).fetchone()
    return row["id"]


def restore_files(conn, root: Path, version_id: int) -> list[str]:
    """Write a version's files back into the hotel folder; delete config files that version did not have."""
    row = conn.execute("select files from config_versions where id = %s", (version_id,)).fetchone()
    if row is None:
        raise SystemExit(f"no config version {version_id}")
    wanted = row["files"]
    for rel in set(read_files(root)) - set(wanted):
        (root / rel).unlink()
    for rel, content in wanted.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
    return sorted(wanted)
