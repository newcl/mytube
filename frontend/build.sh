#!/bin/bash

# Exit on error
set -e

# Configuration
IMAGE_NAME="mytube-frontend"
VERSION=$(date +%Y%m%d_%H%M%S)
LATEST_TAG="${IMAGE_NAME}:latest"
VERSION_TAG="${IMAGE_NAME}:${VERSION}"
BACKEND_URL="http://fastapi.mytube.svc.cluster.local/api"

# Print the backend URL for debugging
echo "Using BACKEND_URL: ${BACKEND_URL}"

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "Error: Docker is not installed. Please install Docker first."
    exit 1
fi

echo "Building frontend application..."

# Install dependencies
echo "Installing dependencies..."
npm install --legacy-peer-deps

# Build Docker image
echo "Building Docker image..."
docker build \
  --build-arg VITE_BACKEND_URL=${BACKEND_URL} \
  -t ${LATEST_TAG} \
  -t ${VERSION_TAG} .

echo "Build completed successfully!"
echo "Image tags:"
echo "  - ${LATEST_TAG}"
echo "  - ${VERSION_TAG}"

# Optional: Push to registry if needed
# echo "Pushing to registry..."
docker tag ${LATEST_TAG} localhost:5000/${LATEST_TAG}
docker push localhost:5000/${LATEST_TAG}
# docker push ${VERSION_TAG} 