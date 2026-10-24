import hashlib, hmac, json, re
from cryptography.fernet import Fernet
from backend.config import settings

def new_worker_id(worker_no: str, aadhaar: str) -> str:
    # HMAC-SHA-256 over canonical compact JSON [worker_no, normalized Aadhaar]; first 20 hex chars.
    payload = json.dumps([worker_no, re.sub(r"\s", "", aadhaar)], ensure_ascii=True, separators=(",", ":")).encode()
    digest = hmac.new(settings.worker_id_secret.encode(), payload, hashlib.sha256).hexdigest()[:20].upper()
    return f"WIR-{digest}"

def encrypt_aadhaar(value: str) -> str:
    if not settings.aadhaar_encryption_key:
        raise RuntimeError("Aadhaar encryption key is not configured")
    return Fernet(settings.aadhaar_encryption_key.encode()).encrypt(value.encode()).decode()

