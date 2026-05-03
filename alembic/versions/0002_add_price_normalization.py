"""add price normalization fields

Revision ID: 0002_add_price_normalization
Revises:
Create Date: 2026-05-02 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '0002_add_price_normalization'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    # add columns to ingredient_prices
    op.add_column('ingredient_prices', sa.Column('price_unit', sa.String(length=64), nullable=True))
    op.add_column('ingredient_prices', sa.Column('unit_size', sa.Numeric(), nullable=True))
    op.add_column('ingredient_prices', sa.Column('unit_size_unit', sa.String(length=32), nullable=True))
    op.add_column('ingredient_prices', sa.Column('price_per_base_unit', sa.Numeric(), nullable=True))
    op.add_column('ingredient_prices', sa.Column('currency', sa.String(length=8), nullable=True))


def downgrade():
    op.drop_column('ingredient_prices', 'currency')
    op.drop_column('ingredient_prices', 'price_per_base_unit')
    op.drop_column('ingredient_prices', 'unit_size_unit')
    op.drop_column('ingredient_prices', 'unit_size')
    op.drop_column('ingredient_prices', 'price_unit')

