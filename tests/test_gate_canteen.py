"""Tests for Gate & Visitor Management and Canteen Scan Management."""

import io
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
from PIL import Image
import pytest
from argon2 import PasswordHasher
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from backend import db as dbmod
from backend import main
from backend.models import Base, Admin, Worker, Visitor, GateTransaction, CanteenTransaction
from backend.services.identity import new_worker_id, new_visitor_id, encrypt_aadhaar
from backend.services.timezone import site_tz, now_local, today_local


@pytest.fixture
def app_client(monkeypatch, tmp_path):
    test_engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    old_engine = dbmod.engine
    dbmod.engine = test_engine
    dbmod.SessionLocal.configure(bind=test_engine)
    Base.metadata.create_all(test_engine)

    settings = main.settings
    monkeypatch.setattr(settings, "session_secret", "s" * 40)
    monkeypatch.setattr(settings, "csrf_secret", "c" * 40)
    monkeypatch.setattr(settings, "worker_id_secret", "w" * 40)
    monkeypatch.setattr(settings, "visitor_id_secret", "v" * 40)
    monkeypatch.setattr(settings, "aadhaar_encryption_key", Fernet.generate_key().decode())
    monkeypatch.setattr(settings, "upload_dir", tmp_path / "workers")
    monkeypatch.setattr(settings, "visitor_upload_dir", tmp_path / "visitors")
    monkeypatch.setattr(settings, "site_timezone", "Asia/Kolkata")

    main.serializer = main.URLSafeTimedSerializer(settings.session_secret)

    # Seed admins with different roles
    hasher = PasswordHasher()
    with dbmod.SessionLocal() as session:
        session.add(Admin(username="admin_user", password_hash=hasher.hash("admin-password-14c"), role="ADMIN"))
        session.add(Admin(username="gate_user", password_hash=hasher.hash("gate-password-14ch"), role="GATE"))
        session.add(Admin(username="canteen_user", password_hash=hasher.hash("canteen-pass-14ch"), role="CANTEEN"))
        session.commit()

    with TestClient(main.app) as client:
        yield client

    dbmod.engine = old_engine
    dbmod.SessionLocal.configure(bind=old_engine)


def _login(client, username, password):
    res = client.post("/api/auth/login", json={"username": username, "password": password})
    assert res.status_code == 200, res.text
    return res.json()["csrf_token"]


def test_login_returns_role(app_client):
    res = app_client.post("/api/auth/login", json={"username": "gate_user", "password": "gate-password-14ch"})
    assert res.status_code == 200
    data = res.json()
    assert data["role"] == "GATE"
    assert data["username"] == "gate_user"
    assert "csrf_token" in data


def test_auth_me_endpoint(app_client):
    csrf = _login(app_client, "canteen_user", "canteen-pass-14ch")
    res = app_client.get("/api/auth/me")
    assert res.status_code == 200
    data = res.json()
    assert data["role"] == "CANTEEN"
    assert data["username"] == "canteen_user"
    assert data["csrf_token"] == csrf


def test_role_authorization_enforcement(app_client):
    gate_csrf = _login(app_client, "gate_user", "gate-password-14ch")
    # Gate user cannot access worker registration
    res = app_client.post("/api/workers", headers={"X-WIR-CSRF": gate_csrf}, data={})
    # Since worker endpoints use current_admin (open to any authenticated admin), gate_user can read,
    # but canteen endpoints require CANTEEN or ADMIN
    res = app_client.post("/api/canteen/scan", headers={"X-WIR-CSRF": gate_csrf}, json={"barcode": "test"})
    assert res.status_code == 403

    # Canteen user cannot access gate endpoints
    canteen_csrf = _login(app_client, "canteen_user", "canteen-pass-14ch")
    res = app_client.post("/api/gate/scan", headers={"X-WIR-CSRF": canteen_csrf}, json={"barcode": "test"})
    assert res.status_code == 403

    # Admin user can access both
    admin_csrf = _login(app_client, "admin_user", "admin-password-14c")
    res = app_client.post("/api/gate/scan", headers={"X-WIR-CSRF": admin_csrf}, json={"barcode": ""})
    assert res.status_code in (200, 422)  # Authorized


