"""Canteen Scan Management API — scan processing, transaction history, reports."""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from backend.auth import require_role
from backend.db import get_db
from backend.models import Admin, CanteenTransaction, GateTransaction
from backend.services import canteen as canteen_svc

router = APIRouter(prefix="/api/canteen", tags=["Canteen Scan Management"])


class ScanInput(BaseModel):
    barcode: str = Field(min_length=1, max_length=120)


@router.post("/scan")
def scan(body: ScanInput, db: Session = Depends(get_db),
         admin: Admin = Depends(require_role("CANTEEN", "ADMIN"))):
    """Process a canteen barcode scan."""
    db.rollback()
    with db.begin():
        result = canteen_svc.process_scan(db, body.barcode, admin.id)
    return {
        "accepted": result.accepted,
        "reason": result.reason,
        "person": result.person,
        "gate_entry_time": result.gate_entry_time,
        "transaction_id": result.transaction_id,
    }


@router.get("/transactions")
def transactions(
    page: int = 1,
    page_size: int = 25,
    business_date: date | None = None,
    worker_id: str | None = None,
    result_filter: str | None = Query(None, alias="result"),
    db: Session = Depends(get_db),
    admin: Admin = Depends(require_role("CANTEEN", "ADMIN")),
):
    """List canteen transactions with pagination and filters."""
    if page < 1 or page_size < 1 or page_size > 100:
        raise HTTPException(422, "Invalid pagination")

    stmt = select(CanteenTransaction)
    if business_date:
        stmt = stmt.where(CanteenTransaction.business_date == business_date)
    if worker_id:
        stmt = stmt.where(CanteenTransaction.worker_id == worker_id)
    if result_filter:
        stmt = stmt.where(CanteenTransaction.scan_result == result_filter.upper())

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(
        stmt.order_by(CanteenTransaction.scan_timestamp.desc())
        .offset((page - 1) * page_size).limit(page_size)
    ).all()

    return {
        "items": [_serialize_txn(t) for t in rows],
        "page": page, "page_size": page_size, "total": total,
    }


@router.get("/report")
def daily_report(
    report_date: date | None = None,
    db: Session = Depends(get_db),
    admin: Admin = Depends(require_role("CANTEEN", "ADMIN")),
):
    """Daily canteen report with summary metrics."""
    from backend.services.timezone import today_local
    target = report_date or today_local()

    rows = list(db.scalars(
        select(CanteenTransaction)
        .where(CanteenTransaction.business_date == target)
        .order_by(CanteenTransaction.scan_timestamp.asc())
    ))

    accepted = [r for r in rows if r.scan_result == "ACCEPTED"]
    rejected = [r for r in rows if r.scan_result == "REJECTED"]
    no_entry = [r for r in rejected if r.rejection_reason == "NO_GATE_ENTRY"]
    duplicates = [r for r in rejected if r.rejection_reason == "ALREADY_SCANNED"]

    return {
        "date": target.isoformat(),
        "total_scans": len(rows),
        "successful_scans": len(accepted),
        "unique_workers": len(set(r.worker_id for r in accepted)),
        "rejected_scans": len(rejected),
        "duplicate_attempts": len(duplicates),
        "no_gate_entry": len(no_entry),
        "transactions": [_serialize_txn(t) for t in rows],
    }


def _serialize_txn(t: CanteenTransaction) -> dict:
    return {
        "id": t.id,
        "worker_id": t.worker_id,
        "business_date": t.business_date.isoformat(),
        "scan_timestamp": t.scan_timestamp.isoformat() if t.scan_timestamp else None,
        "gate_entry_id": t.gate_entry_id,
        "operator_id": t.operator_id,
        "scan_result": t.scan_result,
        "rejection_reason": t.rejection_reason,
    }
