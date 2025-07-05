from sqlalchemy import Column, Integer, String, DateTime, Enum, Float, JSON, ForeignKey, Table
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from database import Base
import enum
from datetime import datetime

class VideoStatus(enum.Enum):
    PENDING = "PENDING"
    DOWNLOADING = "DOWNLOADING"
    DOWNLOADED = "DOWNLOADED"
    FAILED = "FAILED"

# Association table for many-to-many relationship between Playlist and Video
playlist_videos = Table(
    'playlist_videos',
    Base.metadata,
    Column('playlist_id', Integer, ForeignKey('playlists.id'), primary_key=True),
    Column('video_id', Integer, ForeignKey('videos.id'), primary_key=True),
    Column('added_at', DateTime(timezone=True), server_default=func.now(), nullable=False)
)

class Playlist(Base):
    __tablename__ = "playlists"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    
    # Relationship with videos
    videos = relationship("Video", secondary=playlist_videos, back_populates="playlists")

    def __repr__(self):
        return f"<Playlist(id={self.id}, name={self.name})>"

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
    download_info = Column(JSON, nullable=True, default=dict)
    
    # Relationship with playlists
    playlists = relationship("Playlist", secondary=playlist_videos, back_populates="videos")

    def __repr__(self):
        return f"<Video(id={self.id}, title={self.title})>" 