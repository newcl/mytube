from sqlalchemy import Column, Integer, String, DateTime, Enum, Float
from sqlalchemy.sql import func
from database import Base
import enum
from datetime import datetime

class VideoStatus(enum.Enum):
    PENDING = "PENDING"
    DOWNLOADING = "DOWNLOADING"
    DOWNLOADED = "DOWNLOADED"
    FAILED = "FAILED"

class Video(Base):
    __tablename__ = "videos"

    id = Column(Integer, primary_key=True, index=True)
    url = Column(String, unique=True, index=True)
    title = Column(String, nullable=True)
    thumbnail_url = Column(String, nullable=True)
    file_path = Column(String, nullable=True)
    file_size = Column(Integer, nullable=True)
    status = Column(Enum(VideoStatus), default=VideoStatus.PENDING)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    error_message = Column(String, nullable=True)
    download_progress = Column(Float, nullable=True, default=0.0)

    def __repr__(self):
        return f"<Video(id={self.id}, title={self.title})>" 