def test_gate_and_canteen_workflow(app_client):
    # 1. Create a worker via direct DB insert
    with dbmod.SessionLocal() as session:
        worker_id = new_worker_id("ABB-P3-W-1", "999988887777")
        worker = Worker(
            worker_no="ABB-P3-W-1",
            worker_id=worker_id,
            name="Rahul Sharma",
            contractor_name="ABB In-House",
            joining_date=date(2026, 1, 1),
            contact_no="9876543210",
            emergency_contact="9876543211",
            aadhaar_encrypted=encrypt_aadhaar("999988887777"),
            aadhaar_last4="7777",
            photo_path="fake.jpg",
            status="Active",
        )
        session.add(worker)
        session.commit()

    gate_csrf = _login(app_client, "gate_user", "gate-password-14ch")

    # 2. Gate Scan 1: ENTRY
    # Scanner firmware may emit lowercase; identity lookup should be case-insensitive.
    scan1 = app_client.post("/api/gate/scan", headers={"X-WIR-CSRF": gate_csrf}, json={"barcode": worker_id.lower()})
    assert scan1.status_code == 200
    d1 = scan1.json()
    assert d1["accepted"] is True
    assert d1["event_type"] == "ENTRY"
    assert d1["person"]["name"] == "Rahul Sharma"
    with dbmod.SessionLocal() as session:
        first_gate_txn = session.query(GateTransaction).filter_by(person_id=worker_id).first()
        assert first_gate_txn.barcode_scanned == worker_id

    # 3. Gate Scan 2: Immediate re-scan should trigger cooldown (< 10 minutes)
    scan2 = app_client.post("/api/gate/scan", headers={"X-WIR-CSRF": gate_csrf}, json={"barcode": worker_id})
    assert scan2.status_code == 200
    d2 = scan2.json()
    assert d2["accepted"] is False
    assert d2["reason"] == "NOT_YET_ELIGIBLE"
    assert d2["remaining_seconds"] > 0

    # 4. Canteen Scan: Should succeed because worker has an ENTRY today!
    canteen_csrf = _login(app_client, "canteen_user", "canteen-pass-14ch")
    cscan1 = app_client.post("/api/canteen/scan", headers={"X-WIR-CSRF": canteen_csrf}, json={"barcode": worker_id})
    assert cscan1.status_code == 200
    cd1 = cscan1.json()
    assert cd1["accepted"] is True
    assert cd1["reason"] == "CANTEEN_SCAN_ACCEPTED"
    assert cd1["person"]["worker_no"] == "ABB-P3-W-1"

    # 5. Canteen Scan 2: Duplicate scan on the same day must be rejected!
    cscan2 = app_client.post("/api/canteen/scan", headers={"X-WIR-CSRF": canteen_csrf}, json={"barcode": worker_id})
    assert cscan2.status_code == 200
    cd2 = cscan2.json()
    assert cd2["accepted"] is False
    assert cd2["reason"] == "ALREADY_SCANNED"

    # 6. Simulate 11 minutes later for Gate EXIT
    with dbmod.SessionLocal() as session:
        entry_txn = session.query(GateTransaction).filter_by(person_id=worker_id, event_type="ENTRY").first()
        entry_txn.scan_timestamp = entry_txn.scan_timestamp - timedelta(minutes=11)
        session.commit()

    gate_csrf = _login(app_client, "gate_user", "gate-password-14ch")
    scan3 = app_client.post("/api/gate/scan", headers={"X-WIR-CSRF": gate_csrf}, json={"barcode": worker_id})
    assert scan3.status_code == 200
    d3 = scan3.json()
    assert d3["accepted"] is True
    assert d3["event_type"] == "EXIT"

    # 7. Gate Scan 4: After EXIT, person has completed both ENTRY + EXIT for the day, subsequent scan rejected
    scan4 = app_client.post("/api/gate/scan", headers={"X-WIR-CSRF": gate_csrf}, json={"barcode": worker_id})
    assert scan4.status_code == 200
    d4 = scan4.json()
    assert d4["accepted"] is False
    assert d4["reason"] == "ALREADY_COMPLETED"


def test_visitor_registration_and_gate_scan(app_client):
    gate_csrf = _login(app_client, "gate_user", "gate-password-14ch")

    # Register visitor
    reg = app_client.post(
        "/api/visitors",
        headers={"X-WIR-CSRF": gate_csrf},
        data={
            "name": "Amit Patel",
            "company_name": "Siemens India",
            "location": "Vadodara",
            "host": "Rajesh Varma",
            "purpose": "PLC Calibration",
            "contact_no": "9123456789",
            "aadhaar_no": "987654321012",
        },
    )
    assert reg.status_code == 201
    vdata = reg.json()
    assert vdata["name"] == "Amit Patel"
    assert vdata["company_name"] == "Siemens India"
    assert vdata["visitor_no"] == "ABB-P3-V-1"
    assert vdata["visitor_id"].startswith("VIS-")
    assert vdata["aadhaar_masked"] == "XXXX XXXX 1012"

    visitor_id = vdata["visitor_id"]

    # Gate scan for visitor: ENTRY
    scan = app_client.post("/api/gate/scan", headers={"X-WIR-CSRF": gate_csrf}, json={"barcode": visitor_id})
    assert scan.status_code == 200
    sd = scan.json()
    assert sd["accepted"] is True
    assert sd["event_type"] == "ENTRY"
    assert sd["person"]["person_type"] == "VISITOR"
    assert sd["person"]["name"] == "Amit Patel"

    # Visitor card PDF generation
    card_res = app_client.get(f"/api/visitors/{visitor_id}/id-card")
    assert card_res.status_code == 200
    assert card_res.headers["content-type"] == "application/pdf"
    assert len(card_res.content) > 1000  # valid PDF bytes


