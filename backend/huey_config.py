from huey import RedisHuey
import logging

# Configure logging
logging.getLogger('huey.consumer.Scheduler').setLevel(logging.INFO)
logging.getLogger('huey.consumer').setLevel(logging.INFO)

# Initialize Huey with Redis
huey = RedisHuey('mytube', host='localhost', port=6379) 