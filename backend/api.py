from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from models import Video, VideoStatus
from schemas import VideoCreate, VideoOut, VideoUpdateStatus, VideoQuery
from tasks import download_video_task
from typing import List
import crud
import logging
from fastapi.responses import FileResponse
import mimetypes

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

router = APIRouter()

@router.post("/videos/", response_model=VideoOut)
def submit_video(video: VideoCreate, db: Session = Depends(get_db)):
    logger.info(f"Received request to download video: {video.url}")
    # Check if video already exists
    db_video = crud.get_video_by_url(db, video.url)
    if db_video:
        logger.info(f"Video already exists with id: {db_video.id}")
        return db_video
    
    # Create new video
    logger.info("Creating new video record")
    db_video = crud.create_video(db, video.url)
    
    # Start download task
    logger.info(f"Queueing download task for video_id: {db_video.id}")
    task = download_video_task(db_video.id)
    logger.info(f"Task queued with id: {task.id}")
    
    return db_video

@router.get("/videos/", response_model=List[VideoOut])
def list_videos(query: VideoQuery = None, db: Session = Depends(get_db)):
    logger.info("Received request to list videos")
    try:
        videos = crud.get_videos(db, query)
        logger.info(f"Found {len(videos)} videos")
        for video in videos:
            logger.debug(f"Video {video.id}: {video.title} ({video.status})")
        return videos
    except Exception as e:
        logger.error(f"Error listing videos: {str(e)}")
        raise

@router.delete("/videos/{video_id}")
def delete_video(video_id: int, db: Session = Depends(get_db)):
    return crud.delete_video(db, video_id)

@router.post("/videos/{video_id}/retry")
def retry_video(video_id: int, db: Session = Depends(get_db)):
    video = crud.get_video(db, video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    
    video.status = VideoStatus.PENDING
    video.error_message = None
    db.commit()
    
    download_video_task(video_id)
    return {"message": "Download restarted"}

@router.get("/videos/{video_id}/stream/")
def stream_video(video_id: int, db: Session = Depends(get_db)):
    video = crud.get_video(db, video_id)
    if not video or not video.file_path:
        raise HTTPException(status_code=404, detail="Video not found or file not available")
    
    # Determine media type based on file extension
    mime_type, _ = mimetypes.guess_type(video.file_path)
    if not mime_type:
        mime_type = "application/octet-stream" # Default to generic binary if type cannot be guessed

    return FileResponse(video.file_path, media_type=mime_type) 