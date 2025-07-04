#!/bin/bash

# Exit on error
set -e

# Configuration
BASE_IMAGE="mytube-backend-base"
FASTAPI_IMAGE="mytube-backend-fastapi"
HUEY_IMAGE="mytube-backend-huey"
VERSION=$(date +%Y%m%d_%H%M%S)

echo "Building backend Docker images..."

# Build base image
echo "Building base image..."
docker build -t ${BASE_IMAGE}:latest -f Dockerfile.base .

# Build FastAPI image
echo "Building FastAPI image..."
docker build -t ${FASTAPI_IMAGE}:latest -t ${FASTAPI_IMAGE}:${VERSION} -f Dockerfile.fastapi .

# Build Huey image
echo "Building Huey image..."
docker build -t ${HUEY_IMAGE}:latest -t ${HUEY_IMAGE}:${VERSION} -f Dockerfile.huey .

echo "Build completed successfully!"
echo "Image tags:"
echo "  Base:"
echo "    - ${BASE_IMAGE}:latest"
echo "  FastAPI:"
echo "    - ${FASTAPI_IMAGE}:latest"
echo "    - ${FASTAPI_IMAGE}:${VERSION}"
echo "  Huey:"
echo "    - ${HUEY_IMAGE}:latest"
echo "    - ${HUEY_IMAGE}:${VERSION}"

# Optional: Push to registry if needed
# echo "Pushing to registry..."
# docker push ${BASE_IMAGE}:latest
# docker tag ${FASTAPI_IMAGE}:latest localhost:5000/${FASTAPI_IMAGE}:latest
# docker push localhost:5000/${FASTAPI_IMAGE}:latest
# docker push ${FASTAPI_IMAGE}:${VERSION}
# docker tag ${HUEY_IMAGE}:latest localhost:5000/${HUEY_IMAGE}:latest
# docker push localhost:5000/${HUEY_IMAGE}:latest
# docker push ${HUEY_IMAGE}:${VERSION} 