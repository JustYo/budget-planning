#!/usr/bin/env python3
"""
Enable Banking → Actual Budget web importer.
Runs at https://importer.ops.quest
"""

import hashlib
import json
import logging
import os
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

import httpx
import jwt as pyjwt
from fastapi import FastAPI
from fastapi.responses import HTMLResponse, RedirectResponse
from actual import Actual
from actual.queries import reconcile_transaction, get_accounts

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config (all from environment — no hardcoded values)
# ---------------------------------------------------------------------------

ACTUAL_URL      = os.environ.get("ACTUAL_URL", "http://actual-budget.budget.svc.cluster.local:5006")
ACTUAL_PASSWORD = os.environ["ACTUAL_PASSWORD"]
ACTUAL_ACCOUNT_ID = os.environ["ACTUAL_ACCOUNT_ID"]

API_ORIGIN    = os.environ.get("EB_API_ORIGIN", "https://api.enablebanking.com")
ASPSP_NAME    = os.environ.get("ASPSP_NAME", "CIC")
ASPSP_COUNTRY = os.environ.get("ASPSP_COUNTRY", "FR")
DAYS_BACK     = int(os.environ.get("DAYS_BACK", "365"))

ACTUAL_BUDGET_PUBLIC_URL = os.environ.get("ACTUAL_BUDGET_PUBLIC_URL", "https://budget.ops.quest")

CONFIG_PATH = Path(os.environ.get("EB_CONFIG_PATH", "/app/eb/config.json"))
PEM_PATH    = Path(os.environ.get("EB_PEM_PATH",    "/app/eb/private.pem"))

# ---------------------------------------------------------------------------
# In-memory state (single-user app)
# ---------------------------------------------------------------------------

_pending: dict[str, str] = {}   # state uuid → started_at ISO
_last_sync: dict = {}

app = FastAPI()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_headers() -> dict:
    config = json.loads(CONFIG_PATH.read_text())
    iat = int(datetime.now().timestamp())
    token = pyjwt.encode(
        {"iss": "enablebanking.com", "aud": "api.enablebanking.com", "iat": iat, "exp": iat + 3600},
        PEM_PATH.read_bytes(),
        algorithm="RS256",
        headers={"kid": config["applicationId"]},
    )
    return {"Authorization": f"Bearer {token}"}


