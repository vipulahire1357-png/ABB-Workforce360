import React, { useEffect, useRef, useState } from 'react';
import { Check, LoaderCircle, X } from 'lucide-react';

interface PhotoCropProps {
  file: File;
  subject: 'worker' | 'visitor';
  onApply: (file: File) => void;
  onCancel: () => void;
}

const MAX_PHOTO_BYTES = 200 * 1024;

export const PhotoCrop: React.FC<PhotoCropProps> = ({ file, subject, onApply, onCancel }) => {
  const imageRef = useRef<HTMLImageElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [imageReady, setImageReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSourceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, offsetX: offset.x, offsetY: offset.y };
  };

  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || !frameRef.current || !imageRef.current) return;
    const frame = frameRef.current.getBoundingClientRect();
    const image = imageRef.current;
    const scale = Math.max(frame.width / image.naturalWidth, frame.height / image.naturalHeight) * zoom;
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    const wantedX = dragRef.current.offsetX + event.clientX - dragRef.current.x;
    const wantedY = dragRef.current.offsetY + event.clientY - dragRef.current.y;
    setOffset({
      x: Math.max(-(width - frame.width) / 2, Math.min((width - frame.width) / 2, wantedX)),
      y: Math.max(-(height - frame.height) / 2, Math.min((height - frame.height) / 2, wantedY)),
    });
  };

  const changeZoom = (value: number) => {
    setZoom(value);
    setOffset({ x: 0, y: 0 });
  };

  const frameWidth = frameRef.current?.clientWidth || 288;
  const frameHeight = frameWidth * 9 / 8;
  const baseScale = imageRef.current?.naturalWidth
    ? Math.max(frameWidth / imageRef.current.naturalWidth, frameHeight / imageRef.current.naturalHeight)
    : 1;

  const applyCrop = async () => {
    const image = imageRef.current;
    const frame = frameRef.current;
    if (!image || !frame?.clientWidth || !image.naturalWidth) return;
    setBusy(true);
    setError('');
    try {
      const scale = Math.max(frame.clientWidth / image.naturalWidth, frame.clientHeight / image.naturalHeight) * zoom;
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      const left = Math.max(frame.clientWidth - width, Math.min(0, (frame.clientWidth - width) / 2 + offset.x));
      const top = Math.max(frame.clientHeight - height, Math.min(0, (frame.clientHeight - height) / 2 + offset.y));
      const sx = -left / scale;
      const sy = -top / scale;
      const sw = frame.clientWidth / scale;
      const sh = frame.clientHeight / scale;
      const canvas = document.createElement('canvas');
      // Reduce resolution and JPEG quality as needed so the result fits the
      // 200 KB registration limit, including for high-detail source photos.
      for (const size of [720, 540, 360, 240, 160, 120, 80, 48, 24]) {
        canvas.width = size * 8 / 9;
        canvas.height = size;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Image cropping is unavailable in this browser.');
        context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        for (const quality of [0.88, 0.76, 0.64, 0.52, 0.4, 0.3]) {
          const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Could not process the selected photo.')), 'image/jpeg', quality));
          if (blob.size <= MAX_PHOTO_BYTES) {
            const cropped = new File([blob], `${subject}-photo-${Date.now()}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
            onApply(cropped);
            return;
          }
        }
      }
      setError('This browser could not compress the photo under 200 KB. Try another photo or browser.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not crop the selected photo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="camera-overlay">
      <section className="camera-dialog crop-dialog" role="dialog" aria-modal="true" aria-labelledby="crop-title">
        <header className="camera-header">
          <div><h2 id="crop-title">Crop {subject} photo</h2><p>Drag to position the image and adjust the zoom.</p></div>
          <button type="button" className="camera-close" onClick={onCancel} aria-label="Cancel crop"><X size={19} /></button>
        </header>
        <div
          ref={frameRef}
          className="photo-crop-frame"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={() => { dragRef.current = null; }}
          onPointerCancel={() => { dragRef.current = null; }}
        >
          {sourceUrl && <img ref={imageRef} src={sourceUrl} alt="Photo crop preview" onLoad={() => { setOffset({ x: 0, y: 0 }); setImageReady(true); }} style={{ width: imageReady ? imageRef.current!.naturalWidth * baseScale : 'auto', height: imageReady ? imageRef.current!.naturalHeight * baseScale : 'auto', transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${zoom})` }} />}
        </div>
        <label className="crop-zoom">Zoom <input type="range" min="1" max="3" step="0.01" value={zoom} onChange={(event) => changeZoom(Number(event.target.value))} /></label>
        {error && <p className="camera-error" role="alert">{error}</p>}
        <footer className="camera-actions">
          <button type="button" className="secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="primary" onClick={() => void applyCrop()} disabled={busy || !sourceUrl}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />} Use cropped photo
          </button>
        </footer>
      </section>
    </div>
  );
};
