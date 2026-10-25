"""Canteen scan validation — one successful scan per worker per business day."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.models import Worker, GateTransaction, CanteenTransaction
from backend.services.timezone import now_local


@dataclass
class CanteenResult:
    accepted: bool
    reason: str = ""
    person: dict[str, Any] | None = None
    gate_entry_time: str | None = None
    transaction_id: int | None = None


def _person(w: Worker) -> dict:
    return {
        "person_id": w.worker_id, "name": w.name,
        "worker_no": w.worker_no, "detail": w.contractor_name,
        "photo_url": f"/api/workers/{w.worker_id}/photo",
    }


def _record(db, worker_id, business_date, scan_ts, gate_entry_id,
            operator_id, result, reason):
    txn = CanteenTransaction(
        worker_id=worker_id, business_date=business_date,
        scan_timestamp=scan_ts, gate_entry_id=gate_entry_id,
        operator_id=operator_id, scan_result=result,
        rejection_reason=reason,
    )
    db.add(txn)
    db.flush()
    return txn


def process_scan(db: Session, barcode: str, operator_id: int | None) -> CanteenResult:
    """Process a canteen barcode scan for a worker."""
    barcode = barcode.strip()
    if not barcode:
        return CanteenResult(False, "INVALID_ID")

    scan_ts = now_local()
    business_date = scan_ts.date()

    # Resolve worker
    worker = db.scalar(select(Worker).where(Worker.worker_id == barcode))
    if not worker:
        _record(db, barcode, business_date, scan_ts, None, operator_id,
                "REJECTED", "WORKER_NOT_FOUND")
        return CanteenResult(False, "WORKER_NOT_FOUND")

    person = _person(worker)

    if worker.status != "Active":
        _record(db, worker.worker_id, business_date, scan_ts, None, operator_id,
                "REJECTED", "WORKER_NOT_ELIGIBLE")
        return CanteenResult(False, "WORKER_NOT_ELIGIBLE", person)

    # Check for qualifying gate ENTRY today (ACCEPTED entries only)
    gate_entry = db.scalar(
        select(GateTransaction).where(
            GateTransaction.person_id == worker.worker_id,
            GateTransaction.event_date == business_date,
            GateTransaction.event_type == "ENTRY",
            GateTransaction.validation_result == "ACCEPTED",
        ).order_by(GateTransaction.scan_timestamp.asc()).limit(1)
    )
    if not gate_entry:
        _record(db, worker.worker_id, business_date, scan_ts, None, operator_id,
                "REJECTED", "NO_GATE_ENTRY")
        return CanteenResult(False, "NO_GATE_ENTRY", person)

    # Check for existing successful canteen scan today
    existing = db.scalar(
        select(CanteenTransaction).where(
            CanteenTransaction.worker_id == worker.worker_id,
            CanteenTransaction.business_date == business_date,
            CanteenTransaction.scan_result == "ACCEPTED",
        )
    )
    if existing:
        _record(db, worker.worker_id, business_date, scan_ts, gate_entry.id,
                operator_id, "REJECTED", "ALREADY_SCANNED")
        return CanteenResult(False, "ALREADY_SCANNED", person,
                             gate_entry.scan_timestamp.isoformat())

    # Accept
    txn = _record(db, worker.worker_id, business_date, scan_ts, gate_entry.id,
                  operator_id, "ACCEPTED", None)
    return CanteenResult(True, "CANTEEN_SCAN_ACCEPTED", person,
                         gate_entry.scan_timestamp.isoformat(), txn.id)

