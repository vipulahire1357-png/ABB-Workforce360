import React, { useState, useRef, FormEvent } from 'react';
import {
  UserPlus,
  Download,
  RotateCcw,
  Camera,
  Upload,
  LoaderCircle,
  CheckCircle2,
  AlertCircle,
  X,
} from 'lucide-react';
import { Worker } from '../types';
import { api } from '../api';
import { PhotoCapture } from './PhotoCapture';
import { PhotoCrop } from './PhotoCrop';

interface WorkerRegistrationProps {
  csrf: string;
}

export const WorkerRegistration: React.FC<WorkerRegistrationProps> = ({ csrf }) => {
  const [form, setForm] = useState({
    name: '',
    contractor_name: '',
    joining_date: '',
    contact_no: '',
    emergency_contact: '',
    aadhaar_no: '',
  });
  const [photo, setPhoto] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [result, setResult] = useState<Worker | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const fileChange = (f?: File) => {
    setErr('');
    if (preview) URL.revokeObjectURL(preview);
    setPhoto('');
    setPhotoFile(null);
    setCropFile(null);
    setPreview('');
    if (!f) return;
    if (!['image/jpeg', 'image/jpg'].includes(f.type) || !/\.jpe?g$/i.test(f.name)) {
      setErr('Select a JPG or JPEG image');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    if (f.size > 200 * 1024) {
      setErr('Photo must be 200 KB or smaller');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setPhoto(f.name);
    setPhotoFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!photoFile) {
      setErr('Choose a passport-size photo');
      return;
    }
    setBusy(true);
    setErr('');
    setNotice('');

    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => fd.append(k, v));
    fd.append('photo', photoFile);

    try {
      const v = await (await api('/workers', { method: 'POST', body: fd }, csrf)).json();
      setResult(v);
      setNotice('Worker registered successfully');
    } catch (ex: any) {
      setErr(ex.message || String(ex));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setForm({
      name: '',
      contractor_name: '',
      joining_date: '',
      contact_no: '',
      emergency_contact: '',
      aadhaar_no: '',
    });
    if (fileRef.current) fileRef.current.value = '';
    setPhotoFile(null);
    setCropFile(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview('');
    setPhoto('');
    setResult(null);
    setErr('');
  };

  const download = async (w: Worker) => {
    try {
      const r = await api(`/workers/${w.worker_id}/id-card`, {}, csrf);
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${w.worker_no}.pdf`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (ex: any) {
      setErr(ex.message || String(ex));
    }
  };

  return (
    <div className="module-wrap">
      {err && (
        <div className="toast error">
          <AlertCircle size={17} />
          {err}
          <button onClick={() => setErr('')}><X size={15} /></button>
        </div>
      )}
      {notice && (
        <div className="toast success">
          <CheckCircle2 size={17} />
          {notice}
          <button onClick={() => setNotice('')}><X size={15} /></button>
        </div>
      )}

      <header className="pagehead">
        <div>
          <div className="eyebrow">WIR / WORKERS</div>
          <h1>Worker Registration</h1>
          <p>Register a worker and issue their ABB Plant 3 identity card.</p>
        </div>
      </header>

      {result ? (
        <section className="successbox">
          <CheckCircle2 size={27} />
          <h2>Worker registered</h2>
          <p>{result.name} has been added as an active worker.</p>
          <div className="idchips">
            <span>Worker No. <b>{result.worker_no}</b></span>
            <span>Worker ID <b>{result.worker_id}</b></span>
          </div>
          <div className="rowactions">
            <button className="primary" onClick={() => download(result)}>
              <Download size={16} /> Download ID Card PDF
            </button>
            <button className="secondary" onClick={() => { reset(); setNotice(''); }}>
              <UserPlus size={16} /> Register another worker
            </button>
          </div>
        </section>
      ) : (
        <form className="panel formpanel" onSubmit={submit}>
          <div className="formsection">
            <h2>Worker details</h2>
            <p>Enter the worker’s registered information. Required fields are marked <em>*</em>.</p>
            <div className="grid">
              <label>
                Worker Name <em>*</em>
                <input
                  required
                  maxLength={120}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Full name as on records"
                />
              </label>
              <label>
                Contractor Name <em>*</em>
                <input
                  required
                  maxLength={120}
                  value={form.contractor_name}
                  onChange={(e) => setForm({ ...form, contractor_name: e.target.value })}
                  placeholder="Contractor or company"
                />
              </label>
              <label>
                Joining Date <em>*</em>
                <input
                  type="date"
                  required
                  value={form.joining_date}
                  onChange={(e) => setForm({ ...form, joining_date: e.target.value })}
                />
              </label>
              <label>
                Contact No. <em>*</em>
                <input
                  required
                  inputMode="tel"
                  value={form.contact_no}
                  onChange={(e) => setForm({ ...form, contact_no: e.target.value })}
                  placeholder="10-digit phone number"
                />
              </label>
              <label>
                Emergency Contact <em>*</em>
                <input
                  required
                  inputMode="tel"
                  value={form.emergency_contact}
                  onChange={(e) => setForm({ ...form, emergency_contact: e.target.value })}
                  placeholder="10-digit phone number"
                />
              </label>
              <label>
                Aadhaar No. <em>*</em>
                <input
                  required
                  inputMode="numeric"
                  maxLength={14}
                  value={form.aadhaar_no}
                  onChange={(e) => setForm({ ...form, aadhaar_no: e.target.value })}
                  placeholder="12-digit Aadhaar number"
                />
                <small>Stored encrypted and masked in worker records. Never printed on the card.</small>
              </label>
            </div>
          </div>

          <div className="formsection">
            <h2>Passport-size photo</h2>
            <p>Select any browser-supported photo. It will be cropped to the ID-card frame and compressed below 200 KB.</p>
            <div className="uploadrow">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const selected = e.target.files?.[0];
                  if (selected) setCropFile(selected);
                  e.currentTarget.value = '';
                }}
              />
              {preview && <img className="preview" src={preview} alt="Worker Preview" />}
              <span>{photo || 'No photo selected'}</span>
              <button
                type="button"
                className="secondary"
                onClick={() => setCameraOpen(true)}
              >
                <Camera size={15} /> Take photo
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => fileRef.current?.click()}
              >
                <Upload size={15} /> Choose photo
              </button>
            </div>
          </div>

          <div className="formfooter">
            <span>Worker No., Worker ID, and Active status are assigned automatically.</span>
            <button type="button" className="secondary" onClick={reset}>
              <RotateCcw size={15} /> Reset
            </button>
            <button className="primary" disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={16} /> : <UserPlus size={16} />}
              Register worker
            </button>
          </div>
        </form>
      )}
      {cameraOpen && (
        <PhotoCapture
          subject="worker"
          onCapture={(file) => {
            if (fileRef.current) fileRef.current.value = '';
            fileChange(file);
            setCameraOpen(false);
          }}
          onClose={() => setCameraOpen(false)}
        />
      )}
      {cropFile && (
        <PhotoCrop
          file={cropFile}
          subject="worker"
          onApply={(file) => { fileChange(file); setCropFile(null); }}
          onCancel={() => setCropFile(null)}
        />
      )}
    </div>
  );
};
