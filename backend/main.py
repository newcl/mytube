from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from api import router as api_router
from middleware import TrailingSlashMiddleware
from database import Base, engine, SessionLocal
from pydantic import BaseModel
from typing import Optional
import logging
import os
import urllib.parse
import crud
import models
from tasks import download_video_task
from sqlalchemy import text

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

app = FastAPI()

# Add trailing slash middleware
app.add_middleware(TrailingSlashMiddleware)

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

# Configure CORS to allow requests from the frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://192.168.1.50:5173"],  # Frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API router with consistent /api prefix
app.include_router(api_router, prefix="/api", tags=["api"])

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
        
        # Create downloads directory if it doesn't exist
        os.makedirs("downloads", exist_ok=True)
        logger.info("Startup completed successfully")
    except Exception as e:
        logger.error(f"Startup failed: {e}")
        raise

if __name__ == "__main__":
    print("Starting FastAPI server...111")
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000) 