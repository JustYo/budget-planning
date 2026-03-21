#!/usr/bin/env bash
set -e

IMAGE="harbor.ops.quest/library/eb-importer:latest"

echo "Building $IMAGE ..."
docker build -t "$IMAGE" "$(dirname "$0")"

echo "Pushing ..."
docker push "$IMAGE"

echo "Done. Restart the deployment:"
echo "  kubectl rollout restart deployment/eb-importer -n budget"
