from datetime import date, datetime, timezone
from sqlalchemy import String, Integer, Date, DateTime, ForeignKey, CheckConstraint, Index
from sqlalchemy.orm import Mapped, mapped_column
from backend.db import Base

def utcnow(): return datetime.now(timezone.utc)

class Worker(Base):
    __tablename__ = "workers"
    __table_args__ = (CheckConstraint("status IN ('Active','Inactive')", name="ck_worker_status"), Index("ix_workers_name", "name"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    worker_no: Mapped[str] = mapped_column(String(40), unique=True, nullable=False, index=True)
    worker_id: Mapped[str] = mapped_column(String(40), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    contractor_name: Mapped[str] = mapped_column(String(120), nullable=False)
    joining_date: Mapped[date] = mapped_column(Date, nullable=False)
    contact_no: Mapped[str] = mapped_column(String(16), nullable=False)
    emergency_contact: Mapped[str] = mapped_column(String(16), nullable=False)
    aadhaar_encrypted: Mapped[str | None] = mapped_column(String(512))
    aadhaar_last4: Mapped[str] = mapped_column(String(4), nullable=False)
    photo_path: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(8), nullable=False, default="Active")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

class Sequence(Base):
    __tablename__ = "sequences"
    name: Mapped[str] = mapped_column(String(40), primary_key=True)
    value: Mapped[int] = mapped_column(Integer, nullable=False)

class Admin(Base):
    __tablename__ = "admins"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)

