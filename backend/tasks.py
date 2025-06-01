from huey_config import huey
from database import get_db, SessionLocal
from models import Video, VideoStatus
import yt_dlp
import os
import logging
import re
import time

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
        db.close()
        return
    
    try:
        logger.info(f"Updating video {video_id} status to DOWNLOADING")
        video.status = VideoStatus.DOWNLOADING
        video.download_info = {
            'progress': 0.0,
            'speed': 'N/A',
            'eta': 'N/A',
            'total_bytes': 0,
            'downloaded_bytes': 0,
            'elapsed': 0
        }
        db.commit()
        db.refresh(video)
        
        last_update_time = 0
        update_interval = 0.1  # Update every 100ms
        
        def progress_hook(d):
            nonlocal last_update_time
            if d['status'] == 'downloading':
                current_time = time.time()
                if current_time - last_update_time < update_interval:
                    return
                
                last_update_time = current_time
                try:
                    # Extract progress information
                    percent_str = d.get('_percent_str', '0%').strip()
                    try:
                        progress = float(percent_str.replace('%', ''))
                        download_info = {
                            'progress': progress,
                            'speed': d.get('speed_str', 'N/A'),
                            'eta': d.get('eta_str', 'N/A'),
                            'total_bytes': d.get('total_bytes', 0),
                            'downloaded_bytes': d.get('downloaded_bytes', 0),
                            'elapsed': d.get('elapsed', 0),
                        }
                        video.download_info = download_info
                        db.commit()
                    except ValueError as e:
                        logger.error(f"Could not parse progress string '{percent_str}': {e}")
                except Exception as e:
                    logger.error(f"Error updating progress for video {video_id}: {e}")
            elif d['status'] == 'finished':
                try:
                    video.download_info = {
                        'progress': 100.0,
                        'speed': 'N/A',
                        'eta': 'N/A',
                        'total_bytes': d.get('total_bytes', 0),
                        'downloaded_bytes': d.get('total_bytes', 0),
                        'elapsed': d.get('elapsed', 0),
                    }
                    db.commit()
                except Exception as e:
                    logger.error(f"Error updating final progress for video {video_id}: {e}")

        ydl_opts = {
            'format': 'best',
            'outtmpl': f'downloads/{video_id}.%(ext)s',
            'progress_hooks': [progress_hook],
        }

        logger.info(f"Starting download for URL: {video.url}")
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(video.url, download=True)
            logger.info(f"Download completed for video {video_id}")
            
            video.title = info.get('title')
            video.thumbnail_url = info.get('thumbnail')
            video.file_path = ydl.prepare_filename(info)
            
            if video.file_path and os.path.isabs(video.file_path):
                video.file_path = os.path.relpath(video.file_path, os.getcwd())

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
        video.download_info = {
            'progress': 0.0,
            'speed': 'N/A',
            'eta': 'N/A',
            'total_bytes': 0,
            'downloaded_bytes': 0,
            'elapsed': 0
        }
        db.commit()
    finally:
        db.close()

print("[tasks.py] Huey is ready.")
