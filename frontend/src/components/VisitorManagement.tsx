import React, { useState, useEffect, useRef, FormEvent } from 'react';
import {
  UserPlus,
  Users,
  Search,
  Download,
  CheckCircle2,
  AlertCircle,
  LoaderCircle,
  Upload,
  RotateCcw,
  Camera,
  ChevronLeft,
  ChevronRight,
  X,
  Eye,
  Calendar,
  Building,
} from 'lucide-react';
import { Visitor } from '../types';
import { api, dateFmt, dateTimeFmt } from '../api';
import { PhotoCapture } from './PhotoCapture';
import { PhotoCrop } from './PhotoCrop';

interface VisitorManagementProps {
  csrf: string;
}

export const VisitorManagement: React.FC<VisitorManagementProps> = ({ csrf }) => {
  const [tab, setTab] = useState<'register' | 'list'>('register');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');

  // Form State
  const [form, setForm] = useState({
    name: '',
    company_name: '',
    location: '',
    host: '',
    purpose: '',
    contact_no: '',
    aadhaar_no: '',
  });
  const [photoName, setPhotoName] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [createdVisitor, setCreatedVisitor] = useState<Visitor | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // List State
  const [visitors, setVisitors] = useState<Visitor[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  const [inactiveCount, setInactiveCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [modalVisitor, setModalVisitor] = useState<Visitor | null>(null);

  const loadVisitors = async () => {
    try {
      const q = new URLSearchParams();
      q.set('page', page.toString());
      q.set('page_size', '20');
      if (searchQuery) q.set('name', searchQuery);
      if (statusFilter) q.set('status', statusFilter);

      const res = await api(`/visitors?${q.toString()}`, {}, csrf);
      const data = await res.json();
      setVisitors(data.items);
      setTotal(data.total);
      setActiveCount(data.active);
      setInactiveCount(data.inactive);
    } catch (e: any) {
      setErr(e.message || 'Failed to load visitors');
    }
  };

  useEffect(() => {
    if (tab === 'list') {
      loadVisitors();
    }
  }, [tab, page, statusFilter]);

  const handlePhotoChange = (f?: File) => {
    setErr('');
    if (preview) URL.revokeObjectURL(preview);
    setPhotoName('');
    setPhotoFile(null);
    setCropFile(null);
    setPreview('');
    if (!f) return;

    if (!['image/jpeg', 'image/jpg'].includes(f.type) || !/\.jpe?g$/i.test(f.name)) {
      setErr('Photo must be a JPG or JPEG image');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    if (f.size > 200 * 1024) {
      setErr('Photo must be 200 KB or smaller');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setPhotoName(f.name);
    setPhotoFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    setNotice('');

    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => fd.append(k, v));
    if (photoFile) {
      fd.append('photo', photoFile);
    }

    try {
      const res = await api('/visitors', { method: 'POST', body: fd }, csrf);
      const data: Visitor = await res.json();
      setCreatedVisitor(data);
      setNotice('Visitor registered successfully. Pass is valid for today.');
    } catch (ex: any) {
      setErr(ex.message || 'Failed to register visitor');
    } finally {
      setBusy(false);
    }
  };

  const downloadCard = async (v: Visitor) => {
    try {
      const r = await api(`/visitors/${v.visitor_id}/id-card`, {}, csrf);
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${v.visitor_no}.pdf`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (ex: any) {
      setErr(ex.message || 'Failed to download visitor pass');
    }
  };

  const resetForm = () => {
    setForm({
      name: '',
      company_name: '',
      location: '',
      host: '',
      purpose: '',
      contact_no: '',
      aadhaar_no: '',
    });
    if (fileRef.current) fileRef.current.value = '';
    setPhotoFile(null);
    setCropFile(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview('');
    setPhotoName('');
    setCreatedVisitor(null);
    setErr('');
  };

  return (
    <div className="module-wrap">
      <header className="pagehead">
        <div>
          <div className="eyebrow">ABB PLANT 3 · VISITOR MANAGEMENT</div>
          <h1>Visitor Registration & Passes</h1>
          <p>Issue temporary daily visitor credentials and manage on-site guest records.</p>
        </div>
        <div className="tab-buttons">
          <button
            type="button"
            className={tab === 'register' ? 'primary' : 'secondary'}
            onClick={() => setTab('register')}
          >
            <UserPlus size={16} />
            New Visitor Pass
          </button>
          <button
            type="button"
            className={tab === 'list' ? 'primary' : 'secondary'}
            onClick={() => setTab('list')}
          >
            <Users size={16} />
            Visitor Directory ({total})
          </button>
        </div>
      </header>

      {notice && (
        <div className="toast success">
          <CheckCircle2 size={17} />
          {notice}
          <button onClick={() => setNotice('')}><X size={15} /></button>
        </div>
      )}
      {err && (
        <div className="toast error">
          <AlertCircle size={17} />
          {err}
          <button onClick={() => setErr('')}><X size={15} /></button>
        </div>
      )}

      {tab === 'register' ? (
        createdVisitor ? (
          <section className="successbox">
            <CheckCircle2 size={36} />
            <h2>Visitor Pass Issued</h2>
            <p>
              <b>{createdVisitor.name}</b> has been registered for visiting ABB Plant 3 today.
            </p>
            <div className="idchips">
              <span>Visitor No. <b>{createdVisitor.visitor_no}</b></span>
              <span>Visitor ID <b>{createdVisitor.visitor_id}</b></span>
              <span>Valid Until <b>Today 23:59</b></span>
            </div>
            <div className="rowactions">
              <button className="primary" onClick={() => downloadCard(createdVisitor)}>
                <Download size={16} /> Download Visitor Pass PDF
              </button>
              <button className="secondary" onClick={resetForm}>
                <UserPlus size={16} /> Register Another Visitor
              </button>
            </div>
          </section>
        ) : (
          <form className="panel formpanel" onSubmit={handleRegister}>
            <div className="formsection">
              <h2>Visitor Details</h2>
              <p>Enter guest details for single-day plant entry. All marked fields are mandatory.</p>
              <div className="grid">
                <label>
                  Visitor Full Name <em>*</em>
                  <input
                    required
                    maxLength={120}
                    placeholder="Full name as per official ID"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </label>
                <label>
                  Company / Organization <em>*</em>
                  <input
                    required
                    maxLength={120}
                    placeholder="Company or agency name"
                    value={form.company_name}
                    onChange={(e) => setForm({ ...form, company_name: e.target.value })}
                  />
                </label>
                <label>
                  Location / City <em>*</em>
                  <input
                    required
                    maxLength={120}
                    placeholder="Visitor origin (e.g. Vadodara, Bengaluru)"
                    value={form.location}
                    onChange={(e) => setForm({ ...form, location: e.target.value })}
                  />
                </label>
                <label>
                  ABB Host Employee <em>*</em>
                  <input
                    required
                    maxLength={120}
                    placeholder="Whom are they visiting at ABB?"
                    value={form.host}
                    onChange={(e) => setForm({ ...form, host: e.target.value })}
                  />
                </label>
                <label>
                  Purpose of Visit <em>*</em>
                  <input
                    required
                    maxLength={255}
                    placeholder="Reason (e.g. Audit, Vendor Meeting, Maintenance)"
                    value={form.purpose}
                    onChange={(e) => setForm({ ...form, purpose: e.target.value })}
                  />
                </label>
                <label>
                  Mobile Contact Number <em>*</em>
                  <input
                    required
                    type="tel"
                    inputMode="tel"
                    placeholder="10-digit mobile number"
                    value={form.contact_no}
                    onChange={(e) => setForm({ ...form, contact_no: e.target.value })}
                  />
                </label>
                <label>
                  Aadhaar / National ID No. <em>*</em>
                  <input
                    required
                    inputMode="numeric"
                    maxLength={14}
                    placeholder="12-digit Aadhaar number"
                    value={form.aadhaar_no}
                    onChange={(e) => setForm({ ...form, aadhaar_no: e.target.value })}
                  />
                  <small>Stored encrypted; only last 4 digits are shown in records.</small>
                </label>
              </div>
            </div>

            <div className="formsection">
              <h2>Visitor Photo (Optional)</h2>
              <p>Select any browser-supported photo. It will be cropped and compressed below 200 KB. A photo is optional.</p>
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
                {preview && <img className="preview" src={preview} alt="Visitor Preview" />}
                <span>{photoName || 'No photo chosen (optional)'}</span>
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
                  <Upload size={15} /> Choose Photo
                </button>
              </div>
            </div>

            <div className="formfooter">
              <span>Visitor passes automatically expire at 23:59:59 on the registration date.</span>
              <button type="button" className="secondary" onClick={resetForm}>
                <RotateCcw size={15} /> Reset
              </button>
              <button className="primary" disabled={busy}>
                {busy ? <LoaderCircle className="spin" size={16} /> : <UserPlus size={16} />}
                Issue Visitor Pass
              </button>
            </div>
          </form>
        )
      ) : (
        /* Visitor Directory List */
        <>
          <div className="stats stats-3">
            <div>
              <span>Total Visitors</span>
              <b>{total}</b>
            </div>
            <div className="stat-green">
              <span>Active Passes Today</span>
              <b>{activeCount}</b>
            </div>
            <div className="stat-gray">
              <span>Expired / Inactive</span>
              <b>{inactiveCount}</b>
            </div>
          </div>

          <section className="panel">
            <div className="filters">
              <div className="filter-group">
                <label className="searchbox">
                  <Search size={16} />
                  <input
                    placeholder="Search by visitor name..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setPage(1);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') loadVisitors();
                    }}
                  />
                  {searchQuery && (
                    <button
                      className="clear"
                      onClick={() => {
                        setSearchQuery('');
                        setPage(1);
                        setTimeout(loadVisitors, 10);
                      }}
                    >
                      <X size={14} />
                    </button>
                  )}
                </label>

                <select
                  className="select-filter"
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">All Statuses</option>
                  <option value="Active">Active Passes</option>
                  <option value="Inactive">Expired / Inactive</option>
                </select>
              </div>

              <span>{total} visitors</span>
            </div>

            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Visitor ID</th>
                    <th>Pass No.</th>
                    <th>Name</th>
                    <th>Company</th>
                    <th>Location</th>
                    <th>Host</th>
                    <th>Purpose</th>
                    <th>Contact</th>
                    <th>Aadhaar</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visitors.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="empty">
                        No visitor records found.
                      </td>
                    </tr>
                  ) : (
                    visitors.map((v) => (
                      <tr key={v.visitor_id}>
                        <td className="mono">{v.visitor_id}</td>
                        <td className="mono">{v.visitor_no}</td>
                        <td className="strong">{v.name}</td>
                        <td>{v.company_name}</td>
                        <td>{v.location}</td>
                        <td>{v.host}</td>
                        <td>{v.purpose}</td>
                        <td>{v.contact_no}</td>
                        <td className="mono">{v.aadhaar_masked}</td>
                        <td>
                          <span
                            className={
                              v.status === 'Active'
                                ? 'status-pill accepted'
                                : 'status-pill rejected'
                            }
                          >
                            {v.status}
                          </span>
                        </td>
                        <td>
                          <div className="actions">
                            <button
                              title="View details"
                              onClick={() => setModalVisitor(v)}
                            >
                              <Eye size={16} />
                            </button>
                            <button
                              title="Download Visitor Pass PDF"
                              onClick={() => downloadCard(v)}
                            >
                              <Download size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="pagination">
              <span>
                Showing {total ? Math.min((page - 1) * 20 + 1, total) : 0}–
                {total ? Math.min(page * 20, total) : 0} of {total}
              </span>
              <div>
                <button
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  <ChevronLeft size={16} />
                </button>
                <span>Page {page}</span>
                <button
                  disabled={page * 20 >= total}
                  onClick={() => setPage(page + 1)}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </section>
        </>
      )}

      {/* Visitor Detail Modal */}
      {modalVisitor && (
        <div className="overlay" onClick={() => setModalVisitor(null)}>
          <section className="detail" onClick={(e) => e.stopPropagation()}>
            <button className="close" onClick={() => setModalVisitor(null)}>
              <X size={18} />
            </button>
            {modalVisitor.photo_url ? (
              <img
                className="detailphoto"
                src={modalVisitor.photo_url}
                alt={modalVisitor.name}
              />
            ) : (
              <div className="detailphoto-placeholder">
                <Users size={36} />
              </div>
            )}
            <div className="eyebrow">VISITOR RECORD</div>
            <h2>{modalVisitor.name}</h2>
            <p>{modalVisitor.company_name} · {modalVisitor.location}</p>
            <dl>
              <dt>Pass No.</dt>
              <dd>{modalVisitor.visitor_no}</dd>
              <dt>Visitor ID</dt>
              <dd>{modalVisitor.visitor_id}</dd>
              <dt>ABB Host</dt>
              <dd>{modalVisitor.host}</dd>
              <dt>Purpose</dt>
              <dd>{modalVisitor.purpose}</dd>
              <dt>Contact</dt>
              <dd>{modalVisitor.contact_no}</dd>
              <dt>Aadhaar</dt>
              <dd>{modalVisitor.aadhaar_masked}</dd>
              <dt>Registered</dt>
              <dd>{dateTimeFmt(modalVisitor.registration_timestamp)}</dd>
              <dt>Status</dt>
              <dd>{modalVisitor.status}</dd>
            </dl>
            <button
              className="primary full"
              onClick={() => downloadCard(modalVisitor)}
            >
              <Download size={16} /> Download Visitor Pass PDF
            </button>
          </section>
        </div>
      )}
      {cameraOpen && (
        <PhotoCapture
          subject="visitor"
          onCapture={(file) => {
            if (fileRef.current) fileRef.current.value = '';
            handlePhotoChange(file);
            setCameraOpen(false);
          }}
          onClose={() => setCameraOpen(false)}
        />
      )}
      {cropFile && (
        <PhotoCrop
          file={cropFile}
          subject="visitor"
          onApply={(file) => { handlePhotoChange(file); setCropFile(null); }}
          onCancel={() => setCropFile(null)}
        />
      )}
    </div>
  );
};
