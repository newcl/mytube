from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from models import Video, VideoStatus
from schemas import VideoCreate, VideoOut, VideoUpdateStatus, VideoQuery
from tasks import download_video_task
from typing import List
import crud
import logging

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
    db_video = Video(url=video.url, status=VideoStatus.PENDING)
    db.add(db_video)
    db.commit()
    db.refresh(db_video)
    
    # Start download task
    logger.info(f"Queueing download task for video_id: {db_video.id}")
    task = download_video_task(db_video.id)
    logger.info(f"Task queued with id: {task.id}")
    
    return db_video

@router.get("/videos/", response_model=List[VideoOut])
def list_videos(query: VideoQuery = None, db: Session = Depends(get_db)):
    return crud.get_videos(db, query)

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