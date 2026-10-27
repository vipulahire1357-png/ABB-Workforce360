import React, { useState, useEffect } from 'react';
import {
  Calendar,
  Filter,
  ChevronLeft,
  ChevronRight,
  UtensilsCrossed,
  ShieldAlert,
  LoaderCircle,
  RotateCcw,
} from 'lucide-react';
import { CanteenTransaction, CanteenReport } from '../types';
import { api, dateFmt, localDateInput, timeFmt } from '../api';

interface CanteenHistoryProps {
  csrf: string;
}

export const CanteenHistory: React.FC<CanteenHistoryProps> = ({ csrf }) => {
  const [items, setItems] = useState<CanteenTransaction[]>([]);
  const [report, setReport] = useState<CanteenReport | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [dateVal, setDateVal] = useState<string>(localDateInput());
  const [workerId, setWorkerId] = useState<string>('');
  const [resultFilter, setResultFilter] = useState<string>('');

  const loadData = async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      q.set('page', page.toString());
      q.set('page_size', '25');
      if (dateVal) q.set('business_date', dateVal);
      if (workerId) q.set('person_id', workerId.trim());
      if (resultFilter) q.set('result', resultFilter);

      const res = await api(`/canteen/transactions?${q.toString()}`, {}, csrf);
      const data = await res.json();
      setItems(data.items);
      setTotal(data.total);

      // Also fetch report metrics for the selected date
      const repRes = await api(`/canteen/report?report_date=${dateVal}`, {}, csrf);
      const repData = await repRes.json();
      setReport(repData);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [page, dateVal, resultFilter]);

  return (
    <div className="module-wrap">
      <header className="pagehead">
        <div>
          <div className="eyebrow">ABB PLANT 3 · CANTEEN AUDIT</div>
          <h1>Canteen Reports & History</h1>
          <p>Meal consumption records, duplicate attempt tracking, and daily reconciliation.</p>
        </div>
        <button
          type="button"
          className="secondary"
          onClick={loadData}
          title="Refresh table"
        >
          <RotateCcw size={15} /> Refresh
        </button>
      </header>

      {/* Summary row for selected date */}
      <div className="stats stats-4">
        <div>
          <span>Total Scans on {dateFmt(dateVal)}</span>
          <b>{report?.total_scans ?? '—'}</b>
        </div>
        <div className="stat-green">
          <span>Meals Served</span>
          <b>{report?.successful_scans ?? '—'}</b>
        </div>
        <div className="stat-orange">
          <span>Duplicate Blocks</span>
          <b>{report?.duplicate_attempts ?? '—'}</b>
        </div>
        <div className="stat-red">
          <span>No Gate Entry Blocks</span>
          <b>{report?.no_gate_entry ?? '—'}</b>
        </div>
      </div>

      <section className="panel">
        <div className="filters">
          <div className="filter-group">
            <label className="filter-label">
              <Calendar size={15} />
              <input
                type="date"
                className="date-input"
                value={dateVal}
                onChange={(e) => {
                  setDateVal(e.target.value);
                  setPage(1);
                }}
              />
            </label>

            <input
              type="text"
              className="text-filter"
              placeholder="Filter by Worker or Visitor ID..."
              value={workerId}
              onChange={(e) => setWorkerId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setPage(1);
                  loadData();
                }
              }}
            />

            <select
              className="select-filter"
              value={resultFilter}
              onChange={(e) => {
                setResultFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All Scan Results</option>
              <option value="ACCEPTED">Accepted Meals</option>
              <option value="REJECTED">Rejected Attempts</option>
            </select>
          </div>

          <span>{total} transactions found</span>
        </div>

        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Time</th>
                <th>Date</th>
                <th>Person Type</th>
                <th>Person ID</th>
                <th>Gate Entry Ref</th>
                <th>Scan Result</th>
                <th>Rejection Reason</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="empty">
                    <LoaderCircle className="spin" size={16} /> Loading canteen records...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="empty">
                    No canteen transactions found for the selected date/filter.
                  </td>
                </tr>
              ) : (
                items.map((tx) => (
                  <tr key={tx.id}>
                    <td className="mono">#{tx.id}</td>
                    <td>{timeFmt(tx.scan_timestamp)}</td>
                    <td>{dateFmt(tx.business_date)}</td>
                    <td>{tx.person_type ?? 'WORKER'}</td>
                    <td className="mono strong">{tx.person_id ?? tx.worker_id}</td>
                    <td className="mono">
                      {tx.gate_entry_id ? `#${tx.gate_entry_id}` : '—'}
                    </td>
                    <td>
                      <span className={`status-pill ${tx.scan_result.toLowerCase()}`}>
                        {tx.scan_result}
                      </span>
                    </td>
                    <td className="reason-cell">
                      {tx.rejection_reason ? (
                        <span className="badge-reason">{tx.rejection_reason}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="pagination">
          <span>
            Showing {total ? Math.min((page - 1) * 25 + 1, total) : 0}–
            {total ? Math.min(page * 25, total) : 0} of {total}
          </span>
          <div>
            <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
              <ChevronLeft size={16} />
            </button>
            <span>Page {page}</span>
            <button
              disabled={page * 25 >= total}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
