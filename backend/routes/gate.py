"""Gate Management API — scan processing, transaction history, and daily reports."""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, func, and_
from sqlalchemy.orm import Session

from backend.auth import require_role
from backend.db import get_db
from backend.models import Admin, GateTransaction
from backend.services import gate as gate_svc

router = APIRouter(prefix="/api/gate", tags=["Gate Management"])


class ScanInput(BaseModel):
    barcode: str = Field(min_length=1, max_length=120)


@router.post("/scan")
def scan(body: ScanInput, db: Session = Depends(get_db),
         admin: Admin = Depends(require_role("GATE", "ADMIN"))):
    """Process a gate barcode scan."""
    db.rollback()
    with db.begin():
        result = gate_svc.process_scan(db, body.barcode, admin.id)
    return {
        "accepted": result.accepted,
        "event_type": result.event_type,
        "reason": result.reason,
        "person": result.person,
        "entry_time": result.entry_time,
        "remaining_seconds": result.remaining_seconds,
        "transaction_id": result.transaction_id,
    }


@router.get("/transactions")
def transactions(
    page: int = 1,
    page_size: int = 25,
    event_date: date | None = None,
    person_type: str | None = None,
    person_id: str | None = None,
    result_filter: str | None = Query(None, alias="result"),
    db: Session = Depends(get_db),
    admin: Admin = Depends(require_role("GATE", "ADMIN")),
):
    """List gate transactions with pagination and filters."""
    if page < 1 or page_size < 1 or page_size > 100:
        raise HTTPException(422, "Invalid pagination")

    stmt = select(GateTransaction)
    if event_date:
        stmt = stmt.where(GateTransaction.event_date == event_date)
    if person_type:
        stmt = stmt.where(GateTransaction.person_type == person_type.upper())
    if person_id:
        stmt = stmt.where(GateTransaction.person_id == person_id)
    if result_filter:
        stmt = stmt.where(GateTransaction.validation_result == result_filter.upper())

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(
        stmt.order_by(GateTransaction.scan_timestamp.desc())
        .offset((page - 1) * page_size).limit(page_size)
    ).all()

    return {
        "items": [_serialize_txn(t) for t in rows],
        "page": page,
        "page_size": page_size,
        "total": total,
    }


@router.get("/transactions/{txn_id}")
def transaction_detail(txn_id: int, db: Session = Depends(get_db),
                       admin: Admin = Depends(require_role("GATE", "ADMIN"))):
    txn = db.scalar(select(GateTransaction).where(GateTransaction.id == txn_id))
    if not txn:
        raise HTTPException(404, "Transaction not found")
    return _serialize_txn(txn)


@router.get("/report")
def daily_report(
    report_date: date | None = None,
    db: Session = Depends(get_db),
    admin: Admin = Depends(require_role("GATE", "ADMIN")),
):
    """Daily gate report with summary metrics."""
    from backend.services.timezone import today_local
    target = report_date or today_local()

    rows = list(db.scalars(
        select(GateTransaction)
        .where(GateTransaction.event_date == target)
        .order_by(GateTransaction.scan_timestamp.asc())
    ))

    accepted = [r for r in rows if r.validation_result == "ACCEPTED"]
    entries = [r for r in accepted if r.event_type == "ENTRY"]
    exits = [r for r in accepted if r.event_type == "EXIT"]
    rejected = [r for r in rows if r.validation_result == "REJECTED"]

    return {
        "date": target.isoformat(),
        "total_transactions": len(rows),
        "accepted_entries": len(entries),
        "accepted_exits": len(exits),
        "rejected": len(rejected),
        "unique_persons": len(set(r.person_id for r in accepted)),
        "transactions": [_serialize_txn(t) for t in rows],
    }


def _serialize_txn(t: GateTransaction) -> dict:
    return {
        "id": t.id,
        "event_date": t.event_date.isoformat(),
        "scan_timestamp": t.scan_timestamp.isoformat() if t.scan_timestamp else None,
        "person_id": t.person_id,
        "person_type": t.person_type,
        "event_type": t.event_type,
        "barcode_scanned": t.barcode_scanned,
        "validation_result": t.validation_result,
        "rejection_reason": t.rejection_reason,
        "operator_id": t.operator_id,
    }
