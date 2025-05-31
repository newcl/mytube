from fastapi import FastAPI, Request, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from api import router as api_router
from database import Base, engine, SessionLocal
from pydantic import BaseModel
from typing import Optional, List
import logging
import os
import urllib.parse
import crud
import models
from tasks import download_video_task, progress_queue
import json
import asyncio
import threading
from sqlalchemy import text

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

app = FastAPI()

# Custom static file handler for downloads
@app.get("/downloads/{filename:path}")
async def get_download(filename: str):
    try:
        # Decode the URL-encoded filename
        decoded_filename = urllib.parse.unquote(filename)
        file_path = os.path.join("downloads", decoded_filename)
        
        logger.info(f"Attempting to serve file: {file_path}")
        logger.info(f"Original filename: {filename}")
        logger.info(f"Decoded filename: {decoded_filename}")
        logger.info(f"Full file path: {os.path.abspath(file_path)}")
        
        if not os.path.exists(file_path):
            logger.error(f"File not found: {file_path}")
            # List available files for debugging
            if os.path.exists("downloads"):
                logger.info("Available files in downloads directory:")
                for file in os.listdir("downloads"):
                    logger.info(f"- {file}")
            raise HTTPException(status_code=404, detail="File not found")
            
        # Log file size and permissions
        file_stat = os.stat(file_path)
        logger.info(f"File size: {file_stat.st_size} bytes")
        logger.info(f"File permissions: {oct(file_stat.st_mode)}")
            
        # Use a simple filename for Content-Disposition to avoid encoding issues
        simple_filename = "video.mp4"
        return FileResponse(
            path=file_path,
            media_type="video/mp4",
            filename=simple_filename,
            headers={
                "Content-Disposition": f'inline; filename="{simple_filename}"',
                "Accept-Ranges": "bytes",
                "Content-Type": "video/mp4"
            }
        )
    except Exception as e:
        logger.error(f"Error serving file: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Store active WebSocket connections
active_connections: List[WebSocket] = []

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    logger.info("WebSocket connection attempt")
    await websocket.accept()
    logger.info("WebSocket connection accepted")
    active_connections.append(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            logger.info(f"Received: {data}")
            await websocket.send_text(f"Message received: {data}")
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
        active_connections.remove(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        if websocket in active_connections:
            active_connections.remove(websocket)
    finally:
        logger.info("WebSocket connection closed")

# Include API router
app.include_router(api_router, prefix="/api")

# Mount the downloads directory
app.mount("/downloads", StaticFiles(directory="downloads"), name="downloads")

class VideoCreate(BaseModel):
    url: str

class VideoResponse(BaseModel):
    id: int
    title: Optional[str]
    status: str
    created_at: str
    file_path: Optional[str]
    url: str
    download_info: Optional[dict]

async def process_progress_queue():
    """Process progress updates from the queue and send them to WebSocket clients"""
    while True:
        try:
            # Get progress update from queue
            update = progress_queue.get()
            if update:
                # Send to all connected clients
                for connection in active_connections[:]:  # Create a copy of the list
                    try:
                        await connection.send_json(update)
                    except:
                        # Remove dead connections
                        active_connections.remove(connection)
        except Exception as e:
            logger.error(f"Error processing progress queue: {e}")
        await asyncio.sleep(0.1)  # Small delay to prevent CPU overuse

@app.on_event("startup")
async def startup_event():
    try:
        # Create database tables
        logger.info("Creating database tables...")
        Base.metadata.create_all(bind=engine)
        logger.info("Database tables created successfully")
        
        # Test database connection
        db = SessionLocal()
        try:
            # Try to query the database using text()
            db.execute(text("SELECT 1"))
            logger.info("Database connection successful")
        except Exception as e:
            logger.error(f"Database connection failed: {e}")
            raise
        finally:
            db.close()
        
        # Start the progress queue processor
        asyncio.create_task(process_progress_queue())
        
        # Create downloads directory if it doesn't exist
        os.makedirs("downloads", exist_ok=True)
        logger.info("Startup completed successfully")
    except Exception as e:
        logger.error(f"Startup failed: {e}")
        raise

@app.get("/test-video")
async def test_video():
    """Test endpoint to serve a video file directly"""
    try:
        # Get the first video file from downloads directory
        downloads_dir = "downloads"
        if not os.path.exists(downloads_dir):
            raise HTTPException(status_code=404, detail="Downloads directory not found")
            
        video_files = [f for f in os.listdir(downloads_dir) if f.endswith('.mp4')]
        if not video_files:
            raise HTTPException(status_code=404, detail="No video files found")
            
        video_path = os.path.join(downloads_dir, video_files[0])
        logger.info(f"Serving test video: {video_path}")
        
        return FileResponse(
            path=video_path,
            media_type="video/mp4",
            filename=video_files[0]
        )
    except Exception as e:
        logger.error(f"Error serving test video: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/")
async def root():
    return {"message": "Welcome to MyTube API"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000) 