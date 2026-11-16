"""Demo deposit payment page: /pay/<token>. No card fields, no real charge. Paying confirms the Beds24 booking."""

from html import escape

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse

from hotelcore.payments import mark_paid, payment
from hotelcore.sms import compose, money, send_and_record
from hotelcore.tools.context import ToolError
from hotelcore.vapi_live import tell_live_call

router = APIRouter()

PAGE = """<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{hotel} - deposit</title><style>
body{{margin:0;font-family:system-ui,sans-serif;background:#f5f1ea;color:#2b2420}}
main{{max-width:420px;margin:40px auto;padding:0 16px}}
.card{{background:#fff;border-radius:12px;padding:24px;box-shadow:0 1px 3px #0002}}
h1{{font-size:20px;margin:0 0 4px}} .muted{{color:#7a6e64;font-size:14px}}
.amount{{font-size:36px;font-weight:700;margin:20px 0 4px}}
button{{width:100%;padding:14px;border:0;border-radius:8px;background:#5b3a29;color:#fff;font-size:16px;cursor:pointer}}
.demo{{background:#fff4d6;border-radius:8px;padding:8px 12px;font-size:13px;margin-bottom:16px}}
.ok{{color:#2f6b3a;font-weight:600}}
</style></head><body><main><div class="card">
<div class="demo">Demo payment page. No card is charged.</div>
<h1>{hotel}</h1><div class="muted">Booking #{booking_id}</div>
<div class="amount">${amount}</div><div class="muted">Deposit to confirm your booking</div>
<div style="margin-top:24px">{action}</div>
</div></main></body></html>"""


def render_page(ctx, p: dict, message: str = "") -> str:
    if p["status"] == "paid":
        action = '<p class="ok">Paid. Your booking is confirmed. We sent you a text.</p>'
    else:
        action = f'<form method="post"><button type="submit">Pay ${float(p["amount"]):,.2f}</button></form>'
    if message:
        action = f"<p>{escape(message)}</p>"
    return PAGE.format(hotel=escape(ctx.hotel.facts["property"]["name"]), booking_id=p["booking_id"],
                       amount=f"{float(p['amount']):,.2f}", action=action)


def pay_and_notify(ctx, token: str) -> dict:
    """mark_paid, then (first time only) text the receipt and tell Danny if the guest is still on the call."""
    before = payment(ctx, token)
    after = mark_paid(ctx, token)
    if before["status"] != "paid" and after["guest_phone"]:
        send_and_record(ctx, after["guest_phone"], compose(ctx, "payment_receipt", after["booking_id"], after["guest_phone"],
                                deposit=money(after["amount"])),
                        "payment_receipt")
    if before["status"] != "paid" and after.get("call_id"):
        tell_live_call(after["call_id"], f"Payment update: the guest just paid the ${money(after['amount'])} deposit for "
                       f"booking {after['booking_id']}. The booking is now confirmed and a receipt was texted. Tell the guest.")
    return after


@router.get("/pay/{token}", response_class=HTMLResponse)
async def pay_page(token: str, request: Request):
    ctx = request.app.state.ctx
    p = await run_in_threadpool(payment, ctx, token)
    if p is None:
        raise HTTPException(status_code=404, detail="unknown link")
    return render_page(ctx, p)


@router.post("/pay/{token}", response_class=HTMLResponse)
async def pay(token: str, request: Request):
    ctx = request.app.state.ctx
    p = await run_in_threadpool(payment, ctx, token)
    if p is None:
        raise HTTPException(status_code=404, detail="unknown link")
    try:
        p = await run_in_threadpool(pay_and_notify, ctx, token)
    except ToolError as e:
        return render_page(ctx, p, str(e))
    return render_page(ctx, p)
