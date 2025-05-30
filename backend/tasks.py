from huey_config import huey
from database import get_db, SessionLocal
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

def progress_hook(d):
    if d['status'] == 'downloading':
        video_id = d['info_dict']['video_id'] # Assuming video_id is stored in info_dict
        percent_str = d.get('_percent_str', '').strip()
        if percent_str and percent_str != 'N/A%':
            try:
                # Remove '%' and convert to float
                progress_percent = float(percent_str.replace('%', ''))
                db = SessionLocal() # Get a new DB session for the hook
                try:
                    video = db.query(Video).filter(Video.id == int(video_id)).first()
                    if video:
                        video.download_progress = progress_percent
                        db.commit()
                        # logger.debug(f"Video {video_id} progress: {progress_percent}%") # Optional: log progress
                finally:
                    db.close()
            except ValueError as e:
                logger.error(f"Could not parse progress string '{percent_str}': {e}")
            except Exception as e:
                logger.error(f"Error updating progress for video {video_id}: {e}")

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
        video.download_progress = 0.0 # Reset progress at the start
        db.commit()
        db.refresh(video) # Refresh to get the latest state including progress=0
        
        ydl_opts = {
            'format': 'best',
            'outtmpl': f'downloads/{video_id}.%(ext)s',  # Use video ID as filename
            'progress_hooks': [progress_hook], # Add the progress hook
        }
        
        # yt-dlp stores info_dict with the video id under key 'id'
        # We need to pass our custom video_id to the hook.
        # A common way is to add it to the ydl_opts or the info_dict if possible.
        # Let's try to pass it via params to the hook if yt_dlp allows or find another way.
        # A simpler way is to bind the video_id to the hook function.
        # Let's redefine the hook to use closure for video_id
        
        # Re-implementing hook to use closure for video_id
        def progress_hook_with_id(d, video_id=video.id):
            logger.debug(f"Progress hook received: {d}") # Log the received dictionary
            if d['status'] == 'downloading':
                 percent_str = d.get('_percent_str', '').strip()
                 if percent_str and percent_str != 'N/A%':
                     try:
                         progress_percent = float(percent_str.replace('%', ''))
                         # Ensure progress doesn't exceed 99.9 to distinguish from finished
                         progress_percent = min(progress_percent, 99.9)
                         db_hook = SessionLocal() # Get a new DB session for the hook
                         try:
                             video_hook = db_hook.query(Video).filter(Video.id == video_id).first()
                             if video_hook:
                                 video_hook.download_progress = progress_percent
                                 db_hook.commit()
                                 logger.info(f"Video {video_id} progress: {progress_percent}%") # Uncommented progress log
                         finally:
                             db_hook.close()
                     except ValueError as e:
                         logger.error(f"Could not parse progress string '{percent_str}': {e}")
                     except Exception as e:
                         logger.error(f"Error updating progress for video {video_id}: {e}")
            elif d['status'] == 'finished':
                 db_hook = SessionLocal() # Get a new DB session for the hook
                 try:
                     video_hook = db_hook.query(Video).filter(Video.id == video_id).first()
                     if video_hook:
                          # Ensure progress is 100 when finished
                         video_hook.download_progress = 100.0
                         db_hook.commit()
                         # logger.debug(f"Video {video_id} progress: 100%")
                 finally:
                     db_hook.close()

        ydl_opts['progress_hooks'] = [lambda d: progress_hook_with_id(d, video_id=video.id)] # Bind video.id to the hook

        logger.info(f"Starting download for URL: {video.url}")
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(video.url, download=True)
            logger.info(f"Download completed for video {video_id}")
            
            # Store original title and other metadata in the database
            # These might be updated by the hook, but let's ensure they are set here too
            video.title = info.get('title')
            video.thumbnail_url = info.get('thumbnail')
            
            # Use video ID as the filename
            # Ensure file_path is set correctly
            video.file_path = ydl.prepare_filename(info)
            # Correct file_path format if necessary (yt-dlp gives full path)
            if video.file_path and os.path.isabs(video.file_path):
                 video.file_path = os.path.relpath(video.file_path, os.getcwd())

            # Verify the file exists and get its size
            if not os.path.exists(video.file_path):
                logger.error(f"File not found at {video.file_path}")
                raise FileNotFoundError(f"File not found at {video.file_path}")
            
            video.file_size = os.path.getsize(video.file_path)
            video.status = VideoStatus.DOWNLOADED
            # progress should be 100 at this point, ensured by hook
            db.commit()
            logger.info(f"Video {video_id} marked as DOWNLOADED")
            
    except Exception as e:
        logger.error(f"Error downloading video {video_id}: {str(e)}")
        video.status = VideoStatus.FAILED
        video.error_message = str(e)
        # Set progress to 0 or some error indicator if failed
        video.download_progress = 0.0
        db.commit()
        # No need to raise again, error is logged and status is set
    finally:
        # Ensure the main session is closed
        db.close()

print("[tasks.py] Huey is ready.")
