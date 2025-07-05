"""initial schema

Revision ID: 001
Revises: 
Create Date: 2024-01-01 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create videos table
    op.create_table('videos',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('url', sa.String(), nullable=False),
        sa.Column('title', sa.String(), nullable=True),
        sa.Column('thumbnail_url', sa.String(), nullable=True),
        sa.Column('file_path', sa.String(), nullable=True),
        sa.Column('file_size', sa.Integer(), nullable=True),
        sa.Column('status', sa.Enum('PENDING', 'DOWNLOADING', 'DOWNLOADED', 'FAILED', name='videostatus'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('error_message', sa.String(), nullable=True),
        sa.Column('download_info', postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_videos_id'), 'videos', ['id'], unique=False)
    op.create_index(op.f('ix_videos_url'), 'videos', ['url'], unique=True)

    # Create playlists table
    op.create_table('playlists',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('description', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_playlists_id'), 'playlists', ['id'], unique=False)

    # Create playlist_videos junction table
    op.create_table('playlist_videos',
        sa.Column('playlist_id', sa.Integer(), nullable=False),
        sa.Column('video_id', sa.Integer(), nullable=False),
        sa.Column('added_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['playlist_id'], ['playlists.id'], ),
        sa.ForeignKeyConstraint(['video_id'], ['videos.id'], ),
        sa.PrimaryKeyConstraint('playlist_id', 'video_id')
    )


def downgrade() -> None:
    op.drop_table('playlist_videos')
    op.drop_index(op.f('ix_playlists_id'), table_name='playlists')
    op.drop_table('playlists')
    op.drop_index(op.f('ix_videos_url'), table_name='videos')
    op.drop_index(op.f('ix_videos_id'), table_name='videos')
    op.drop_table('videos') 