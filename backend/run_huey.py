# run_huey.py
from huey.consumer import Consumer
from tasks import huey
import logging
import os

# Get log level from environment variable, default to INFO
log_level = getattr(logging, os.getenv('HUEY_LOG_LEVEL', 'INFO'))

# Configure logging
logging.basicConfig(level=log_level)
logger = logging.getLogger(__name__)

# Set Huey's logger level
logging.getLogger('huey').setLevel(log_level)
logging.getLogger('huey.consumer').setLevel(log_level)
logging.getLogger('huey.consumer.Scheduler').setLevel(log_level)

if __name__ == '__main__':
    try:
        logger.info("🚀 Starting Huey consumer...")
        consumer = Consumer(huey, workers=1, periodic=True, backoff=1.15)
        logger.info("Consumer initialized, starting to run...")
        # Explicitly silence scheduler debug logs
        logging.getLogger('huey.consumer.Scheduler').setLevel(logging.WARNING)
        consumer.run()
    except Exception as e:
        logger.error(f"Error running Huey consumer: {str(e)}")
        raise

