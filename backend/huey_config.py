from huey import RedisHuey
import logging
import os
from urllib.parse import urlparse

# Configure logging
logging.getLogger('huey.consumer.Scheduler').setLevel(logging.INFO)
logging.getLogger('huey.consumer').setLevel(logging.INFO)

# Get Redis configuration from environment variables
REDIS_URL = os.getenv('REDIS_URL', 'redis://localhost:6379/0')
parsed_url = urlparse(REDIS_URL)

# Initialize Huey with Redis
huey = RedisHuey(
    'mytube',
    host=parsed_url.hostname or 'localhost',
    port=parsed_url.port or 6379,
    db=int(parsed_url.path[1:]) if parsed_url.path else 0,
    password=parsed_url.password
) 