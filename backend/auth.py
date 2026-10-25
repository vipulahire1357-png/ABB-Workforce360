"""Authentication dependencies and session management for ABB Workforce360."""

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from argon2 import PasswordHasher

from backend.config import settings
from backend.db import get_db
from backend.models import Admin

serializer = URLSafeTimedSerializer(settings.session_secret or "unconfigured")
hasher = PasswordHasher()
SESSION_MAX_AGE = 8 * 60 * 60  # 8 hours


def get_serializer():
    import sys
    main_mod = sys.modules.get("backend.main")
    if main_mod and hasattr(main_mod, "serializer"):
        return main_mod.serializer
    return URLSafeTimedSerializer(settings.session_secret or "unconfigured")


def current_admin(request: Request, db: Session = Depends(get_db)):
    """Validate session cookie and return the authenticated Admin."""
    token = request.cookies.get("wir_session")
    try:
        s = get_serializer()
        payload = s.loads(token, max_age=SESSION_MAX_AGE) if token else None
    except (BadSignature, SignatureExpired):
        payload = None
    if not payload or not isinstance(payload, dict):
        raise HTTPException(401, "Authentication required")
    if request.method not in ("GET", "HEAD", "OPTIONS") and \
       request.headers.get("X-WIR-CSRF") != payload.get("csrf"):
        raise HTTPException(403, "CSRF validation failed")
    admin = db.scalar(select(Admin).where(Admin.username == payload.get("sub")))
    if not admin:
        raise HTTPException(401, "Authentication required")
    return admin


def require_role(*roles):
    """Return a FastAPI dependency that checks the admin has one of the allowed roles."""
    def _dep(admin: Admin = Depends(current_admin)):
        if admin.role not in roles:
            raise HTTPException(403, "Access denied for this role")
        return admin
    return _dep
