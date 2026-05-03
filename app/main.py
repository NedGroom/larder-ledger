import os
import uuid
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session
from pydantic import BaseModel

from . import db, models, schemas
from .ws import manager
from .ocr import parse_image_for_text, TESSERACT_AVAILABLE
from sqlalchemy.exc import IntegrityError

app = FastAPI(title="LarderLedger API")

# initialize DB (create tables) when running with sqlite for quick dev
if os.getenv("DATABASE_URL", "").startswith("sqlite") or os.getenv("DATABASE_URL", "") == "":
    db.init_db()


# dependency
def get_db():
    db_session = db.SessionLocal()
    try:
        yield db_session
    finally:
        db_session.close()


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


@app.post("/houses", response_model=schemas.HouseOut)
def create_house(h: schemas.HouseCreate, session: Session = Depends(get_db)):
    house = models.House(name=h.name)
    session.add(house)
    session.commit()
    session.refresh(house)
    return house


@app.get("/houses/{house_id}/ingredients", response_model=list[schemas.IngredientOut])
def list_ingredients(house_id: int, session: Session = Depends(get_db)):
    items = session.query(models.Ingredient).filter(models.Ingredient.house_id == house_id).all()
    return items


@app.post("/houses/{house_id}/ingredients", response_model=schemas.IngredientOut)
def create_ingredient(house_id: int, payload: schemas.IngredientCreate, session: Session = Depends(get_db)):
    # Basic create; in prod validate duplicates and user permissions
    normalized = payload.name.strip().lower()
    ingredient = models.Ingredient(
        house_id=house_id,
        name=payload.name.strip(),
        name_normalized=normalized,
        canonical_unit=payload.canonical_unit,
        has_any=payload.has_any or False,
    )
    session.add(ingredient)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=400, detail="Ingredient with this name already exists in the house")
    session.refresh(ingredient)
    return ingredient


@app.post("/houses/{house_id}/receipts")
async def upload_receipt(house_id: int, file: UploadFile = File(...)):
    """Accept a receipt image upload, save locally (or to S3 in prod), and run Tesseract if available.

    Returns parsed text (if OCR available) and saved filename.
    """
    uploads_dir = os.getenv("UPLOADS_DIR", "./uploads")
    os.makedirs(uploads_dir, exist_ok=True)
    filename = f"{house_id}_{uuid.uuid4().hex}_{file.filename}"
    dest_path = os.path.join(uploads_dir, filename)

    # save file
    with open(dest_path, "wb") as out:
        content = await file.read()
        out.write(content)

    parsed = None
    if TESSERACT_AVAILABLE:
        parsed = parse_image_for_text(dest_path)

    # In a real app: create Receipt DB row and upload to S3; here we return a lightweight response
    return {"filename": filename, "parsed_text": parsed}


@app.websocket("/ws/houses/{house_id}")
async def websocket_endpoint(websocket: WebSocket, house_id: int):
    """Simple WebSocket endpoint for house-level realtime updates.

    Clients should send/receive JSON messages. Server broadcasts messages to all connected clients in the same house.
    """
    await manager.connect(house_id, websocket)
    try:
        while True:
            data = await websocket.receive_json()
            # echo to all clients in house; in production validate and translate to domain events
            await manager.broadcast(house_id, data)
    except WebSocketDisconnect:
        manager.disconnect(house_id, websocket)



