"""Mini apps: small pages Doss builds, published through the changes engine (kind mini_app) after owner approval.

Owner apps render inside the dashboard in a sandboxed iframe and get data only through the dashboard's bridge
(window.hotel.get / window.hotel.act, allow-listed). Public apps are served by core at /p/<slug> with a strict CSP;
their bridge reaches only /p/api/availability and /p/api/info, so no guest data can reach a public page.
"""

import re

from psycopg.types.json import Jsonb

from hotelcore.baml_client.types import MiniApp
from hotelcore.changes import ProposalError, digest, get

SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{1,40}$")
MAX_HTML = 400_000

# Facts a public page may show (everything else in facts.yaml can be internal, e.g. the after-hours phone).
PUBLIC_FACTS = ("property.name", "property.official_name", "property.address", "property.town", "property.state",
                "property.website", "property.booking_portal", "contact.public_phone", "contact.email",
                "checkin.time", "checkin.checkout_time")
# KB topics written as instructions for the agent, not for guests.
PRIVATE_KB = {"human-escalation-contact", "ai-handling-guidelines"}

PUBLIC_BRIDGE = """<script>
/* Public page bridge: only hotel info and availability, never guest data. */
window.hotel = {
  get: async (source, params = {}) => {
    if (!["availability", "info"].includes(source)) throw new Error("unknown source " + source);
    const r = await fetch("/p/api/" + source + "?" + new URLSearchParams(params));
    if (!r.ok) throw new Error((await r.text()) || r.statusText);
    return r.json();
  },
};
</script>
"""


def current(db, slug: str) -> dict | None:
    with db.connection() as conn:
        return conn.execute("select * from mini_apps where slug = %s", (slug,)).fetchone()


def validate(app: MiniApp) -> None:
    if not SLUG.match(app.slug):
        raise ProposalError(f"{app.slug!r}: use lowercase letters, digits and dashes (2-41 characters)")
    if not app.html.strip() or len(app.html) > MAX_HTML:
        raise ProposalError(f"html must be 1 to {MAX_HTML} characters")
    if re.search(r"<script[^>]+src=", app.html, re.I):
        raise ProposalError("no external scripts: put all JavaScript inline")


def propose(db, app: MiniApp, created_by: str) -> dict:
    validate(app)
    old = current(db, app.slug)
    if old and old["public"] != app.for_guests:
        raise ProposalError(f"{app.slug} is {'public' if old['public'] else 'owner-only'}; use a new slug to change that")
    kind = "public page" if app.for_guests else "app"
    title = f"{'Update' if old else 'New'} {kind}: {app.title}"
    files = [{"path": f"apps/{app.slug}.html", "before": old["html"] if old else None, "after": app.html,
              "before_hash": digest(old["html"]) if old else None}]
    with db.connection() as conn:
        row = conn.execute(
            "insert into changes (kind, title, reason, proposal, files, areas, status, created_by) "
            "values ('mini_app', %s, %s, %s, %s, '[\"mini_app\"]', 'ready', %s) returning id",
            (title, app.description, Jsonb(app.model_dump(mode="json")), Jsonb(files), created_by)).fetchone()
    return {"id": row["id"], "status": "ready", "title": title, "slug": app.slug, "for_guests": app.for_guests}


def apply(db, change_id: int, decided_by: str) -> dict:
    c = get(db, change_id)
    if c["kind"] != "mini_app" or c["status"] != "ready":
        raise ProposalError(f"change {change_id} is {c['status']}; only an app waiting for approval can be applied")
    app, f = MiniApp.model_validate(c["proposal"]), c["files"][0]
    old = current(db, app.slug)
    if digest(old["html"] if old else None) != f["before_hash"]:
        raise ProposalError(f"{app.slug} changed since the proposal; ask Doss to propose it again")
    with db.connection() as conn:
        conn.execute(
            "insert into mini_apps (slug, title, description, html, public, change_id) values (%s, %s, %s, %s, %s, %s) "
            "on conflict (slug) do update set title = excluded.title, description = excluded.description, "
            "html = excluded.html, version = mini_apps.version + 1, change_id = excluded.change_id, updated_at = now()",
            (app.slug, app.title, app.description, app.html, app.for_guests, change_id))
        conn.execute("update changes set status = 'applied', decided_by = %s, decided_at = now() where id = %s",
                     (decided_by, change_id))
    return {"id": change_id, "status": "applied", "slug": app.slug}


def undo(db, change_id: int, decided_by: str) -> dict:
    """Back to the previous version (or remove a new app), unless it changed again since."""
    c = get(db, change_id)
    if c["kind"] != "mini_app" or c["status"] != "applied":
        raise ProposalError(f"change {change_id} is {c['status']}; only an applied app change can be undone")
    slug, f = c["proposal"]["slug"], c["files"][0]
    now = current(db, slug)
    if now is None or now["html"] != f["after"]:
        raise ProposalError(f"{slug} changed after this change; undo the later change first")
    with db.connection() as conn:
        if f["before"] is None:
            conn.execute("delete from mini_apps where slug = %s", (slug,))
        else:
            conn.execute("update mini_apps set html = %s, version = version + 1, updated_at = now() where slug = %s",
                         (f["before"], slug))
        conn.execute("update changes set status = 'undone', decided_by = %s, decided_at = now() where id = %s",
                     (decided_by, change_id))
    return {"id": change_id, "status": "undone"}


def public_info(hotel) -> dict:
    """Hotel info a public page may show: allow-listed facts and the guest-facing KB."""
    def at(path: str):
        value = hotel.facts
        for key in path.split("."):
            value = value.get(key, {}) if isinstance(value, dict) else {}
        return value if value != {} else None
    return {
        "facts": {p: at(p) for p in PUBLIC_FACTS if at(p) is not None},
        "kb": [{"title": d.title, "content": hotel.render(d)} for d in hotel.kb.values() if d.id not in PRIVATE_KB],
    }


def with_bridge(html: str, bridge: str) -> str:
    """Insert the bridge script before the page's own scripts (right after <head>, else at the top)."""
    found = re.search(r"<head[^>]*>", html, re.I)
    return html[:found.end()] + bridge + html[found.end():] if found else bridge + html
