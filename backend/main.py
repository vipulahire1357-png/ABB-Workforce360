from datetime import date
from pathlib import Path
import secrets
import hmac
import hashlib
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, File, Form, HTTPException, Request, UploadFile, Response
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, func, update
from sqlalchemy.orm import Session
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from backend.config import settings
from backend.db import init_db, get_db
from backend.models import Worker, Sequence, Admin
from backend.schemas import WorkerCreate, StatusUpdate, LoginInput
from backend.services.identity import new_worker_id, encrypt_aadhaar
from backend.services.photos import validate_photo, save_photo
from backend.services.cards import card_pdf, CardAssetError

from backend.auth import current_admin, require_role, serializer, hasher
from backend.routes.gate import router as gate_router
from backend.routes.visitors import router as visitors_router
from backend.routes.canteen import router as canteen_router

@asynccontextmanager
async def lifespan(_app):
    settings.validate_secrets()
    init_db()
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    settings.visitor_upload_dir.mkdir(parents=True, exist_ok=True)
    yield

app = FastAPI(title="ABB Workforce360", version="2.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=[settings.allowed_origin], allow_credentials=True, allow_methods=["GET","POST","PATCH"], allow_headers=["Content-Type","X-WIR-CSRF"])

app.include_router(gate_router)
app.include_router(visitors_router)
app.include_router(canteen_router)

@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    db.execute(select(1)); return {"status":"ok"}

@app.post("/api/auth/login")
def login(body: LoginInput, response: Response, db: Session = Depends(get_db)):
    admin = db.scalar(select(Admin).where(Admin.username == body.username))
    if not admin:
        # Consistent password-hash work even for an unknown username.
        try: hasher.verify(hasher.hash("invalid-account-placeholder"), body.password)
        except Exception: pass
        raise HTTPException(401,"Invalid username or password")
    try: hasher.verify(admin.password_hash, body.password)
    except VerifyMismatchError: raise HTTPException(401,"Invalid username or password")
    if hasher.check_needs_rehash(admin.password_hash):
        admin.password_hash=hasher.hash(body.password); db.commit()
    nonce=secrets.token_urlsafe(32)
    csrf=hmac.new(settings.csrf_secret.encode(),nonce.encode(),hashlib.sha256).hexdigest()
    token=serializer.dumps({"sub":admin.username,"csrf":csrf})
    response.set_cookie("wir_session",token,httponly=True,secure=settings.cookie_secure,samesite="strict",max_age=8*60*60,path="/")
    return {"username":admin.username,"role":getattr(admin, "role", "ADMIN"),"csrf_token":csrf}

@app.get("/api/auth/me")
def me(request: Request, admin: Admin = Depends(current_admin)):
    token = request.cookies.get("wir_session")
    payload = serializer.loads(token, max_age=8*60*60)
    return {"username":admin.username,"role":getattr(admin, "role", "ADMIN"),"csrf_token":payload.get("csrf")}

@app.post("/api/auth/logout")
def logout(response: Response, _: Admin=Depends(current_admin)):
    response.delete_cookie("wir_session",path="/"); return {"status":"ok"}

def serialize(w: Worker):
    return {"worker_id":w.worker_id,"worker_no":w.worker_no,"name":w.name,"contractor_name":w.contractor_name,"joining_date":w.joining_date.isoformat(),"contact_no":w.contact_no,"emergency_contact":w.emergency_contact,"aadhaar_masked":f"XXXX XXXX {w.aadhaar_last4}","photo_url":f"/api/workers/{w.worker_id}/photo","status":w.status}

@app.post("/api/workers",status_code=201)
async def register(request: Request, name: str=Form(...), contractor_name: str=Form(...), joining_date: str=Form(...), contact_no: str=Form(...), emergency_contact: str=Form(...), aadhaar_no: str=Form(...), photo: UploadFile=File(...), db: Session=Depends(get_db), _: Admin=Depends(current_admin)):
    try: values=WorkerCreate(name=name,contractor_name=contractor_name,joining_date=date.fromisoformat(joining_date),contact_no=contact_no,emergency_contact=emergency_contact,aadhaar_no=aadhaar_no)
    except (ValueError, TypeError) as e: raise HTTPException(422,"Invalid registration details") from e
    if not settings.aadhaar_encryption_key: raise HTTPException(503,"Aadhaar encryption is not configured")
    data=await validate_photo(photo)
    if not settings.worker_id_secret: raise HTTPException(503,"Worker ID generation is not configured")
    saved=None
    try:
        # The authentication dependency may have opened a read transaction on this session.
        db.rollback()
        with db.begin():
            # Atomic SQLite UPDATE serializes number allocation; the unique constraints are the final guard.
            db.execute(Sequence.__table__.insert().prefix_with("OR IGNORE").values(name="worker_no",value=0))
            seq=db.execute(update(Sequence).where(Sequence.name=="worker_no").values(value=Sequence.value+1).returning(Sequence.value)).scalar_one()
            worker_no=f"ABB-P3-W-{seq}"
            worker_id=new_worker_id(worker_no,values.aadhaar_no)
            namefile=f"{worker_id}.jpg"; saved=save_photo(worker_id,data)
            w=Worker(worker_no=worker_no,worker_id=worker_id,name=values.name,contractor_name=values.contractor_name,joining_date=values.joining_date,contact_no=values.contact_no,emergency_contact=values.emergency_contact,aadhaar_encrypted=encrypt_aadhaar(values.aadhaar_no),aadhaar_last4=values.aadhaar_no[-4:],photo_path=namefile,status="Active")
            db.add(w); db.flush()
        db.refresh(w); return serialize(w)
    except Exception as e:
        db.rollback()
        if saved and saved.exists(): saved.unlink(missing_ok=True)
        if isinstance(e,HTTPException): raise
        raise HTTPException(409,"Registration could not be completed") from None

@app.get("/api/workers")
def workers(page:int=1,page_size:int=25,name:str|None=None,sort:str="worker_no",direction:str="asc",db:Session=Depends(get_db),_:Admin=Depends(current_admin)):
    if page<1 or page_size<1 or page_size>100: raise HTTPException(422,"Invalid pagination")
    allowed={"worker_no":Worker.worker_no,"name":Worker.name,"joining_date":Worker.joining_date,"status":Worker.status}
    if sort not in allowed: sort="worker_no"
    stmt=select(Worker)
    if name: stmt=stmt.where(Worker.name.ilike(f"%{name[:100]}%"))
    total=db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    order=allowed[sort].desc() if direction=="desc" else allowed[sort].asc()
    rows=db.scalars(stmt.order_by(order).offset((page-1)*page_size).limit(page_size)).all()
    counts={s:db.scalar(select(func.count()).select_from(Worker).where(Worker.status==s)) or 0 for s in ("Active","Inactive")}
    return {"items":[serialize(w) for w in rows],"page":page,"page_size":page_size,"total":total,"active":counts["Active"],"inactive":counts["Inactive"]}

@app.get("/api/workers/search")
def search(q:str="",db:Session=Depends(get_db),_:Admin=Depends(current_admin)):
    if not q.strip(): return []
    return [{"worker_id":w.worker_id,"name":w.name,"worker_no":w.worker_no} for w in db.scalars(select(Worker).where(Worker.name.ilike(f"%{q[:80]}%")).order_by(Worker.name).limit(20))]

def by_id(worker_id:str,db:Session):
    w=db.scalar(select(Worker).where(Worker.worker_id==worker_id))
    if not w: raise HTTPException(404,"Worker not found")
    return w

@app.get("/api/workers/{worker_id}")
def detail(worker_id:str,db:Session=Depends(get_db),_:Admin=Depends(current_admin)): return serialize(by_id(worker_id,db))

@app.patch("/api/workers/{worker_id}/status")
def set_status(worker_id:str,body:StatusUpdate,db:Session=Depends(get_db),_:Admin=Depends(current_admin)):
    w=by_id(worker_id,db); w.status=body.status; db.commit(); db.refresh(w); return serialize(w)

@app.get("/api/workers/{worker_id}/photo")
def photo(worker_id:str,db:Session=Depends(get_db),_:Admin=Depends(current_admin)):
    w=by_id(worker_id,db); path=settings.upload_dir / Path(w.photo_path).name
    if not path.is_file(): raise HTTPException(404,"Photo not found")
    return FileResponse(path,media_type="image/jpeg",headers={"Cache-Control":"private, no-store"})

@app.get("/api/workers/{worker_id}/id-card")
def id_card(worker_id:str,db:Session=Depends(get_db),_:Admin=Depends(current_admin)):
    w=by_id(worker_id,db)
    try:
        pdf=card_pdf(w)
    except CardAssetError:
        raise HTTPException(503,"ID card cannot be generated because a required image asset is missing or invalid") from None
    return StreamingResponse(iter([pdf]),media_type="application/pdf",headers={"Content-Disposition":f'attachment; filename="{w.worker_no}.pdf"',"Cache-Control":"private, no-store"})

@app.get("/api/summary")
def summary(db:Session=Depends(get_db),_:Admin=Depends(current_admin)):
    total=db.scalar(select(func.count()).select_from(Worker)) or 0
    active=db.scalar(select(func.count()).select_from(Worker).where(Worker.status=="Active")) or 0
    return {"total":total,"active":active,"inactive":total-active}

from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse
DIST=Path(__file__).resolve().parents[1]/"frontend"/"dist"
if DIST.is_dir(): app.mount("/",StaticFiles(directory=DIST,html=True),name="frontend")

