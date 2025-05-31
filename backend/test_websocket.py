import asyncio
import websockets
import logging

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

async def test_websocket():
    try:
        logger.info("Attempting to connect to WebSocket...")
        async with websockets.connect('ws://127.0.0.1:8000/ws') as websocket:
            logger.info("Connected to WebSocket")
            
            # Send a test message
            test_message = "Hello WebSocket!"
            logger.info(f"Sending message: {test_message}")
            await websocket.send(test_message)
            
            # Wait for response
            response = await websocket.recv()
            logger.info(f"Received response: {response}")
            
    except Exception as e:
        logger.error(f"WebSocket test failed: {e}")

if __name__ == "__main__":
    asyncio.run(test_websocket()) 