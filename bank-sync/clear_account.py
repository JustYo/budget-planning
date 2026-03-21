#!/usr/bin/env python3
"""
Delete ALL transactions from the configured Actual Budget account.
Run this once to clear duplicates, then re-sync cleanly.

Usage: python clear_account.py
"""

import os

from actual import Actual
from actual.queries import get_accounts, get_transactions

ACTUAL_URL        = os.environ.get("ACTUAL_URL", "https://budget.ops.quest")
ACTUAL_PASSWORD   = os.environ["ACTUAL_PASSWORD"]
ACTUAL_ACCOUNT_ID = os.environ["ACTUAL_ACCOUNT_ID"]

with Actual(base_url=ACTUAL_URL, password=ACTUAL_PASSWORD) as actual:
    budgets = actual.list_user_files().data
    actual.set_file(budgets[0])
    actual.download_budget()

    accounts = {str(a.id): a for a in get_accounts(actual.session)}
    account = accounts[ACTUAL_ACCOUNT_ID]

    txs = get_transactions(actual.session, account=account)
    count = len(txs)
    print(f"Found {count} transactions. Deleting...")

    for tx in txs:
        tx.tombstone = 1

    actual.commit()
    print(f"Done. {count} transactions deleted.")
