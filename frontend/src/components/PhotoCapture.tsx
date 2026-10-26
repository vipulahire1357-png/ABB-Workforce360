import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Check, LoaderCircle, X } from 'lucide-react';

interface PhotoCaptureProps {
  subject: 'worker' | 'visitor';
  onCapture: (file: File) => void;
  onClose: () => void;
}

const MAX_PHOTO_BYTES = 200 * 1024;

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

async function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('The camera image could not be encoded. Please try again.'));
    }, 'image/jpeg', quality);
  });
}

async function makePhoto(video: HTMLVideoElement, subject: 'worker' | 'visitor'): Promise<File> {
  if (!video.videoWidth || !video.videoHeight) {
    throw new Error('The camera is still starting. Wait a moment and try again.');
  }

  const canvas = document.createElement('canvas');
  const sourceRatio = video.videoWidth / video.videoHeight;
  // Match the ID-card photo box: 24 mm wide × 27 mm high (8:9).
  const outputRatio = 8 / 9;
  let sx = 0;
  let sy = 0;
  let sw = video.videoWidth;
  let sh = video.videoHeight;
  if (sourceRatio > outputRatio) {
    sw = video.videoHeight * outputRatio;
    sx = (video.videoWidth - sw) / 2;
  } else {
    sh = video.videoWidth / outputRatio;
    sy = (video.videoHeight - sh) / 2;
  }

  // Keep reducing the output dimensions and JPEG quality until it fits the
  // upload limit, even for noisy or unusually detailed camera frames.
  for (const size of [720, 540, 360, 240, 160, 120, 80, 48, 24]) {
    canvas.width = size * 8 / 9;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Photo capture is unavailable in this browser.');
    context.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.88, 0.76, 0.64, 0.52, 0.4, 0.3]) {
      const blob = await canvasBlob(canvas, quality);
      if (blob.size <= MAX_PHOTO_BYTES) {
        const filename = `${subject}-photo-${Date.now()}.jpg`;
        return new File([blob], filename, { type: 'image/jpeg', lastModified: Date.now() });
      }
    }
  }

  throw new Error('The captured photo is larger than 200 KB. Please try again in better lighting.');
}

export const PhotoCapture: React.FC<PhotoCaptureProps> = ({ subject, onCapture, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const requestIdRef = useRef(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState('');
  const [starting, setStarting] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState('');
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const available = (await navigator.mediaDevices.enumerateDevices())
        .filter((device) => device.kind === 'videoinput');
      setDevices(available);
      return available;
    } catch {
      setDevices([]);
      return [];
    }
  }, []);

  const startCamera = useCallback(async (deviceId?: string) => {
    const requestId = ++requestIdRef.current;
    const media = navigator.mediaDevices;
    if (!window.isSecureContext) {
      setError('Camera access requires a secure browser address. On this laptop, open Workforce360 at 127.0.0.1; other laptops need HTTPS.');
      setStarting(false);
      return;
    }
    if (!media?.getUserMedia) {
      setError('This browser does not support camera access. Choose a JPG or JPEG photo instead.');
      setStarting(false);
      return;
    }

    setStarting(true);
    setError('');
    stopStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    try {
      const stream = await media.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : true,
        audio: false,
      });
      if (requestId !== requestIdRef.current) {
        stopStream(stream);
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      const available = await refreshDevices();
      if (requestId !== requestIdRef.current) return;
      const activeId = stream.getVideoTracks()[0]?.getSettings().deviceId;
      setSelectedDevice(deviceId || activeId || available?.[0]?.deviceId || '');
    } catch (reason) {
      if (requestId !== requestIdRef.current) return;
      const name = reason instanceof DOMException ? reason.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setError('Camera permission was denied. Allow camera access in the browser address bar, then try again.');
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setError('No camera was found. Connect a webcam or choose a JPG or JPEG photo.');
      } else if (name === 'NotReadableError' || name === 'TrackStartError') {
        setError('The camera is busy in another app. Close that app and try again.');
      } else {
        setError('Could not start the camera. Check browser permission and try again.');
      }
    } finally {
      if (requestId === requestIdRef.current) setStarting(false);
    }
  }, [refreshDevices]);

  useEffect(() => {
    void startCamera();
    const media = navigator.mediaDevices;
    const onDeviceChange = () => { void refreshDevices(); };
    media?.addEventListener?.('devicechange', onDeviceChange);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      requestIdRef.current += 1;
      media?.removeEventListener?.('devicechange', onDeviceChange);
      window.removeEventListener('keydown', onKeyDown);
      stopStream(streamRef.current);
      streamRef.current = null;
    };
  }, [refreshDevices, startCamera]);

  const capture = async () => {
    if (!videoRef.current) return;
    setCapturing(true);
    setError('');
    try {
      onCapture(await makePhoto(videoRef.current, subject));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not capture the photo. Try again.');
    } finally {
      setCapturing(false);
    }
  };

  return (
    <div className="camera-overlay">
      <section className="camera-dialog" role="dialog" aria-modal="true" aria-labelledby="camera-title">
        <header className="camera-header">
          <div>
            <h2 id="camera-title">Take {subject} photo</h2>
            <p>Position the face in the frame, then capture.</p>
          </div>
          <button type="button" className="camera-close" onClick={onClose} aria-label="Close camera">
            <X size={19} />
          </button>
        </header>

        {devices.length > 1 && (
          <label className="camera-select-label">
            Camera
            <select value={selectedDevice} onChange={(event) => void startCamera(event.target.value)}>
              {devices.map((device, index) => (
                <option key={device.deviceId || index} value={device.deviceId}>
                  {device.label || `Camera ${index + 1}`}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="camera-view">
          <video ref={videoRef} autoPlay playsInline muted aria-label="Live camera preview" />
          {starting && (
            <div className="camera-status"><LoaderCircle className="spin" size={20} /> Starting camera…</div>
          )}
          {!starting && !streamRef.current && !error && (
            <div className="camera-status">Camera preview is unavailable.</div>
          )}
        </div>
        {error && <p className="camera-error" role="alert">{error}</p>}

        <footer className="camera-actions">
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="primary" onClick={() => void capture()} disabled={starting || capturing || !streamRef.current}>
            {capturing ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}
            Capture photo
          </button>
        </footer>
      </section>
    </div>
  );
};
