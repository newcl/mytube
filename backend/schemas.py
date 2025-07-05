from pydantic import BaseModel
from typing import Optional, Dict, Any, List
from datetime import datetime
from models import VideoStatus

class VideoBase(BaseModel):
    url: str

class VideoCreate(VideoBase):
    pass

class VideoUpdateStatus(BaseModel):
    status: VideoStatus
    error_message: Optional[str] = None

class VideoOut(VideoBase):
    id: int
    title: Optional[str] = None
    thumbnail_url: Optional[str] = None
    file_path: Optional[str] = None
    file_size: Optional[int] = None
    status: VideoStatus
    created_at: datetime
    updated_at: datetime
    error_message: Optional[str] = None
    download_info: Optional[Dict[str, Any]] = None

    class Config:
        from_attributes = True

class VideoQuery(BaseModel):
    status: Optional[VideoStatus] = None
    search: Optional[str] = None

class PlaylistBase(BaseModel):
    name: str
    description: Optional[str] = None

class PlaylistCreate(PlaylistBase):
    pass

class PlaylistUpdate(PlaylistBase):
    pass

class PlaylistOut(PlaylistBase):
    id: int
    created_at: datetime
    updated_at: datetime
    video_count: int = 0

    class Config:
        from_attributes = True

class PlaylistWithVideos(PlaylistOut):
    videos: List[VideoOut] = []

    class Config:
        from_attributes = True

class AddVideoToPlaylist(BaseModel):
    playlist_id: int 