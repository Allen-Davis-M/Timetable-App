from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.school import Room
from app.schemas.room import RoomCreate, RoomOut, RoomUpdate

router = APIRouter(prefix="/api/rooms", tags=["rooms"])


@router.post("", response_model=RoomOut, status_code=201)
def create_room(payload: RoomCreate, db: Session = Depends(get_db)):
    room = Room(**payload.model_dump())
    db.add(room)
    db.commit()
    db.refresh(room)
    return room


@router.get("", response_model=list[RoomOut])
def list_rooms(school_id: int | None = None, db: Session = Depends(get_db)):
    query = db.query(Room)
    if school_id is not None:
        query = query.filter(Room.school_id == school_id)
    return query.all()


@router.get("/{room_id}", response_model=RoomOut)
def get_room(room_id: int, db: Session = Depends(get_db)):
    room = db.get(Room, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    return room


@router.put("/{room_id}", response_model=RoomOut)
def update_room(room_id: int, payload: RoomUpdate, db: Session = Depends(get_db)):
    room = db.get(Room, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(room, field, value)
    db.commit()
    db.refresh(room)
    return room


@router.delete("/{room_id}", status_code=204)
def delete_room(room_id: int, db: Session = Depends(get_db)):
    room = db.get(Room, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    db.delete(room)
    db.commit()
