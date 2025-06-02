#!/bin/bash

# Exit on error
set -e

# Configuration
IMAGE_NAME="mytube-frontend"
VERSION=$(date +%Y%m%d_%H%M%S)
LATEST_TAG="${IMAGE_NAME}:latest"
VERSION_TAG="${IMAGE_NAME}:${VERSION}"

echo "Building frontend application..."

# Install dependencies
echo "Installing dependencies..."
npm install

# Build the application
echo "Building application..."
npm run build

# Build Docker image
echo "Building Docker image..."
docker build -t ${LATEST_TAG} -t ${VERSION_TAG} .

echo "Build completed successfully!"
echo "Image tags:"
echo "  - ${LATEST_TAG}"
echo "  - ${VERSION_TAG}"

# Optional: Push to registry if needed
# echo "Pushing to registry..."
# docker push ${LATEST_TAG}
# docker push ${VERSION_TAG} 