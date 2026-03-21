#!/usr/bin/env python3
"""
Enable Banking → fetch CIC transactions to transactions.json
Run: python sync.py
"""

import json
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import requests
import jwt as pyjwt

API_ORIGIN = "https://api.enablebanking.com"
ASPSP_NAME = "CIC"
ASPSP_COUNTRY = "FR"
DAYS_BACK = 90

BASE_DIR = Path(__file__).parent
CONFIG_PATH = BASE_DIR.parent / "enablebanking-api-samples" / "config.json"


def build_headers() -> dict:
    config = json.load(open(CONFIG_PATH))
    key_path = CONFIG_PATH.parent / config["keyPath"]
    iat = int(datetime.now().timestamp())
    jwt = pyjwt.encode(
        {"iss": "enablebanking.com", "aud": "api.enablebanking.com", "iat": iat, "exp": iat + 3600},
        open(key_path, "rb").read(),
        algorithm="RS256",
        headers={"kid": config["applicationId"]},
    )
    return {"Authorization": f"Bearer {jwt}"}


def main():
    headers = build_headers()

    # Get application redirect URL
    r = requests.get(f"{API_ORIGIN}/application", headers=headers)
    r.raise_for_status()
    app = r.json()

    # Start auth
    r = requests.post(f"{API_ORIGIN}/auth", headers=headers, json={
        "access": {"valid_until": (datetime.now(timezone.utc) + timedelta(days=180)).isoformat()},
        "aspsp": {"name": ASPSP_NAME, "country": ASPSP_COUNTRY},
        "state": str(uuid.uuid4()),
        "redirect_url": app["redirect_urls"][0],
        "psu_type": "personal",
    })
    r.raise_for_status()
    print(f"\nOpen this URL to authenticate with CIC:\n\n  {r.json()['url']}\n")

    # Wait for redirect URL
    redirected = input("Paste the full URL you were redirected to: ").strip()
    code = parse_qs(urlparse(redirected).query)["code"][0]

    # Exchange code for session
    r = requests.post(f"{API_ORIGIN}/sessions", json={"code": code}, headers=headers)
    r.raise_for_status()
    session = r.json()
    print(f"\nSession ready. Found {len(session.get('accounts', []))} account(s).")

    # Fetch transactions for all accounts
    date_from = (datetime.now(timezone.utc) - timedelta(days=DAYS_BACK)).date().isoformat()
    all_transactions = {}

    for acc in session.get("accounts", []):
        uid = acc["uid"]
        print(f"Fetching transactions since {date_from} for account {uid} …")

        transactions = []
        query: dict = {"date_from": date_from}
        while True:
            r = requests.get(f"{API_ORIGIN}/accounts/{uid}/transactions", params=query, headers=headers)
            r.raise_for_status()
            data = r.json()
            transactions.extend(data.get("transactions", []))
            key = data.get("continuation_key")
            if not key:
                break
            query["continuation_key"] = key

        all_transactions[uid] = transactions
        print(f"  → {len(transactions)} transactions fetched")

    out = BASE_DIR / "transactions.json"
    json.dump(all_transactions, open(out, "w"), indent=2, ensure_ascii=False)
    print(f"\nDone. Saved to {out}")


if __name__ == "__main__":
    main()
