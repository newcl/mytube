#!/bin/bash
set -e

# Remove snap docker if installed
if snap list | grep -q docker; then
  sudo snap remove docker
fi

# Remove old docker packages if any
sudo apt remove -y docker docker-engine docker.io containerd runc || true

# Install prerequisites
sudo apt update
sudo apt install -y ca-certificates curl gnupg lsb-release

# Add Docker official GPG key and repo
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker CE and start service
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io
sudo systemctl enable --now docker

# Add current user to docker group
sudo usermod -aG docker $USER

echo "Docker installed and started. Please logout/login or run 'newgrp docker' before using Docker without sudo."
sudo docker run --rm hello-world

