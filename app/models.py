from datetime import datetime
from sqlalchemy import (
    Column,
    Integer,
    String,
    Boolean,
    DateTime,
    Numeric,
    ForeignKey,
    JSON,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from .db import Base


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    email = Column(String(255), unique=True, nullable=False)
    name = Column(String(255))
    hashed_password = Column(String(512))
    created_at = Column(DateTime, default=datetime.utcnow)


class House(Base):
    __tablename__ = "houses"
    id = Column(Integer, primary_key=True)
    name = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    users = relationship("HouseUser", back_populates="house")


class HouseUser(Base):
    __tablename__ = "house_users"
    house_id = Column(Integer, ForeignKey("houses.id"), primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), primary_key=True)
    role = Column(String(50), default="member")

    house = relationship("House", back_populates="users")


class Ingredient(Base):
    __tablename__ = "ingredients"
    # enforce per-house case-insensitive uniqueness via a normalized column (name_normalized)
    __table_args__ = (
        UniqueConstraint('house_id', 'name_normalized', name='uq_ingredient_house_name_normalized'),
    )
    id = Column(Integer, primary_key=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False)
    name = Column(String(255), nullable=False)
    # lowercased, trimmed name for uniqueness checks
    name_normalized = Column(String(255), nullable=False)
    canonical_unit = Column(String(64), nullable=True)
    canonical_quantity = Column(Numeric, nullable=True)  # e.g. 100 (for "per 100g")
    has_any = Column(Boolean, default=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    # relationships
    prices = relationship("IngredientPrice", back_populates="ingredient", cascade="all, delete-orphan")


class Meal(Base):
    __tablename__ = "meals"
    id = Column(Integer, primary_key=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False)
    name = Column(String(255), nullable=False)
    dish_type = Column(String(128), nullable=True)
    prep_time_min = Column(Integer, nullable=True)
    servings = Column(Integer, nullable=True)
    price_per_portion = Column(Numeric, nullable=True)
    chef_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    planned_date = Column(String(10), nullable=True)  # ISO date string YYYY-MM-DD
    created_at = Column(DateTime, default=datetime.utcnow)
    ingredients = relationship("MealIngredient", back_populates="meal", cascade="all, delete-orphan")


class MealIngredient(Base):
    __tablename__ = "meal_ingredients"
    id = Column(Integer, primary_key=True)
    meal_id = Column(Integer, ForeignKey("meals.id"), nullable=False)
    ingredient_id = Column(Integer, ForeignKey("ingredients.id"), nullable=False)
    required_quantity = Column(Numeric, nullable=True)
    required_unit = Column(String(64), nullable=True)
    # relationships
    meal = relationship("Meal", back_populates="ingredients")
    ingredient = relationship("Ingredient")


class Store(Base):
    __tablename__ = "stores"
    id = Column(Integer, primary_key=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False)
    name = Column(String(255), nullable=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    prices = relationship("IngredientPrice", back_populates="store", cascade="all, delete-orphan")


class IngredientPrice(Base):
    __tablename__ = "ingredient_prices"
    id = Column(Integer, primary_key=True)
    ingredient_id = Column(Integer, ForeignKey("ingredients.id"), nullable=False)
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=False)
    price = Column(Numeric, nullable=False)
    # package size (e.g. unit_size=500, unit_size_unit='g')
    unit_size = Column(Numeric, nullable=True)
    unit_size_unit = Column(String(32), nullable=True)
    # price per canonical_quantity of canonical_unit, computed on write
    price_per_canonical = Column(Numeric, nullable=True)
    currency = Column(String(8), default="GBP")
    source = Column(String(64), nullable=True)
    noted_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    # relationships
    ingredient = relationship("Ingredient", back_populates="prices")
    store = relationship("Store", back_populates="prices")


class ShoppingListItem(Base):
    __tablename__ = "shopping_list_items"
    id = Column(Integer, primary_key=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False)
    ingredient_id = Column(Integer, ForeignKey("ingredients.id"), nullable=False)
    added_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    auto_generated = Column(Boolean, default=True)
    completed = Column(Boolean, default=False)
    meal_id = Column(Integer, ForeignKey("meals.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Receipt(Base):
    __tablename__ = "receipts"
    id = Column(Integer, primary_key=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False)
    uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    s3_key = Column(String(1024), nullable=True)
    raw_text = Column(Text, nullable=True)
    parsed = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

