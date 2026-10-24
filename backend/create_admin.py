from getpass import getpass
from argon2 import PasswordHasher
from sqlalchemy import select
from backend.config import settings
from backend.db import init_db, SessionLocal
from backend.models import Admin

def main():
    settings.validate_secrets(); init_db()
    username=input("Administrator username: ").strip()
    if not username: raise SystemExit("Username is required")
    password=getpass("New password (minimum 14 characters): ")
    if len(password)<14: raise SystemExit("Password must be at least 14 characters")
    db=SessionLocal()
    try:
        if db.scalar(select(Admin).where(Admin.username==username)): raise SystemExit("That username already exists")
        db.add(Admin(username=username,password_hash=PasswordHasher().hash(password))); db.commit()
    finally: db.close()
    print("Administrator created.")
if __name__=="__main__": main()
