from pydantic import BaseModel
from typing import Optional
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

    class Config:
        from_attributes = True

class VideoQuery(BaseModel):
    status: Optional[VideoStatus] = None
    search: Optional[str] = None 