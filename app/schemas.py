from typing import Optional, List
from pydantic import BaseModel

class HouseCreate(BaseModel):
    name: str

class HouseOut(BaseModel):
    id: int
    name: str

    class Config:
        orm_mode = True

class IngredientCreate(BaseModel):
    name: str
    canonical_unit: Optional[str] = None
    canonical_quantity: Optional[float] = None
    has_any: Optional[bool] = False

class IngredientOut(BaseModel):
    id: int
    name: str
    canonical_unit: Optional[str]
    canonical_quantity: Optional[float]
    has_any: bool

    class Config:
        orm_mode = True


class PriceCreate(BaseModel):
    store_id: int
    price: float
    unit_size: Optional[float] = None
    unit_size_unit: Optional[str] = None
    currency: Optional[str] = "GBP"
    source: Optional[str] = None


class PriceOut(BaseModel):
    id: int
    ingredient_id: int
    store_id: int
    price: float
    unit_size: Optional[float]
    unit_size_unit: Optional[str]
    price_per_canonical: Optional[float]
    currency: Optional[str]

    class Config:
        orm_mode = True


class IngredientUpdate(BaseModel):
    has_any: Optional[bool] = None


class ShoppingListCreate(BaseModel):
    ingredient_id: int
    auto_generated: Optional[bool] = True
    meal_id: Optional[int] = None


class ShoppingListOut(BaseModel):
    id: int
    house_id: int
    ingredient_id: int
    auto_generated: bool
    completed: bool
    meal_id: Optional[int] = None

    class Config:
        orm_mode = True


class MealPlan(BaseModel):
    planned_date: Optional[str] = None  # YYYY-MM-DD or null to clear


class StoreCreate(BaseModel):
    name: str


class StoreOut(BaseModel):
    id: int
    house_id: int
    name: str

    class Config:
        orm_mode = True


