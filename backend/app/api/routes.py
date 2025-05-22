from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse, FileResponse
from app.services.youtube import get_stream_url
from urllib.parse import unquote
import subprocess
import logging
import tempfile
import os
import yt_dlp


logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

router = APIRouter()

@router.get("/favicon.ico")
async def favicon():
    return ""

import uuid
from pathlib import Path

TMP_DIR = "/tmp/yt-downloads"
os.makedirs(TMP_DIR, exist_ok=True)

@router.get("/{full_path:path}")
async def stream_path(full_path: str):
    video_url = unquote(full_path)
    logger.info(f"Downloading video from URL: {video_url}")

    safe_id = str(uuid.uuid4())
    temp_file_path_template = os.path.join(TMP_DIR, f"{safe_id}.%(ext)s")

    ydl_opts = {
        # "format": "best[ext=mp4]/best",
        # 'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        'merge_output_format': 'mp4',

        "outtmpl": temp_file_path_template,
        "quiet": True,
        "no_warnings": True,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([video_url])
    except Exception as e:
        logger.error(f"yt-dlp download failed: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to download video: {str(e)}")

    downloaded_files = list(Path(TMP_DIR).glob(f"{safe_id}.*"))
    if not downloaded_files or os.path.getsize(downloaded_files[0]) == 0:
        raise HTTPException(status_code=500, detail="Download failed or file is empty")

    final_file_path = str(downloaded_files[0])
    logger.info(f"Download complete, serving file: {final_file_path}")
    return FileResponse(final_file_path, media_type="video/mp4", filename="video.mp4")