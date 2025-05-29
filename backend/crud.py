from sqlalchemy.orm import Session
from models import Video
from schemas import VideoCreate, VideoQuery
from typing import List, Optional
from sqlalchemy import or_, and_
from datetime import datetime

def get_video(db: Session, video_id: int) -> Optional[Video]:
    return db.query(Video).filter(Video.id == video_id).first()

def get_video_by_url(db: Session, url: str) -> Optional[Video]:
    return db.query(Video).filter(Video.url == url).first()

def create_video(db: Session, video: VideoCreate) -> Video:
    db_video = Video(url=video.url, status="pending")
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
        db.delete(video)
        db.commit()
        return True
    return False

def update_video_status(db: Session, video_id: int, status: str, error_message: Optional[str] = None):
    video = get_video(db, video_id)
    if video:
        video.status = status
        video.error_message = error_message
        db.commit()
        db.refresh(video)
    return video

def bulk_retry(db: Session, ids: List[int]):
    db.query(Video).filter(Video.id.in_(ids), Video.status == "failed").update({Video.status: "pending", Video.error_message: None}, synchronize_session=False)
    db.commit() 