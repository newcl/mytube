"""Fix timestamp columns

Revision ID: fix_timestamps
Revises: 7b085ddb9d29
Create Date: 2024-03-19 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import func

# revision identifiers, used by Alembic.
revision = 'fix_timestamps'
down_revision = '7b085ddb9d29'
branch_labels = None
depends_on = None

def upgrade() -> None:
    # Drop existing columns
    op.drop_column('videos', 'created_at')
    op.drop_column('videos', 'updated_at')
    
    # Recreate columns with proper defaults and timezone support
    op.add_column('videos', sa.Column('created_at', sa.DateTime(timezone=True), server_default=func.now(), nullable=False))
    op.add_column('videos', sa.Column('updated_at', sa.DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False))

def downgrade() -> None:
    # Drop the fixed columns
    op.drop_column('videos', 'created_at')
    op.drop_column('videos', 'updated_at')
    
    # Recreate original columns
    op.add_column('videos', sa.Column('created_at', sa.DateTime(), nullable=True))
    op.add_column('videos', sa.Column('updated_at', sa.DateTime(), nullable=True)) 