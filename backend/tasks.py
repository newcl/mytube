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
            logger.info(f"Progress hook called with data: {d}")
            
            if d['status'] == 'downloading':
                current_time = time.time()
                if current_time - last_update_time < update_interval:
                    return
                
                last_update_time = current_time
                try:
                    # Log all available keys in the progress dictionary
                    logger.info(f"Available keys in progress data: {list(d.keys())}")
                    
                    # Extract progress information
                    percent_str = d.get('_percent_str', '0%').strip()
                    logger.info(f"Percent string: {percent_str}")
                    
                    try:
                        progress = float(percent_str.replace('%', ''))
                        logger.info(f"Parsed progress: {progress}")
                        
                        # Format speed and ETA
                        speed = d.get('speed', 0)
                        logger.info(f"Raw speed value: {speed}")
                        speed_str = ''
                        if speed and speed > 0:
                            speed_str = f"{speed/1024/1024:.1f} MB/s"
                        
                        eta = d.get('eta', None)
                        logger.info(f"Raw ETA value: {eta}")
                        eta_str = ''
                        if eta is not None and eta > 0:
                            minutes = eta // 60
                            seconds = eta % 60
                            eta_str = f"{minutes}m {seconds}s"
                        
                        download_info = {
                            'progress': progress,
                            'speed': speed_str,
                            'eta': eta_str,
                            'total_bytes': d.get('total_bytes', 0),
                            'downloaded_bytes': d.get('downloaded_bytes', 0),
                            'elapsed': d.get('elapsed', 0),
                        }
                        logger.info(f"Final download info: {download_info}")
                        video.download_info = download_info
                        db.commit()
                    except ValueError as e:
                        logger.error(f"Could not parse progress string '{percent_str}': {e}")
                except Exception as e:
                    logger.error(f"Error updating progress for video {video_id}: {e}")
            elif d['status'] == 'finished':
                logger.info("Download finished, updating final status")
                try:
                    video.download_info = {
                        'progress': 100.0,
                        'speed': '',
                        'eta': '',
                        'total_bytes': d.get('total_bytes', 0),
                        'downloaded_bytes': d.get('total_bytes', 0),
                        'elapsed': d.get('elapsed', 0),
                    }
                    db.commit()
                except Exception as e:
                    logger.error(f"Error updating final progress for video {video_id}: {e}")

        ydl_opts = {
            'format': 'best',
            'outtmpl': os.path.join('downloads', f'{video_id}.%(ext)s'),
            'progress_hooks': [progress_hook],
            'progress_with_newline': True,
            'noprogress': False,
            'quiet': False,
            'no_warnings': False,
            'verbose': True,
            'progress': True,
            'newline': True,
            'updatetime': True,
            'writedescription': True,
            'writeinfojson': True,
            'writesubtitles': True,
            'writeautomaticsub': True,
            'subtitleslangs': ['en'],
            'writethumbnail': True,
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
