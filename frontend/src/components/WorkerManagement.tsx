import React, { useState, useEffect } from 'react';
import {
  Users,
  UserPlus,
  Search,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  X,
  LoaderCircle,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { Worker } from '../types';
import { api, dateFmt } from '../api';

interface WorkerManagementProps {
  csrf: string;
  onNavigateRegister: () => void;
}

interface PageData {
  items: Worker[];
  page: number;
  page_size: number;
  total: number;
  active: number;
  inactive: number;
}

export const WorkerManagement: React.FC<WorkerManagementProps> = ({ csrf, onNavigateRegister }) => {
  const [data, setData] = useState<PageData | null>(null);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState('');
  const [suggestions, setSuggestions] = useState<{ worker_id: string; name: string; worker_no: string }[]>([]);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  const [modal, setModal] = useState<Worker | null>(null);

  const load = async () => {
    try {
      const d = await (
        await api(
          `/workers?page=${page}&page_size=25${selected ? '&name=' + encodeURIComponent(q) : ''}`,
          {},
          csrf
        )
      ).json();
      setData(d);
    } catch (e: any) {
      setErr(e.message || String(e));
    }
  };

  useEffect(() => {
    let active = true;
    if (!q) {
      setSuggestions([]);
      return;
    }
    api(`/workers/search?q=${encodeURIComponent(q)}`, {}, csrf)
      .then((r) => r.json())
      .then((v) => active && setSuggestions(v))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [csrf, q]);

  useEffect(() => {
    load();
  }, [csrf, page, selected]);

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

  const updateStatus = async (w: Worker, status: string) => {
    setData((d) =>
      d ? { ...d, items: d.items.map((x) => (x.worker_id === w.worker_id ? { ...x, status } : x)) } : null
    );
    try {
      await api(
        `/workers/${w.worker_id}/status`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        },
        csrf
      );
      setNotice('Worker status saved');
      await load();
    } catch (ex: any) {
      setErr(ex.message || String(ex));
      await load();
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
          <h1>Worker Management</h1>
          <p>Manage registered workers, review details, and maintain worker status.</p>
        </div>
        <button className="primary" onClick={onNavigateRegister}>
          <UserPlus size={16} /> Register worker
        </button>
      </header>

      <div className="stats">
        <div>
          <span>Total Workers</span>
          <b>{data?.total ?? '—'}</b>
        </div>
        <div>
          <span>Active Workers</span>
          <b>{data?.active ?? '—'}</b>
        </div>
        <div>
          <span>Inactive Workers</span>
          <b>{data?.inactive ?? '—'}</b>
        </div>
      </div>

      <section className="panel">
        <div className="filters">
          <label className="searchbox">
            <Search size={16} />
            <input
              placeholder="Filter by worker name"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setSelected('');
                setPage(1);
              }}
            />
            {q && (
              <button
                className="clear"
                onClick={() => {
                  setQ('');
                  setSelected('');
                }}
                aria-label="Clear filter"
              >
                <X size={15} />
              </button>
            )}
          </label>
          <span>{data?.total ?? 0} workers</span>
        </div>

        {q && suggestions.length > 0 && (
          <div className="suggestions">
            {suggestions.map((x) => (
              <button
                key={x.worker_id}
                onClick={() => {
                  setSelected(x.worker_id);
                  setQ(x.name);
                  setSuggestions([]);
                }}
              >
                {x.name}
                <small>{x.worker_no}</small>
              </button>
            ))}
          </div>
        )}

        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                {[
                  'Worker ID',
                  'Worker No.',
                  'Name',
                  'Contractor Name',
                  'Joining Date',
                  'Contact No.',
                  'Emergency Contact',
                  'Aadhaar No.',
                  'Photo',
                  'Status',
                  'Actions',
                ].map((x) => (
                  <th key={x}>{x}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!data ? (
                <tr>
                  <td colSpan={11} className="empty">
                    <LoaderCircle className="spin" size={16} /> Loading worker records…
                  </td>
                </tr>
              ) : data.items.length === 0 ? (
                <tr>
                  <td colSpan={11} className="empty">No workers found.</td>
                </tr>
              ) : (
                data.items.map((w) => (
                  <tr key={w.worker_id}>
                    <td className="mono">{w.worker_id}</td>
                    <td className="mono">{w.worker_no}</td>
                    <td className="strong">{w.name}</td>
                    <td>{w.contractor_name}</td>
                    <td>{dateFmt(w.joining_date)}</td>
                    <td>{w.contact_no}</td>
                    <td>{w.emergency_contact}</td>
                    <td className="mono">{w.aadhaar_masked}</td>
                    <td>
                      <button className="thumb" onClick={() => setModal(w)}>
                        <img
                          src={w.photo_url}
                          alt={`${w.name} photo`}
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      </button>
                    </td>
                    <td>
                      <select
                        className={w.status === 'Active' ? 'status active' : 'status inactive'}
                        value={w.status}
                        onChange={(e) => updateStatus(w, e.target.value)}
                      >
                        <option>Active</option>
                        <option>Inactive</option>
                      </select>
                    </td>
                    <td>
                      <div className="actions">
                        <button title="View details" onClick={() => setModal(w)}>
                          <Eye size={16} />
                        </button>
                        <button title="Download ID card" onClick={() => download(w)}>
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
            Showing {data ? Math.min((page - 1) * 25 + 1, data.total) : 0}–
            {data ? Math.min(page * 25, data.total) : 0} of {data?.total ?? 0}
          </span>
          <div>
            <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
              <ChevronLeft size={16} />
            </button>
            <span>Page {page}</span>
            <button
              disabled={!data || page * 25 >= data.total}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </section>

      {modal && (
        <div className="overlay" onClick={() => setModal(null)}>
          <section className="detail" onClick={(e) => e.stopPropagation()}>
            <button className="close" onClick={() => setModal(null)}>
              <X size={18} />
            </button>
            <img className="detailphoto" src={modal.photo_url} alt={modal.name} />
            <div className="eyebrow">WORKER DETAILS</div>
            <h2>{modal.name}</h2>
            <p>{modal.contractor_name}</p>
            <dl>
              <dt>Worker No.</dt>
              <dd>{modal.worker_no}</dd>
              <dt>Worker ID</dt>
              <dd>{modal.worker_id}</dd>
              <dt>Joining Date</dt>
              <dd>{dateFmt(modal.joining_date)}</dd>
              <dt>Contact No.</dt>
              <dd>{modal.contact_no}</dd>
              <dt>Emergency Contact</dt>
              <dd>{modal.emergency_contact}</dd>
              <dt>Aadhaar No.</dt>
              <dd>{modal.aadhaar_masked}</dd>
              <dt>Status</dt>
              <dd>{modal.status}</dd>
            </dl>
            <button className="primary full" onClick={() => download(modal)}>
              <Download size={16} /> Download ID Card PDF
            </button>
          </section>
        </div>
      )}
    </div>
  );
};
