"""Postgres access and migrations.

Usage: uv run python -m hotelcore.db migrate     (applies db/migrations/*.sql not yet applied, in order)
"""

import os
import sys
from pathlib import Path

import psycopg
from psycopg_pool import ConnectionPool
from dotenv import load_dotenv
from psycopg.rows import dict_row

REPO = Path(__file__).resolve().parents[2]
MIGRATIONS = REPO / "db" / "migrations"


def connect() -> psycopg.Connection:
    load_dotenv(REPO / ".env")
    return psycopg.connect(os.environ["DATABASE_URL"], row_factory=dict_row, autocommit=True)


def make_pool() -> ConnectionPool:
    """Shared pool for the API server (connections are slow to open through the Supabase pooler).
    The pooler drops idle connections, so each one is checked when taken (a dead one is replaced) and
    connections idle for 5 minutes are retired."""
    load_dotenv(REPO / ".env")
    return ConnectionPool(os.environ["DATABASE_URL"], min_size=1, max_size=4, open=True, max_idle=300,
                          check=ConnectionPool.check_connection, kwargs={"row_factory": dict_row, "autocommit": True})


def migrate(conn: psycopg.Connection) -> list[str]:
    conn.execute("create table if not exists schema_migrations (name text primary key, applied_at timestamptz default now())")
    done = {r["name"] for r in conn.execute("select name from schema_migrations")}
    applied = []
    for path in sorted(MIGRATIONS.glob("*.sql")):
        if path.name in done:
            continue
        with conn.transaction():
            conn.execute(path.read_text())
            conn.execute("insert into schema_migrations (name) values (%s)", (path.name,))
        applied.append(path.name)
    return applied


if __name__ == "__main__":
    if sys.argv[1:] == ["migrate"]:
        with connect() as conn:
            print("applied:", migrate(conn) or "nothing new")
