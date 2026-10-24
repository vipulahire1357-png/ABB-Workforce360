from pathlib import Path
from PIL import Image, UnidentifiedImageError
from fastapi import HTTPException, UploadFile
from backend.config import settings

MAX_BYTES = 200 * 1024
MAX_PIXELS = 20_000_000

async def validate_photo(file: UploadFile) -> bytes:
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES: raise HTTPException(422, "Photo must be 200 KB or smaller")
    if not data: raise HTTPException(422, "Photo is required")
    try:
        import io
        image = Image.open(io.BytesIO(data))
        if image.format not in ("JPEG", "JPG"): raise HTTPException(422, "Upload a JPG or JPEG photo")
        if image.width * image.height > MAX_PIXELS or image.width < 32 or image.height < 32: raise HTTPException(422, "Photo dimensions are not supported")
        image.verify()
    except HTTPException: raise
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError): raise HTTPException(422, "Photo is not a valid JPEG image")
    return data

def save_photo(worker_id: str, data: bytes) -> Path:
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    target = settings.upload_dir / f"{worker_id}.jpg"
    target.write_bytes(data)
    return target

