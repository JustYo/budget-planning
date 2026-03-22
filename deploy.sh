#!/usr/bin/env bash
# Deploy terra-budget via Helm.
# Secrets are passed on the command line — never written to disk.
#
# Required env vars:
#   ACTUAL_PASSWORD      — Actual Budget server password
#   ACTUAL_BUDGET_ID     — Actual Budget sync ID (Settings → Show advanced settings)
#   ACTUAL_ACCOUNT_ID    — Actual Budget account UUID (Enable Banking)
#   EB_APPLICATION_ID    — Enable Banking application UUID
#   EB_REDIRECT_URL      — Enable Banking OAuth redirect URL
#   EB_PEM_PATH          — Local path to the Enable Banking private key (.pem)
#
# Usage:
#   export ACTUAL_PASSWORD="..."
#   export ACTUAL_BUDGET_ID="..."
#   export ACTUAL_ACCOUNT_ID="..."
#   export EB_APPLICATION_ID="..."
#   export EB_REDIRECT_URL="https://budget.ops.quest/auth_redirect"
#   export EB_PEM_PATH="/path/to/private.pem"
#   ./deploy.sh

set -euo pipefail

CHART_DIR="$(cd "$(dirname "$0")" && pwd)"
RELEASE="budget-planning"
NAMESPACE="budget"

: "${ACTUAL_PASSWORD:?ACTUAL_PASSWORD is required}"
: "${ACTUAL_BUDGET_ID:?ACTUAL_BUDGET_ID is required}"
: "${ACTUAL_ACCOUNT_ID:?ACTUAL_ACCOUNT_ID is required}"
: "${EB_APPLICATION_ID:?EB_APPLICATION_ID is required}"
: "${EB_REDIRECT_URL:?EB_REDIRECT_URL is required}"
: "${EB_PEM_PATH:?EB_PEM_PATH is required}"

if [[ ! -f "$EB_PEM_PATH" ]]; then
  echo "ERROR: PEM file not found: $EB_PEM_PATH" >&2
  exit 1
fi

# shellcheck disable=SC2086
helm upgrade --install "$RELEASE" "$CHART_DIR" \
  --namespace "$NAMESPACE" --create-namespace \
  --set "secrets.actualPassword=${ACTUAL_PASSWORD}" \
  --set "actualBudget.emailNotifier.budgetId=${ACTUAL_BUDGET_ID}" \
  --set "secrets.ebApplicationId=${EB_APPLICATION_ID}" \
  --set "secrets.ebRedirectUrl=${EB_REDIRECT_URL}" \
  --set "ebImporter.config.actualAccountId=${ACTUAL_ACCOUNT_ID}" \
  --set-file "secrets.ebPrivateKey=${EB_PEM_PATH}"

echo "Done. Verify with: kubectl get all -n ${NAMESPACE}"
