"""add ingredient name_normalized and unique constraint

Revision ID: 0003_ingredient_name_normalized_unique
Revises: 0002_add_price_normalization
Create Date: 2026-05-02 00:10:00.000000
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '0003_ingredient_name_normalized_unique'
down_revision = '0002_add_price_normalization'
branch_labels = None
depends_on = None


def upgrade():
    # add column
    op.add_column('ingredients', sa.Column('name_normalized', sa.String(length=255), nullable=True))

    # populate normalized values for existing rows (sqlite-compatible)
    conn = op.get_bind()
    ingredients = conn.execute(sa.text("SELECT id, name FROM ingredients")).fetchall()
    for row in ingredients:
        nid = row[0]
        name = row[1] or ''
        normalized = name.strip().lower()
        conn.execute(sa.text("UPDATE ingredients SET name_normalized = :norm WHERE id = :id"), {'norm': normalized, 'id': nid})

    # make column non-nullable
    op.alter_column('ingredients', 'name_normalized', existing_type=sa.String(length=255), nullable=False)

    # create unique index on (house_id, name_normalized)
    op.create_index('ix_ingredients_house_name_normalized', 'ingredients', ['house_id', 'name_normalized'], unique=True)


def downgrade():
    op.drop_index('ix_ingredients_house_name_normalized', table_name='ingredients')
    op.drop_column('ingredients', 'name_normalized')

