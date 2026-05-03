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
    has_any: Optional[bool] = False

class IngredientOut(BaseModel):
    id: int
    name: str
    canonical_unit: Optional[str]
    has_any: bool

    class Config:
        orm_mode = True


class PriceCreate(BaseModel):
    store_id: int
    price: float
    price_unit: Optional[str] = None
    unit_size: Optional[float] = None
    unit_size_unit: Optional[str] = None
    currency: Optional[str] = "GBP"
    source: Optional[str] = None


class PriceOut(BaseModel):
    id: int
    ingredient_id: int
    store_id: int
    price: float
    price_unit: Optional[str]
    unit_size: Optional[float]
    unit_size_unit: Optional[str]
    price_per_base_unit: Optional[float]
    currency: Optional[str]

    class Config:
        orm_mode = True


class IngredientUpdate(BaseModel):
    has_any: Optional[bool] = None
    quantity_value: Optional[float] = None
    quantity_unit: Optional[str] = None


class ShoppingListCreate(BaseModel):
    ingredient_id: int
    auto_generated: Optional[bool] = True


class ShoppingListOut(BaseModel):
    id: int
    house_id: int
    ingredient_id: int
    auto_generated: bool
    completed: bool

    class Config:
        orm_mode = True


class StoreCreate(BaseModel):
    name: str


class StoreOut(BaseModel):
    id: int
    house_id: int
    name: str

    class Config:
        orm_mode = True


