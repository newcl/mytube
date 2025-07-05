#!/bin/sh

# Start MinIO in the background
/usr/bin/docker-entrypoint.sh server /data --console-address ":9001" &

# Function to wait for MinIO to be ready and create bucket
wait_and_create_bucket() {
    local max_attempts=30
    local attempt=1
    
    echo "Waiting for MinIO to be ready..."
    
    while [ $attempt -le $max_attempts ]; do
        echo "Attempt $attempt/$max_attempts: Checking if MinIO is ready..."
        
        # Try to connect to MinIO
        if mc alias set myminio http://localhost:9000 minioadmin minioadmin >/dev/null 2>&1; then
            echo "MinIO is ready! Creating bucket..."
            
            # Try to create the bucket
            if mc mb -p myminio/mytube >/dev/null 2>&1; then
                echo "Bucket 'mytube' created successfully!"
                return 0
            else
                echo "Bucket 'mytube' already exists or creation failed, continuing..."
                return 0
            fi
        fi
        
        echo "MinIO not ready yet, waiting 1 second..."
        sleep 1
        attempt=$((attempt + 1))
    done
    
    echo "ERROR: MinIO did not become ready within $max_attempts seconds"
    return 1
}

# Wait for MinIO and create bucket
if wait_and_create_bucket; then
    echo "MinIO initialization completed successfully"
else
    echo "MinIO initialization failed, but continuing..."
fi

# Wait for the MinIO process
wait 