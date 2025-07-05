from huey_config import huey
from database import get_db, SessionLocal
from models import Video, VideoStatus
import yt_dlp
import os
import logging
import re
import time
from minio import Minio
from minio.error import S3Error

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

APP_ENV = os.getenv('APP_ENV', 'development')

MINIO_ENDPOINT = os.getenv('MINIO_ENDPOINT')
MINIO_ACCESS_KEY = os.getenv('MINIO_ACCESS_KEY')
MINIO_SECRET_KEY = os.getenv('MINIO_SECRET_KEY')
MINIO_BUCKET = 'mytube'
MINIO_PUBLIC_URL = os.getenv('MINIO_PUBLIC_URL', MINIO_ENDPOINT)

protocol = "https" if APP_ENV != 'development' else "http"

logger.info(f"MINIO_ENDPOINT: {MINIO_ENDPOINT}")
logger.info(f"MINIO_ACCESS_KEY: {MINIO_ACCESS_KEY}")
logger.info(f"MINIO_SECRET_KEY: {MINIO_SECRET_KEY}")
logger.info(f"MINIO_BUCKET: {MINIO_BUCKET}")

# MinIO client for internal operations (upload, download, etc.)
minio_client = Minio(
    MINIO_ENDPOINT,
    access_key=MINIO_ACCESS_KEY,
    secret_key=MINIO_SECRET_KEY,
    secure=False if os.getenv('APP_ENV') == 'development' else True
)

# Public MinIO client for generating presigned URLs accessible from browser
public_minio_client = Minio(
    MINIO_PUBLIC_URL,
    access_key=MINIO_ACCESS_KEY,
    secret_key=MINIO_SECRET_KEY,
    secure=False if os.getenv('APP_ENV') == 'development' else True
)

def sanitize_filename(filename: str) -> str:
    # Replace spaces and special characters with underscores
    sanitized = re.sub(r'[^\w\-\.]', '_', filename)
    # Remove multiple consecutive underscores
    sanitized = re.sub(r'_+', '_', sanitized)
    return sanitized

def upload_to_minio(local_path: str, minio_path: str, content_type: str = 'application/octet-stream'):
    try:
        minio_client.fput_object(
            MINIO_BUCKET,
            minio_path,
            local_path,
            content_type=content_type
        )
        logger.info(f"Uploaded {local_path} to MinIO at {minio_path}")
        return True
    except S3Error as e:
        logger.error(f"Failed to upload {local_path} to MinIO: {e}")
        return False

@huey.task()
def download_video_task(video_id: int):
    logger.info(f"Starting download task for video_id: {video_id}")
    db = next(get_db())
    video = db.query(Video).filter(Video.id == video_id).first()
    if not video:
        logger.error(f"Video with id {video_id} not found")
        db.close()
        return
    
    # Use /tmp/mytube/{video_id}/ as temp dir (emptyDir mount in k8s)
    temp_dir = os.path.join('/tmp', 'mytube', str(video_id))
    os.makedirs(temp_dir, exist_ok=True)
    
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
                best_thumbnail = None
                if thumbnails:
                    best_thumbnail = max(thumbnails, key=lambda x: x.get('width', 0) * x.get('height', 0))
                    video.thumbnail_url = ''  # Will update after upload
                db.commit()
                db.refresh(video)
                logger.info(f"Fetched metadata for video {video_id}: {video.title}")
            except Exception as e:
                logger.error(f"Error fetching video metadata: {e}")
        
        # Start the download with progress hooks
        video_filename = os.path.join(temp_dir, 'video.%(ext)s')
        ydl_opts = {
            'format': 'best',
            'outtmpl': video_filename,
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
            # logger.info(f"Extracted info: {info}")
            video.title = info.get('title')
            # Get the downloaded file path
            downloaded_file = ydl.prepare_filename(info)
            # Upload video to MinIO
            minio_video_path = f"{video_id}/video.mp4"
            upload_success = upload_to_minio(downloaded_file, minio_video_path, content_type='video/mp4')
            if not upload_success:
                raise Exception('Failed to upload video to MinIO')
            video.file_path = f"{protocol}://{MINIO_PUBLIC_URL}/mytube/{minio_video_path}"
            video.file_size = os.path.getsize(downloaded_file)
            # Download and upload best thumbnail
            if best_thumbnail and best_thumbnail.get('url'):
                import requests
                thumb_url = best_thumbnail['url']
                thumb_ext = os.path.splitext(thumb_url)[-1] or '.jpg'
                thumb_path = os.path.join(temp_dir, f'thumbnail{thumb_ext}')
                try:
                    r = requests.get(thumb_url, timeout=10)
                    r.raise_for_status()
                    with open(thumb_path, 'wb') as f:
                        f.write(r.content)
                    minio_thumb_path = f"{video_id}/thumbnail{thumb_ext}"
                    thumb_upload_success = upload_to_minio(thumb_path, minio_thumb_path, content_type='image/jpeg')
                    if thumb_upload_success:
                        video.thumbnail_url = f"{protocol}://{MINIO_PUBLIC_URL}/mytube/{minio_thumb_path}"
                        logger.info(f"Uploaded thumbnail to MinIO at {minio_thumb_path}")
                    else:
                        logger.error(f"Failed to upload thumbnail to MinIO for video {video_id}")
                        video.thumbnail_url = ''
                except Exception as e:
                    logger.error(f"Failed to download/upload thumbnail: {e}")
                    video.thumbnail_url = ''
            else:
                video.thumbnail_url = ''
            # Only mark as DOWNLOADED after all uploads are done
            video.status = VideoStatus.DOWNLOADED
            db.commit()
            logger.info(f"Video {video_id} marked as DOWNLOADED")
            # Clean up temp files
            try:
                import shutil
                shutil.rmtree(temp_dir)
            except Exception as e:
                logger.warning(f"Failed to clean up temp dir {temp_dir}: {e}")
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
        # Clean up temp files on failure
        try:
            import shutil
            shutil.rmtree(temp_dir)
        except Exception as e:
            logger.warning(f"Failed to clean up temp dir {temp_dir}: {e}")
    finally:
        db.close()

print("[tasks.py] Huey is ready.")