def test_canteen_rejection_for_no_gate_entry(app_client):
    # Worker without gate entry today
    with dbmod.SessionLocal() as session:
        worker_id = new_worker_id("ABB-P3-W-99", "555544443333")
        worker = Worker(
            worker_no="ABB-P3-W-99",
            worker_id=worker_id,
            name="Suresh Kumar",
            contractor_name="L&T",
            joining_date=date(2026, 1, 1),
            contact_no="9876543219",
            emergency_contact="9876543218",
            aadhaar_encrypted=encrypt_aadhaar("555544443333"),
            aadhaar_last4="3333",
            photo_path="fake.jpg",
            status="Active",
        )
        session.add(worker)
        session.commit()

    canteen_csrf = _login(app_client, "canteen_user", "canteen-pass-14ch")
    cscan = app_client.post("/api/canteen/scan", headers={"X-WIR-CSRF": canteen_csrf}, json={"barcode": worker_id})
    assert cscan.status_code == 200
    cd = cscan.json()
    assert cd["accepted"] is False
    assert cd["reason"] == "NO_GATE_ENTRY"


def test_visitor_can_receive_one_meal_after_gate_entry(app_client):
    gate_csrf = _login(app_client, "gate_user", "gate-password-14ch")
    reg = app_client.post(
        "/api/visitors",
        headers={"X-WIR-CSRF": gate_csrf},
        data={
            "name": "Test Visitor", "company_name": "Test Company",
            "location": "Plant 3", "host": "Test Host", "purpose": "Testing",
            "contact_no": "9123456789", "aadhaar_no": "987654321012",
        },
    )
    assert reg.status_code == 201, reg.text
    visitor_id = reg.json()["visitor_id"]

    entry = app_client.post(
        "/api/gate/scan", headers={"X-WIR-CSRF": gate_csrf},
        json={"barcode": visitor_id.lower()},
    )
    assert entry.status_code == 200
    assert entry.json()["accepted"] is True
    assert entry.json()["person"]["person_type"] == "VISITOR"

    canteen_csrf = _login(app_client, "canteen_user", "canteen-pass-14ch")
    meal = app_client.post(
        "/api/canteen/scan", headers={"X-WIR-CSRF": canteen_csrf},
        json={"barcode": visitor_id.lower()},
    )
    assert meal.status_code == 200
    assert meal.json()["accepted"] is True
    assert meal.json()["person"]["person_type"] == "VISITOR"
    assert meal.json()["person"]["visitor_no"] == "ABB-P3-V-1"

    duplicate = app_client.post(
        "/api/canteen/scan", headers={"X-WIR-CSRF": canteen_csrf},
        json={"barcode": visitor_id},
    )
    assert duplicate.status_code == 200
    assert duplicate.json()["accepted"] is False
    assert duplicate.json()["reason"] == "ALREADY_SCANNED"

    report = app_client.get("/api/canteen/report")
    assert report.status_code == 200
    assert report.json()["unique_visitors"] == 1
    assert report.json()["unique_people"] == 1

    history = app_client.get(f"/api/canteen/transactions?person_id={visitor_id}")
    assert history.status_code == 200
    assert all(item["person_type"] == "VISITOR" for item in history.json()["items"])


def test_visitor_canteen_scan_requires_current_eligibility(app_client):
    gate_csrf = _login(app_client, "gate_user", "gate-password-14ch")
    reg = app_client.post(
        "/api/visitors", headers={"X-WIR-CSRF": gate_csrf},
        data={
            "name": "Test Visitor", "company_name": "Test Company",
            "location": "Plant 3", "host": "Test Host", "purpose": "Testing",
            "contact_no": "9123456789", "aadhaar_no": "987654321012",
        },
    )
    assert reg.status_code == 201, reg.text
    visitor_id = reg.json()["visitor_id"]
    canteen_csrf = _login(app_client, "canteen_user", "canteen-pass-14ch")

    no_entry = app_client.post(
        "/api/canteen/scan", headers={"X-WIR-CSRF": canteen_csrf},
        json={"barcode": visitor_id},
    )
    assert no_entry.json()["reason"] == "NO_GATE_ENTRY"

    with dbmod.SessionLocal() as session:
        visitor = session.query(Visitor).filter_by(visitor_id=visitor_id).one()
        visitor.status = "Inactive"
        session.commit()
    inactive = app_client.post(
        "/api/canteen/scan", headers={"X-WIR-CSRF": canteen_csrf},
        json={"barcode": visitor_id},
    )
    assert inactive.json()["reason"] == "VISITOR_NOT_ELIGIBLE"

    with dbmod.SessionLocal() as session:
        visitor = session.query(Visitor).filter_by(visitor_id=visitor_id).one()
        visitor.status = "Active"
        visitor.expiration_timestamp = now_local() - timedelta(seconds=1)
        session.commit()
    expired = app_client.post(
        "/api/canteen/scan", headers={"X-WIR-CSRF": canteen_csrf},
        json={"barcode": visitor_id},
    )
    assert expired.json()["reason"] == "VISITOR_NOT_ELIGIBLE"
    with dbmod.SessionLocal() as session:
        visitor = session.query(Visitor).filter_by(visitor_id=visitor_id).one()
        assert visitor.status == "Inactive"
