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
            'speed': '',
            'eta': '',
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
            
            status = d.get('status')
            
            # Handle different statuses
            if status == 'downloading':
                current_time = time.time()
                if current_time - last_update_time < 0.5:  # Limit to 2 updates per second
                    return
                    
                last_update_time = current_time
                
                try:
                    video = db.query(Video).filter(Video.id == video_id).first()
                    if not video:
                        return
                    
                    # Extract key progress info
                    speed = d.get('_speed_str', '0.0KiB/s')
                    eta = d.get('_eta_str', '0:00')
                    downloaded = d.get('downloaded_bytes', 0)
                    total = d.get('total_bytes', 0)
                    
                    # Update video with raw progress info
                    video.download_info = {
                        'filename': os.path.basename(d.get('filename', '')),
                        'speed': speed,
                        'eta': eta,
                        'downloaded': f"{downloaded / 1024 / 1024:.1f}MB" if downloaded > 0 else '0.0MB',
                        'total': f"{total / 1024 / 1024:.1f}MB" if total > 0 else '?',
                        'elapsed': d.get('elapsed', 0)
                    }
                    
                    db.commit()
                    db.refresh(video)
                    
                except Exception as e:
                    logger.error(f"Error updating progress: {e}")
                
            elif status == 'finished':
                logger.info("Download finished, updating final status")
                try:
                    video = db.query(Video).filter(Video.id == video_id).first()
                    if not video:
                        return
                        
                    video.download_info = {
                        'filename': os.path.basename(d.get('filename', '')),
                        'speed': '',
                        'eta': '',
                        'downloaded': f"{d.get('total_bytes', 0) / 1024 / 1024:.1f}MB" if d.get('total_bytes') else '?',
                        'total': f"{d.get('total_bytes', 0) / 1024 / 1024:.1f}MB" if d.get('total_bytes') else '?',
                        'elapsed': d.get('elapsed', 0)
                    }
                    video.status = VideoStatus.DOWNLOADED
                    db.commit()
                    logger.info(f"Successfully marked video {video_id} as downloaded")
                except Exception as e:
                    logger.error(f"Error updating final progress for video {video_id}: {e}")

        # First, get video metadata
        with yt_dlp.YoutubeDL({'quiet': True, 'no_warnings': True}) as ydl:
            try:
                info = ydl.extract_info(video.url, download=False)
                video.title = info.get('title', 'Untitled')
                
                # Get the best thumbnail available
                thumbnails = info.get('thumbnails', [])
                if thumbnails:
                    # Try to get the highest resolution thumbnail
                    thumbnail = max(thumbnails, key=lambda x: x.get('width', 0) * x.get('height', 0))
                    video.thumbnail_url = thumbnail.get('url', '')
                
                db.commit()
                db.refresh(video)
                logger.info(f"Fetched metadata for video {video_id}: {video.title}")
                
            except Exception as e:
                logger.error(f"Error fetching video metadata: {e}")
        
        # Start the download with progress hooks
        ydl_opts = {
            'format': 'best',
            'outtmpl': os.path.join('downloads', f'{video_id}.%(ext)s'),
            'progress_hooks': [progress_hook],
            'progress_with_newline': True,
            'noprogress': False,
            'quiet': False,
            'postprocessors': [{
                'key': 'FFmpegVideoConvertor',
                'preferedformat': 'mp4',
            }],
        }

        logger.info(f"Starting download for URL: {video.url}")
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            logger.info("Created YoutubeDL instance")
            info = ydl.extract_info(video.url, download=True)
            logger.info(f"Download completed for video {video_id}")
            logger.info(f"Extracted info: {info}")
            
            video.title = info.get('title')
            video.thumbnail_url = info.get('thumbnail')
            
            # Get the downloaded file path
            downloaded_file = ydl.prepare_filename(info)
            if os.path.exists(downloaded_file):
                # Get all files that were just generated
                generated_files = set()
                for ext in ['.mp4', '.webm', '.mkv', '.m4a', '.mp3', '.description', '.en.vtt', '.vtt', '.srt', '.webp', '.jpg', '.jpeg', '.png', '.json', '.info.json']:
                    for suffix in ['', '.en', '.en-US', '.en-GB']:
                        file_path = os.path.join('downloads', f'{video_id}{suffix}{ext}')
                        if os.path.exists(file_path):
                            generated_files.add(file_path)
                
                # Clean up any existing files for this video_id that weren't just generated
                if os.path.exists('downloads'):
                    for file in os.listdir('downloads'):
                        if str(video_id) in file:
                            file_path = os.path.join('downloads', file)
                            if file_path not in generated_files:
                                try:
                                    os.remove(file_path)
                                    logger.info(f"Cleaned up old file: {file_path}")
                                except OSError as e:
                                    logger.error(f"Error cleaning up old file {file_path}: {e}")
                
                # Update the file path in the database
                video.file_path = os.path.relpath(downloaded_file, os.getcwd())
                video.file_size = os.path.getsize(downloaded_file)
                video.status = VideoStatus.DOWNLOADED
                db.commit()
                logger.info(f"Video {video_id} marked as DOWNLOADED")
            else:
                logger.error(f"Downloaded file not found at {downloaded_file}")
                raise FileNotFoundError(f"Downloaded file not found at {downloaded_file}")
            
    except Exception as e:
        logger.error(f"Error downloading video {video_id}: {str(e)}")
        video.status = VideoStatus.FAILED
        video.error_message = str(e)
        video.download_info = {
            'progress': 0.0,
            'speed': '',
            'eta': '',
            'total_bytes': 0,
            'downloaded_bytes': 0,
            'elapsed': 0
        }
        db.commit()
    finally:
        db.close()

print("[tasks.py] Huey is ready.")
