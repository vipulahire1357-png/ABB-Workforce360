"""Visitor Registration API — registration, listing, photo, and ID-card PDF."""

from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, Query
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from backend.auth import require_role
from backend.config import settings
from backend.db import get_db
from backend.models import Admin, Visitor
from backend.services.visitors import register_visitor, expire_stale_visitors, serialize_visitor
from backend.services.photos import validate_photo
from backend.services.visitor_cards import visitor_card_pdf, CardAssetError

router = APIRouter(prefix="/api/visitors", tags=["Visitor Registration"])


@router.post("", status_code=201)
async def register(
    name: str = Form(...), company_name: str = Form(...), location: str = Form(...),
    host: str = Form(...), purpose: str = Form(...), contact_no: str = Form(...),
    aadhaar_no: str = Form(...), photo: UploadFile | None = File(None),
    db: Session = Depends(get_db),
    admin: Admin = Depends(require_role("GATE", "ADMIN")),
):
    """Register a new visitor."""
    import re
    from backend.schemas import VisitorCreate

    try:
        values = VisitorCreate(
            name=name, company_name=company_name, location=location,
            host=host, purpose=purpose, contact_no=contact_no, aadhaar_no=aadhaar_no,
        )
    except (ValueError, TypeError) as e:
        raise HTTPException(422, "Invalid visitor details") from e

    if not settings.aadhaar_encryption_key:
        raise HTTPException(503, "Aadhaar encryption is not configured")

    # Validate and save optional photo
    photo_data = None
    if photo and photo.filename:
        photo_data = await validate_photo(photo)

    saved = None
    try:
        db.rollback()
        with db.begin():
            visitor = register_visitor(
                db,
                name=values.name, company_name=values.company_name,
                location=values.location, host=values.host,
                purpose=values.purpose, contact_no=values.contact_no,
                aadhaar_no=values.aadhaar_no,
                photo_path=None, operator_id=admin.id,
            )
            # Save photo after we have the visitor_id
            if photo_data:
                settings.visitor_upload_dir.mkdir(parents=True, exist_ok=True)
                photo_name = f"{visitor.visitor_id}.jpg"
                saved = settings.visitor_upload_dir / photo_name
                saved.write_bytes(photo_data)
                visitor.photo_path = photo_name
                db.flush()
        db.refresh(visitor)
        return serialize_visitor(visitor)
    except Exception as e:
        db.rollback()
        if saved and saved.exists():
            saved.unlink(missing_ok=True)
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(409, "Registration could not be completed") from None


@router.get("")
def list_visitors(
    page: int = 1,
    page_size: int = 25,
    name: str | None = None,
    status: str | None = None,
    db: Session = Depends(get_db),
    admin: Admin = Depends(require_role("GATE", "ADMIN")),
):
    """List visitors with pagination and filters."""
    if page < 1 or page_size < 1 or page_size > 100:
        raise HTTPException(422, "Invalid pagination")

    # Auto-expire stale visitors on access
    expire_stale_visitors(db)

    stmt = select(Visitor)
    if name:
        stmt = stmt.where(Visitor.name.ilike(f"%{name[:100]}%"))
    if status:
        stmt = stmt.where(Visitor.status == status)

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(
        stmt.order_by(Visitor.id.desc())
        .offset((page - 1) * page_size).limit(page_size)
    ).all()

    active = db.scalar(select(func.count()).select_from(Visitor).where(Visitor.status == "Active")) or 0
    inactive = db.scalar(select(func.count()).select_from(Visitor).where(Visitor.status == "Inactive")) or 0

    return {
        "items": [serialize_visitor(v) for v in rows],
        "page": page, "page_size": page_size, "total": total,
        "active": active, "inactive": inactive,
    }


@router.get("/{visitor_id}")
def detail(visitor_id: str, db: Session = Depends(get_db),
           admin: Admin = Depends(require_role("GATE", "ADMIN"))):
    v = db.scalar(select(Visitor).where(Visitor.visitor_id == visitor_id))
    if not v:
        raise HTTPException(404, "Visitor not found")
    return serialize_visitor(v)


@router.get("/{visitor_id}/photo")
def photo(visitor_id: str, db: Session = Depends(get_db),
          admin: Admin = Depends(require_role("GATE", "ADMIN"))):
    v = db.scalar(select(Visitor).where(Visitor.visitor_id == visitor_id))
    if not v or not v.photo_path:
        raise HTTPException(404, "Photo not found")
    path = settings.visitor_upload_dir / Path(v.photo_path).name
    if not path.is_file():
        raise HTTPException(404, "Photo not found")
    return FileResponse(path, media_type="image/jpeg",
                        headers={"Cache-Control": "private, no-store"})


@router.get("/{visitor_id}/id-card")
def id_card(visitor_id: str, db: Session = Depends(get_db),
            admin: Admin = Depends(require_role("GATE", "ADMIN"))):
    v = db.scalar(select(Visitor).where(Visitor.visitor_id == visitor_id))
    if not v:
        raise HTTPException(404, "Visitor not found")
    try:
        pdf = visitor_card_pdf(v)
    except CardAssetError:
        raise HTTPException(503,
            "ID card cannot be generated because a required asset is missing") from None
    return StreamingResponse(
        iter([pdf]), media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{v.visitor_no}.pdf"',
            "Cache-Control": "private, no-store",
        },
    )
