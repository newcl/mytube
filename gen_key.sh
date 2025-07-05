#!/bin/bash

# 1. Set your existing MinIO Root/Admin credentials as environment variables
#    REPLACE THESE with the actual MINIO_ROOT_USER and MINIO_ROOT_PASSWORD
#    that your MinIO server is currently using.
EXISTING_MINIO_ADMIN_USER="admin"      # e.g., "minioadmin" or "mysecureuser"
EXISTING_MINIO_ADMIN_PASSWORD="thisisgoodpassword" # e.g., "minioadmin" or "mysecurepassword"

# 2. Configure mc alias (silent output)
#    This step configures 'mc' to connect to your MinIO server
mc alias set myminio http://localhost:9200 "${EXISTING_MINIO_ADMIN_USER}" "${EXISTING_MINIO_ADMIN_PASSWORD}" > /dev/null 2>&1

echo "Generating a new access key and secret key for user '${EXISTING_MINIO_ADMIN_USER}'..."

# 3. Generate a new access key and secret key for the *authenticated* user (your admin user).
#    If --access-key is omitted, MinIO auto-generates a 20-character random access key.
#    The secret key is always auto-generated for this command.
mc admin accesskey create myminio/ "${EXISTING_MINIO_ADMIN_USER}" # This specifies the parent user for the new key.
