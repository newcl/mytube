"""Add download_info JSON column

Revision ID: add_download_info_json
Revises: fix_timestamps
Create Date: 2024-03-19 10:30:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSON

# revision identifiers, used by Alembic.
revision = 'add_download_info_json'
down_revision = 'fix_timestamps'
branch_labels = None
depends_on = None

def upgrade() -> None:
    # Add new JSON column
    op.add_column('videos', sa.Column('download_info', JSON, nullable=True, server_default='{}'))

def downgrade() -> None:
    # Drop JSON column
    op.drop_column('videos', 'download_info') 