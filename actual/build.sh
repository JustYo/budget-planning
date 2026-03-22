#!/bin/bash
set -e

IMAGE="harbor.ops.quest/library/actual-budget:latest"

echo "Building $IMAGE..."
docker build -f sync-server.Dockerfile -t "$IMAGE" .

echo "Pushing $IMAGE..."
docker push "$IMAGE"

echo "Restarting deployment..."
kubectl rollout restart deployment/actual-budget -n budget