@app.post("/ingredients/{ingredient_id}/prices", response_model=schemas.PriceOut)
def create_ingredient_price(ingredient_id: int, payload: schemas.PriceCreate, session: Session = Depends(get_db)):
    # basic validation
    ingredient = session.query(models.Ingredient).get(ingredient_id)
    if not ingredient:
        raise HTTPException(status_code=404, detail="Ingredient not found")
    store = session.query(models.Store).get(payload.store_id)
    if not store:
        raise HTTPException(status_code=404, detail="Store not found")

    # compute normalized price per base unit at entry time if unit_size provided
    price_per_base_unit = None
    if payload.unit_size and payload.unit_size > 0:
        try:
            price_per_base_unit = float(payload.price) / float(payload.unit_size)
        except Exception:
            price_per_base_unit = None

    price = models.IngredientPrice(
        ingredient_id=ingredient_id,
        store_id=payload.store_id,
        price=payload.price,
        price_unit=payload.price_unit,
        unit_size=payload.unit_size,
        unit_size_unit=payload.unit_size_unit,
        price_per_base_unit=price_per_base_unit,
        currency=payload.currency,
        source=payload.source,
    )
    session.add(price)
    session.commit()
    session.refresh(price)

    # broadcast a minimal event to house WebSocket clients
    try:
        session_house_id = ingredient.house_id
        import asyncio

        asyncio.create_task(manager.broadcast(session_house_id, {"type": "price.created", "ingredient_id": ingredient_id, "price_id": price.id}))
    except Exception:
        pass

    return price


@app.post("/houses/{house_id}/stores", response_model=schemas.StoreOut)
def create_store(house_id: int, payload: schemas.StoreCreate, session: Session = Depends(get_db)):
    # basic create store for house
    store = models.Store(house_id=house_id, name=payload.name)
    session.add(store)
    session.commit()
    session.refresh(store)
    return store


@app.get("/houses/{house_id}/stores", response_model=list[schemas.StoreOut])
def list_stores(house_id: int, session: Session = Depends(get_db)):
    stores = session.query(models.Store).filter(models.Store.house_id == house_id).all()
    return stores



@app.patch("/ingredients/{ingredient_id}", response_model=schemas.IngredientOut)
def update_ingredient(ingredient_id: int, payload: schemas.IngredientUpdate, session: Session = Depends(get_db)):
    ingredient = session.query(models.Ingredient).get(ingredient_id)
    if not ingredient:
        raise HTTPException(status_code=404, detail="Ingredient not found")
    changed = {}
    if payload.has_any is not None and payload.has_any != ingredient.has_any:
        ingredient.has_any = payload.has_any
        changed['has_any'] = ingredient.has_any
    if payload.quantity_value is not None:
        ingredient.quantity_value = payload.quantity_value
        changed['quantity_value'] = float(payload.quantity_value)
    if payload.quantity_unit is not None:
        ingredient.quantity_unit = payload.quantity_unit
        changed['quantity_unit'] = payload.quantity_unit

    session.add(ingredient)
    session.commit()
    session.refresh(ingredient)

    # broadcast change
    try:
        import asyncio
        asyncio.create_task(manager.broadcast(ingredient.house_id, {"type": "ingredient.updated", "ingredient_id": ingredient.id, "changes": changed}))
    except Exception:
        pass

    return ingredient


@app.post("/houses/{house_id}/shopping-list", response_model=schemas.ShoppingListOut)
def add_shopping_list_item(house_id: int, payload: schemas.ShoppingListCreate, session: Session = Depends(get_db)):
    # validate ingredient belongs to house
    ingredient = session.query(models.Ingredient).get(payload.ingredient_id)
    if not ingredient or ingredient.house_id != house_id:
        raise HTTPException(status_code=400, detail="Ingredient does not belong to house")
    item = models.ShoppingListItem(house_id=house_id, ingredient_id=payload.ingredient_id, auto_generated=payload.auto_generated)
    session.add(item)
    session.commit()
    session.refresh(item)

    # broadcast
    try:
        import asyncio
        asyncio.create_task(manager.broadcast(house_id, {"type": "shopping_list.created", "item_id": item.id, "ingredient_id": item.ingredient_id}))
    except Exception:
        pass

    return item


@app.patch("/shopping-list/{item_id}", response_model=schemas.ShoppingListOut)
def update_shopping_list_item(item_id: int, session: Session = Depends(get_db)):
    item = session.query(models.ShoppingListItem).get(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Shopping list item not found")
    # toggle completed
    item.completed = not bool(item.completed)
    session.add(item)
    session.commit()
    session.refresh(item)

    try:
        import asyncio
        asyncio.create_task(manager.broadcast(item.house_id, {"type": "shopping_list.updated", "item_id": item.id, "completed": item.completed}))
    except Exception:
        pass

    return item



