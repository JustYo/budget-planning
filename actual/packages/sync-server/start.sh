#!/bin/sh
set -e

# Start the Actual Budget sync server
node app.js &
SERVER_PID=$!

# Start the email notifier (only if SMTP_HOST is configured)
if [ -n "$SMTP_HOST" ] && [ -n "$NOTIFY_EMAIL" ] && [ -n "$ACTUAL_BUDGET_ID" ]; then
  echo "Email notifier: starting..."
  node email-notifier/src/index.js &
  NOTIFIER_PID=$!
else
  echo "Email notifier: skipped (SMTP_HOST, NOTIFY_EMAIL or ACTUAL_BUDGET_ID not set)"
  NOTIFIER_PID=""
fi

# If the sync server exits, shut everything down
wait $SERVER_PID
echo "Sync server exited — shutting down"
[ -n "$NOTIFIER_PID" ] && kill "$NOTIFIER_PID" 2>/dev/null
