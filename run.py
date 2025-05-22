import logging
import tempfile
import os
import yt_dlp


logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

router = APIRouter()

import uuid
from pathlib import Path

TMP_DIR = "/tmp/yt-downloads"
os.makedirs(TMP_DIR, exist_ok=True)

safe_id = str(uuid.uuid4())
temp_file_path_template = os.path.join(TMP_DIR, f"{safe_id}.%(ext)s")

video_url = "https://www.youtube.com/watch?v=SguCVRVWzTc"

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