def _page(title: str, body: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title}</title>
  <style>
    *, *::before, *::after {{ box-sizing: border-box; }}
    body {{ font-family: system-ui, sans-serif; background: #f9fafb; color: #111827;
           display: flex; align-items: center; justify-content: center;
           min-height: 100vh; margin: 0; }}
    .card {{ background: white; border-radius: 12px; padding: 40px 48px;
             box-shadow: 0 1px 3px rgba(0,0,0,.1); text-align: center; max-width: 420px; width: 100%; }}
    h1 {{ margin: 0 0 8px; font-size: 22px; }}
    p  {{ color: #6b7280; margin: 0 0 28px; font-size: 15px; }}
    .btn {{ display: inline-block; padding: 12px 28px; background: #4f46e5;
            color: white; border-radius: 8px; text-decoration: none; font-size: 15px;
            font-weight: 500; transition: background .15s; }}
    .btn:hover {{ background: #4338ca; }}
    .btn.secondary {{ background: #f3f4f6; color: #374151; }}
    .btn.secondary:hover {{ background: #e5e7eb; }}
    .meta {{ margin-top: 24px; font-size: 13px; color: #9ca3af; }}
  </style>
</head>
<body><div class="card">{body}</div></body>
</html>"""


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/", response_class=HTMLResponse)
async def index():
    if _last_sync:
        meta = f"Last sync: {_last_sync['time']} — {_last_sync['count']} transactions imported"
    else:
        meta = "No sync yet"
    body = f"""
      <h1>💳 Bank Sync</h1>
      <p>Import your {ASPSP_NAME} transactions into Actual Budget.</p>
      <a class="btn" href="/sync">Sync with {ASPSP_NAME}</a>
      <p class="meta">{meta}</p>
    """
    return _page("Bank Sync", body)


@app.get("/sync")
async def start_sync():
    headers = _build_headers()

    r = httpx.get(f"{API_ORIGIN}/application", headers=headers, timeout=15)
    r.raise_for_status()
    redirect_url = r.json()["redirect_urls"][0]

    state = str(uuid.uuid4())
    _pending[state] = datetime.now(timezone.utc).isoformat()

    r = httpx.post(f"{API_ORIGIN}/auth", headers=headers, timeout=15, json={
        "access": {"valid_until": (datetime.now(timezone.utc) + timedelta(days=180)).isoformat()},
        "aspsp": {"name": ASPSP_NAME, "country": ASPSP_COUNTRY},
        "state": state,
        "redirect_url": redirect_url,
        "psu_type": "personal",
    })
    r.raise_for_status()
    return RedirectResponse(r.json()["url"])


@app.get("/eb-callback", response_class=HTMLResponse)
async def callback(code: str, state: str):
    headers = _build_headers()

    # Exchange code for session
    r = httpx.post(f"{API_ORIGIN}/sessions", json={"code": code}, headers=headers, timeout=15)
    r.raise_for_status()
    session = r.json()
    logger.info("Session created: %s, accounts: %d", session["session_id"], len(session.get("accounts", [])))

    # Fetch transactions and balance for all accounts
    date_from = (datetime.now(timezone.utc) - timedelta(days=DAYS_BACK)).date().isoformat()
    all_transactions = []
    real_balance: float | None = None
    for acc in session.get("accounts", []):
        uid = acc["uid"]
        txs, query = [], {"date_from": date_from}
        while True:
            r = httpx.get(f"{API_ORIGIN}/accounts/{uid}/transactions", params=query, headers=headers, timeout=30)
            r.raise_for_status()
            data = r.json()
            txs.extend(data.get("transactions", []))
            key = data.get("continuation_key")
            if not key:
                break
            query["continuation_key"] = key
        logger.info("Account %s: %d transactions", uid, len(txs))

        rb = httpx.get(f"{API_ORIGIN}/accounts/{uid}/balances", headers=headers, timeout=15)
        rb.raise_for_status()
        for b in rb.json().get("balances", []):
            if b["balance_type"] == "CLBD":
                real_balance = float(b["balance_amount"]["amount"])
                logger.info("Real balance (CLBD): %.2f", real_balance)
                break

        all_transactions.extend(txs)

    # Import into Actual Budget
    imported = 0
    with Actual(base_url=ACTUAL_URL, password=ACTUAL_PASSWORD) as actual:
        budgets = actual.list_user_files().data
        actual.set_file(budgets[0])
        actual.download_budget()

        accounts = {str(a.id): a for a in get_accounts(actual.session)}
        account = accounts.get(ACTUAL_ACCOUNT_ID)
        if not account:
            raise ValueError(f"Actual Budget account {ACTUAL_ACCOUNT_ID} not found")

        already_matched = []
        for tx in all_transactions:
            raw_date = tx.get("booking_date") or tx.get("value_date")
            if not raw_date:
                logger.warning("Skipping transaction with no date: %s", tx)
                continue
            date = datetime.strptime(raw_date, "%Y-%m-%d").date()
            amount = float(tx["transaction_amount"]["amount"])
            if tx.get("credit_debit_indicator") == "DBIT":
                amount = -amount
            remittance = " ".join(tx.get("remittance_information") or []).strip()
            payee_name = (
                tx.get("creditor_name")
                or tx.get("debtor_name")
                or remittance
                or "Unknown"
            )[:100]
            notes = remittance[:255]
            # CIC provides no unique IDs — build a stable hash from transaction fields
            remittance = "|".join(tx.get("remittance_information") or [])
            tx_id = hashlib.sha256(
                f"{raw_date}|{tx['transaction_amount']['amount']}|{tx.get('credit_debit_indicator', '')}|{remittance}".encode()
            ).hexdigest()[:24]

            reconcile_transaction(
                actual.session,
                date=date,
                account=account,
                payee=payee_name,
                notes=notes,
                amount=amount,
                imported_id=tx_id,
                cleared=True,
                already_matched=already_matched,
            )
            imported += 1

        actual.commit()

    # Add/update opening balance so the account total matches the real CLBD balance
    if real_balance is not None:
        imported_sum = sum(
            float(tx["transaction_amount"]["amount"]) * (-1 if tx.get("credit_debit_indicator") == "DBIT" else 1)
            for tx in all_transactions
            if tx.get("booking_date") or tx.get("value_date")
        )
        opening = round(real_balance - imported_sum, 2)
        opening_date = (datetime.now(timezone.utc) - timedelta(days=DAYS_BACK + 1)).date()
        logger.info("Opening balance: %.2f (real=%.2f imported_sum=%.2f)", opening, real_balance, imported_sum)

        with Actual(base_url=ACTUAL_URL, password=ACTUAL_PASSWORD) as actual:
            budgets = actual.list_user_files().data
            actual.set_file(budgets[0])
            actual.download_budget()
            accounts = {str(a.id): a for a in get_accounts(actual.session)}
            account = accounts.get(ACTUAL_ACCOUNT_ID)
            reconcile_transaction(
                actual.session,
                date=opening_date,
                account=account,
                payee="Opening Balance",
                notes="Auto-calculated from real bank balance",
                amount=opening,
                imported_id="opening_balance_cic",
                cleared=True,
            )
            actual.commit()

    _last_sync.update({"time": datetime.now().strftime("%Y-%m-%d %H:%M"), "count": imported})
    logger.info("Imported %d transactions", imported)

    body = f"""
      <h1>✅ Done</h1>
      <p>{imported} transactions imported into Actual Budget.</p>
      <a class="btn" href="{ACTUAL_BUDGET_PUBLIC_URL}">Open Actual Budget</a>
      &nbsp;
      <a class="btn secondary" href="/">Back</a>
    """
    return _page("Sync complete", body)
