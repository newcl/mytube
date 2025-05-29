from huey_config import huey
from database import get_db
from models import Video, VideoStatus
import yt_dlp
import os
import logging
import re
import shutil

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

def sanitize_filename(filename: str) -> str:
    # Replace spaces and special characters with underscores
    sanitized = re.sub(r'[^\w\-\.]', '_', filename)
    # Remove multiple consecutive underscores
    sanitized = re.sub(r'_+', '_', sanitized)
    return sanitized

@huey.task()
def download_video_task(video_id: int):
    logger.info(f"Starting download task for video_id: {video_id}")
    db = next(get_db())
    video = db.query(Video).filter(Video.id == video_id).first()
    if not video:
        logger.error(f"Video with id {video_id} not found")
        return
    
    try:
        logger.info(f"Updating video {video_id} status to DOWNLOADING")
        video.status = VideoStatus.DOWNLOADING
        db.commit()
        
        ydl_opts = {
            'format': 'best',
            'outtmpl': f'downloads/{video_id}.%(ext)s',  # Use video ID as filename
        }
        
        logger.info(f"Starting download for URL: {video.url}")
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(video.url, download=True)
            logger.info(f"Download completed for video {video_id}")
            
            # Store original title and other metadata in the database
            video.title = info.get('title')
            video.thumbnail_url = info.get('thumbnail')
            
            # Use video ID as the filename
            video.file_path = f"downloads/{video_id}.{info.get('ext')}"
            
            # Verify the file exists and get its size
            if not os.path.exists(video.file_path):
                logger.error(f"File not found at {video.file_path}")
                raise FileNotFoundError(f"File not found at {video.file_path}")
            
            video.file_size = os.path.getsize(video.file_path)
            video.status = VideoStatus.DOWNLOADED
            db.commit()
            logger.info(f"Video {video_id} marked as DOWNLOADED")
            
    except Exception as e:
        logger.error(f"Error downloading video {video_id}: {str(e)}")
        video.status = VideoStatus.FAILED
        video.error_message = str(e)
        db.commit()

print("[tasks.py] Huey is ready.")
