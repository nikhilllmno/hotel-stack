"""Changes API. Doss (or the owner) proposes; only the owner (dashboard key) approves, rejects or undoes.

POST /api/changes body, one of:
  {"proposal": ChangeProposal}             edits written by the caller (validated against the BAML type)
  {"request": "...", "paths": [...]}       BAML DraftChange writes the edits from a plain request
  {"rollback_version": 7}                  restore Danny's hotel files as published in that version
  {"guest_texts": GuestTextBatch}          texts to guests; the exact message per recipient is rendered now
  {"mini_app": MiniApp}                    a new or updated mini app (owner app or public page)
"""

from dataclasses import replace

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ValidationError

from hotelcore import changes, guest_texts, mini_apps
from hotelcore.api.dashboard import caller, require_owner
from hotelcore.baml_client.types import ChangeProposal, GuestTextBatch, MiniApp
from hotelcore.config import load_hotel

router = APIRouter(prefix="/api/changes", dependencies=[Depends(caller)])
LIST_FIELDS = ("id, kind, title, reason, status, areas, created_by, decided_by, created_at, decided_at, version_id, "
               "checks->'review' as review, jsonb_path_query_array(files, '$[*].path') as paths, send_at, "
               "jsonb_array_length(coalesce(proposal->'items', '[]'::jsonb)) as recipients")


class ProposeBody(BaseModel):
    proposal: dict | None = None
    request: str | None = None
    paths: list[str] = []
    rollback_version: int | None = None
    guest_texts: dict | None = None
    mini_app: dict | None = None


def hotel_rel(request: Request) -> str:
    return f"hotels/{request.app.state.ctx.hotel.hotel_id}"


def as_http(fn, *args):
    try:
        return fn(*args)
    except (changes.ProposalError, ValidationError) as e:
        raise HTTPException(400, str(e))


@router.get("")
def list_changes(request: Request, status: str = "", limit: int = 50):
    sql = f"select {LIST_FIELDS} from changes"
    params: dict = {"limit": limit}
    if status:
        sql += " where status = %(status)s"
        params["status"] = status
    with request.app.state.ctx.db.connection() as conn:
        return conn.execute(sql + " order by id desc limit %(limit)s", params).fetchall()


@router.get("/{change_id}")
def get_change(request: Request, change_id: int):
    return as_http(changes.get, request.app.state.ctx.db, change_id)


@router.post("", status_code=201)
async def propose(request: Request, body: ProposeBody, who: str = Depends(caller)):
    db, rel = request.app.state.ctx.db, hotel_rel(request)

    def make() -> dict:
        if body.mini_app is not None:
            return mini_apps.propose(db, MiniApp.model_validate(body.mini_app), who)
        if body.guest_texts is not None:
            return guest_texts.propose(request.app.state.ctx, GuestTextBatch.model_validate(body.guest_texts), who)
        if body.rollback_version is not None:
            proposal, kind = changes.rollback_proposal(db, body.rollback_version, rel), "rollback"
        elif body.request:
            proposal, kind = changes.draft(body.request, body.paths), "files"
        elif body.proposal is not None:
            proposal, kind = ChangeProposal.model_validate(body.proposal), "files"
        else:
            raise changes.ProposalError("send proposal, request (+paths), or rollback_version")
        return {**changes.propose(db, proposal, rel, who, kind), "title": proposal.title}

    return await run_in_threadpool(as_http, make)


def reload_hotel(request: Request, change: dict) -> None:
    """Approved hotel-file changes take effect for texts and tool calls without restarting core."""
    if any(f["path"].startswith("hotels/") for f in change["files"]):
        ctx = request.app.state.ctx
        request.app.state.ctx = replace(ctx, hotel=load_hotel(ctx.hotel.root))


async def decide(request: Request, change_id: int, action) -> dict:
    db = request.app.state.ctx.db
    result = await run_in_threadpool(as_http, action, db, change_id, "owner")
    reload_hotel(request, changes.get(db, change_id))
    return result


@router.post("/{change_id}/approve", dependencies=[Depends(require_owner)])
async def approve(request: Request, change_id: int):
    ctx = request.app.state.ctx
    kind = (await run_in_threadpool(as_http, changes.get, ctx.db, change_id))["kind"]
    if kind == "guest_texts":
        return await run_in_threadpool(as_http, guest_texts.approve, ctx, change_id, "owner")
    if kind == "mini_app":
        return await run_in_threadpool(as_http, mini_apps.apply, ctx.db, change_id, "owner")
    return await decide(request, change_id, changes.apply)


@router.post("/{change_id}/undo", dependencies=[Depends(require_owner)])
async def undo(request: Request, change_id: int):
    db = request.app.state.ctx.db
    if (await run_in_threadpool(as_http, changes.get, db, change_id))["kind"] == "mini_app":
        return await run_in_threadpool(as_http, mini_apps.undo, db, change_id, "owner")
    return await decide(request, change_id, changes.undo)


@router.post("/{change_id}/reject", dependencies=[Depends(require_owner)])
async def reject(request: Request, change_id: int):
    return await run_in_threadpool(as_http, changes.reject, request.app.state.ctx.db, change_id, "owner")
