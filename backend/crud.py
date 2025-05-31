from sqlalchemy.orm import Session
from models import Video, VideoStatus
from schemas import VideoCreate, VideoQuery
from typing import List, Optional
from sqlalchemy import or_, and_
from datetime import datetime
import os
import logging

logger = logging.getLogger(__name__)

def get_video(db: Session, video_id: int) -> Optional[Video]:
    return db.query(Video).filter(Video.id == video_id).first()

def get_video_by_url(db: Session, url: str) -> Optional[Video]:
    return db.query(Video).filter(Video.url == url).first()

def create_video(db: Session, url: str) -> Video:
    db_video = Video(
        url=url,
        status=VideoStatus.PENDING,
        download_info={
            'progress': 0.0,
            'speed': 'N/A',
            'eta': 'N/A',
            'total_bytes': 0,
            'downloaded_bytes': 0,
            'elapsed': 0
        }
    )
    db.add(db_video)
    db.commit()
    db.refresh(db_video)
    return db_video

def get_videos(db: Session, query: Optional[VideoQuery] = None) -> List[Video]:
    q = db.query(Video)
    if query:
        if query.status:
            q = q.filter(Video.status == query.status)
        if query.search:
            q = q.filter(or_(Video.url.ilike(f"%{query.search}%"), Video.title.ilike(f"%{query.search}%")))
    return q.order_by(Video.created_at.desc()).all()

def delete_video(db: Session, video_id: int) -> bool:
    video = get_video(db, video_id)
    if video:
        if video.file_path and os.path.exists(video.file_path):
            try:
                os.remove(video.file_path)
                logger.info(f"Deleted video file: {video.file_path}")
            except OSError as e:
                logger.error(f"Error deleting video file {video.file_path}: {e}")
                
        db.delete(video)
        db.commit()
        logger.info(f"Deleted video record for ID: {video_id}")
        return True
    logger.warning(f"Video record not found for ID: {video_id}")
    return False

def update_video_status(db: Session, video_id: int, status: VideoStatus, error_message: Optional[str] = None):
    video = get_video(db, video_id)
    if video:
        video.status = status
        video.error_message = error_message
        db.commit()
        db.refresh(video)
    return video

def bulk_retry(db: Session, ids: List[int]):
    db.query(Video).filter(Video.id.in_(ids), Video.status == VideoStatus.FAILED).update(
        {Video.status: VideoStatus.PENDING, Video.error_message: None},
        synchronize_session=False
    )
    db.commit() 