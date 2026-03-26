#!/bin/sh
set -e

# Start the Actual Budget sync server
node build/app.js &
SERVER_PID=$!

# Start the email notifier if ACTUAL_BUDGET_ID is set.
# SMTP settings come from /data/server-files/email-config.json (configured via the UI),
# so we no longer check for SMTP_HOST / NOTIFY_EMAIL env vars here.
if [ -n "$ACTUAL_BUDGET_ID" ]; then
  echo "Email notifier: starting..."
  node email-notifier/src/index.js &
  NOTIFIER_PID=$!
else
  echo "Email notifier: skipped (ACTUAL_BUDGET_ID not set)"
  NOTIFIER_PID=""
fi

# If the sync server exits, shut everything down
wait $SERVER_PID
echo "Sync server exited — shutting down"
[ -n "$NOTIFIER_PID" ] && kill "$NOTIFIER_PID" 2>/dev/null
