from sqlalchemy.orm import Session
from models import Video, VideoStatus, Playlist
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
            'speed': '',
            'eta': '',
            'total_bytes': 0,
            'downloaded_bytes': 0,
            'elapsed': 0
        }
    )
    db.add(db_video)
    db.commit()
    db.refresh(db_video)
    return db_video

def get_videos(db: Session, query: VideoQuery = None) -> List[Video]:
    videos_query = db.query(Video)
    
    if query:
        if query.status:
            videos_query = videos_query.filter(Video.status == query.status)
        if query.search:
            search_term = f"%{query.search}%"
            videos_query = videos_query.filter(
                (Video.title.contains(search_term)) | 
                (Video.url.contains(search_term))
            )
    
    return videos_query.order_by(Video.created_at.desc()).all()

def delete_video(db: Session, video_id: int) -> bool:
    video = get_video(db, video_id)
    if video:
        # Clean up all possible file extensions
        extensions = [
            # Video files
            '.mp4', '.webm', '.mkv', '.m4a', '.mp3',
            # Description files
            '.description',
            # Subtitle files
            '.en.vtt', '.vtt', '.srt',
            # Thumbnail files
            '.webp', '.jpg', '.jpeg', '.png',
            # Other metadata files
            '.json', '.info.json'
        ]
        
        # First try to delete the file from the database record
        if video.file_path:
            try:
                if os.path.exists(video.file_path):
                    os.remove(video.file_path)
                    logger.info(f"Deleted file from database path: {video.file_path}")
            except OSError as e:
                logger.error(f"Error deleting file from database path {video.file_path}: {e}")
        
        # Then try all possible extensions
        for ext in extensions:
            # Try with video_id
            file_path = os.path.join('downloads', f'{video_id}{ext}')
            if os.path.exists(file_path):
                try:
                    os.remove(file_path)
                    logger.info(f"Deleted file: {file_path}")
                except OSError as e:
                    logger.error(f"Error deleting file {file_path}: {e}")
            
            # Try with video_id and additional suffixes
            for suffix in ['', '.en', '.en-US', '.en-GB']:
                file_path = os.path.join('downloads', f'{video_id}{suffix}{ext}')
                if os.path.exists(file_path):
                    try:
                        os.remove(file_path)
                        logger.info(f"Deleted file: {file_path}")
                    except OSError as e:
                        logger.error(f"Error deleting file {file_path}: {e}")
        
        # List remaining files for debugging
        if os.path.exists('downloads'):
            logger.info("Remaining files in downloads directory:")
            for file in os.listdir('downloads'):
                if str(video_id) in file:
                    logger.info(f"Found leftover file: {file}")
        
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

def get_playlist(db: Session, playlist_id: int) -> Optional[Playlist]:
    return db.query(Playlist).filter(Playlist.id == playlist_id).first()

def get_playlists(db: Session) -> List[Playlist]:
    return db.query(Playlist).order_by(Playlist.created_at.desc()).all()

def create_playlist(db: Session, name: str, description: str = None) -> Playlist:
    db_playlist = Playlist(name=name, description=description)
    db.add(db_playlist)
    db.commit()
    db.refresh(db_playlist)
    return db_playlist

def update_playlist(db: Session, playlist_id: int, name: str, description: str = None) -> Optional[Playlist]:
    playlist = db.query(Playlist).filter(Playlist.id == playlist_id).first()
    if playlist:
        playlist.name = name
        playlist.description = description
        db.commit()
        db.refresh(playlist)
        return playlist
    return None

def delete_playlist(db: Session, playlist_id: int) -> bool:
    playlist = db.query(Playlist).filter(Playlist.id == playlist_id).first()
    if playlist:
        db.delete(playlist)
        db.commit()
        return True
    return False

def add_video_to_playlist(db: Session, playlist_id: int, video_id: int) -> bool:
    playlist = db.query(Playlist).filter(Playlist.id == playlist_id).first()
    video = db.query(Video).filter(Video.id == video_id).first()
    
    if playlist and video:
        if video not in playlist.videos:
            playlist.videos.append(video)
            db.commit()
            return True
    return False

def remove_video_from_playlist(db: Session, playlist_id: int, video_id: int) -> bool:
    playlist = db.query(Playlist).filter(Playlist.id == playlist_id).first()
    video = db.query(Video).filter(Video.id == video_id).first()
    
    if playlist and video:
        if video in playlist.videos:
            playlist.videos.remove(video)
            db.commit()
            return True
    return False

def get_playlist_videos(db: Session, playlist_id: int) -> List[Video]:
    playlist = db.query(Playlist).filter(Playlist.id == playlist_id).first()
    if playlist:
        return playlist.videos
    return [] 