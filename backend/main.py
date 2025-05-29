from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from api import router as api_router
from database import Base, engine
import logging
import os
import urllib.parse

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
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API router
app.include_router(api_router, prefix="/api")

@app.on_event("startup")
async def startup_event():
    try:
        # Create database tables
        logger.info("Creating database tables...")
        Base.metadata.create_all(bind=engine)
        logger.info("Database tables created successfully")
        
        # Log the contents of the downloads directory
        if os.path.exists("downloads"):
            logger.info("Contents of downloads directory:")
            for file in os.listdir("downloads"):
                logger.info(f"- {file}")
        else:
            logger.warning("Downloads directory does not exist!")
    except Exception as e:
        logger.error(f"Error creating database tables: {str(e)}")
        raise

@app.get("/")
async def root():
    return {"message": "Welcome to MyTube API"}

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