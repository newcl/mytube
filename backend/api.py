import os
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from database import get_db
from models import Video, VideoStatus
from schemas import VideoCreate, VideoOut, VideoUpdateStatus, VideoQuery
from tasks import download_video_task, minio_client, public_minio_client, MINIO_BUCKET
from typing import List, Dict, Any
import crud
import logging
import json
import asyncio
from fastapi.responses import FileResponse, StreamingResponse, RedirectResponse
from sse_starlette.sse import EventSourceResponse
import mimetypes
from datetime import timedelta

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

router = APIRouter()

@router.get("/health")
def health_check():
    return {"status": "healthy"}

def get_signed_url(minio_url: str, expires=3600):
    logger.debug(f"get_signed_url called with: {minio_url}")
    if not minio_url or not minio_url.startswith("http"):
        logger.debug(f"Returning original URL (not http): {minio_url}")
        return minio_url
    # Extract the MinIO object path from the URL
    # e.g. https://minio.elladali.com/mytube/104/video.mp4 -> 104/video.mp4
    parts = minio_url.split("/mytube/")
    if len(parts) != 2:
        logger.debug(f"Returning original URL (no /mytube/ found): {minio_url}")
        return minio_url
    minio_path = parts[1]
    logger.debug(f"Extracted minio_path: {minio_path}")
    try:
        # Use the internal minio_client to generate the presigned URL
        signed_url = minio_client.presigned_get_object(MINIO_BUCKET, minio_path, expires=timedelta(seconds=expires))
        logger.debug(f"Generated presigned URL: {signed_url}")
        return signed_url
    except Exception as e:
        logger.error(f"Failed to generate signed URL for {minio_path}: {e}")
        return minio_url

# Helper to sign video and thumbnail URLs

def sign_video_urls(video):
    if hasattr(video, 'file_path') and video.file_path:
        video.file_path = get_signed_url(video.file_path)
    if hasattr(video, 'thumbnail_url') and video.thumbnail_url:
        video.thumbnail_url = get_signed_url(video.thumbnail_url)
    return video

@router.post("/videos", response_model=VideoOut)
def submit_video(video: VideoCreate, db: Session = Depends(get_db)):
    logger.info(f"Received request to download video: {video.url}")
    # Check if video already exists
    db_video = crud.get_video_by_url(db, video.url)
    if db_video:
        logger.info(f"Video already exists with id: {db_video.id}")
        return sign_video_urls(db_video)
    
    # Create new video
    logger.info("Creating new video record")
    db_video = crud.create_video(db, video.url)
    
    # Start download task
    logger.info(f"Queueing download task for video_id: {db_video.id}")
    task = download_video_task(db_video.id)
    logger.info(f"Task queued with id: {task.id}")
    
    return sign_video_urls(db_video)

@router.get("/videos", response_model=List[VideoOut])
def list_videos(query: VideoQuery = None, db: Session = Depends(get_db)):
    logger.info("Received request to list videos")
    try:
        videos = crud.get_videos(db, query)
        logger.info(f"Found {len(videos)} videos")
        for video in videos:
            logger.debug(f"Video {video.id}: {video.title} ({video.status})")
            sign_video_urls(video)
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

@router.get("/videos/{video_id}/stream")
async def stream_video(video_id: int, db: Session = Depends(get_db)):
    video = crud.get_video(db, video_id)
    if not video or not video.file_path or not video.file_path.startswith("http"):
        raise HTTPException(status_code=404, detail="Video not found or not available in MinIO")
    minio_path = video.file_path.split("/mytube/")[-1]
    
    # Use the internal minio_client to generate the presigned URL
    signed_url = minio_client.presigned_get_object(MINIO_BUCKET, minio_path, expires=timedelta(seconds=3600))
    return RedirectResponse(signed_url)

@router.get("/videos/{video_id}/progress")
async def video_progress(request: Request, video_id: int):
    """SSE endpoint for streaming download progress updates"""
    async def event_generator():
        last_progress = -1
        db = next(get_db())
        
        try:
            while True:
                # Check if client disconnected
                if await request.is_disconnected():
                    logger.info(f"Client disconnected from video {video_id} progress")
                    break
                
                try:
                    # Get fresh video data
                    db_video = crud.get_video(db, video_id)
                    if not db_video:
                        yield {"event": "error", "data": json.dumps({"message": "Video not found"})}
                        break
                        
                    # Check if download is complete or failed
                    if db_video.status in [VideoStatus.DOWNLOADED, VideoStatus.FAILED]:
                        status_str = db_video.status.value.lower()
                        yield {
                            "event": "end",
                            "data": json.dumps({
                                "status": status_str,
                                "progress": 100 if db_video.status == VideoStatus.DOWNLOADED else 0,
                                "message": db_video.error_message or ""
                            })
                        }
                        break
                        
                    # Get current progress
                    current_progress = db_video.download_info.get('progress', 0) if db_video.download_info else 0
                    
                    # Only send update if progress changed or it's the first update
                    if current_progress > last_progress or last_progress == -1:
                        last_progress = current_progress
                        status_str = db_video.status.value.lower()
                        yield {
                            "event": "progress",
                            "data": json.dumps({
                                "progress": current_progress,
                                "status": status_str,
                                "speed": db_video.download_info.get('speed', '') if db_video.download_info else '',
                                "eta": db_video.download_info.get('eta', '') if db_video.download_info else '',
                                "total_bytes": db_video.download_info.get('total_bytes', 0) if db_video.download_info else 0,
                                "downloaded_bytes": db_video.download_info.get('downloaded_bytes', 0) if db_video.download_info else 0
                            })
                        }
                    
                    # Wait before next update
                    await asyncio.sleep(1)
                    
                except asyncio.CancelledError:
                    logger.info(f"SSE connection cancelled for video {video_id}")
                    break
                except Exception as e:
                    logger.error(f"Error in SSE stream for video {video_id}: {str(e)}")
                    yield {"event": "error", "data": json.dumps({"message": f"Error: {str(e)}"})}
                    break
                    
        finally:
            # Ensure database connection is closed
            try:
                db.close()
            except Exception as e:
                logger.error(f"Error closing database connection: {str(e)}")
    
    # Return the SSE response with proper headers
    return EventSourceResponse(
        event_generator(),
        headers={
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'  # Disable buffering for nginx
        }
    )

@router.get("/videos/{video_id}", response_model=VideoOut)
def get_video(video_id: int, db: Session = Depends(get_db)):
    video = crud.get_video(db, video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    return sign_video_urls(video) 