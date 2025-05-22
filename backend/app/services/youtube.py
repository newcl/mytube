import yt_dlp
from fastapi import HTTPException


def get_stream_url(video_url: str) -> str:
    ydl_opts = {
        'quiet': True,
        'format': 'best[ext=mp4]/best',
        'noplaylist': True,
        'outtmpl': '-',
        'retries': 10,  # retry more times
        'sleep_interval': 5,  # sleep on throttling
        'sleep_interval_requests': 3,
    }
    ydl = yt_dlp.YoutubeDL(ydl_opts)
    try:
        info = ydl.extract_info(video_url, download=False)
        return info['url']
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
