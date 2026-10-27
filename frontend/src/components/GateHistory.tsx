import React, { useState, useEffect } from 'react';
import {
  Calendar,
  Filter,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  ShieldAlert,
  LoaderCircle,
  RotateCcw,
} from 'lucide-react';
import { GateTransaction } from '../types';
import { api, dateFmt, localDateInput, timeFmt } from '../api';

interface GateHistoryProps {
  csrf: string;
}

export const GateHistory: React.FC<GateHistoryProps> = ({ csrf }) => {
  const [items, setItems] = useState<GateTransaction[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [dateVal, setDateVal] = useState<string>(localDateInput());
  const [personType, setPersonType] = useState<string>('');
  const [resultFilter, setResultFilter] = useState<string>('');

  const loadData = async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      q.set('page', page.toString());
      q.set('page_size', '25');
      if (dateVal) q.set('event_date', dateVal);
      if (personType) q.set('person_type', personType);
      if (resultFilter) q.set('result', resultFilter);

      const res = await api(`/gate/transactions?${q.toString()}`, {}, csrf);
      const data = await res.json();
      setItems(data.items);
      setTotal(data.total);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [page, dateVal, personType, resultFilter]);

  return (
    <div className="module-wrap">
      <header className="pagehead">
        <div>
          <div className="eyebrow">ABB PLANT 3 · AUDIT & LOGS</div>
          <h1>Gate Transactions History</h1>
          <p>Complete historical log of all gate entry and exit verification scans.</p>
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

            <select
              className="select-filter"
              value={personType}
              onChange={(e) => {
                setPersonType(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All Person Types</option>
              <option value="WORKER">Workers Only</option>
              <option value="VISITOR">Visitors Only</option>
            </select>

            <select
              className="select-filter"
              value={resultFilter}
              onChange={(e) => {
                setResultFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All Scan Results</option>
              <option value="ACCEPTED">Accepted Only</option>
              <option value="REJECTED">Rejected Only</option>
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
                <th>Person ID</th>
                <th>Type</th>
                <th>Event</th>
                <th>Scanned Barcode</th>
                <th>Result</th>
                <th>Rejection Reason</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="empty">
                    <LoaderCircle className="spin" size={16} /> Loading transactions...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={9} className="empty">
                    No transactions match the selected filters.
                  </td>
                </tr>
              ) : (
                items.map((tx) => (
                  <tr key={tx.id}>
                    <td className="mono">#{tx.id}</td>
                    <td>{timeFmt(tx.scan_timestamp)}</td>
                    <td>{dateFmt(tx.event_date)}</td>
                    <td className="mono strong">{tx.person_id}</td>
                    <td>
                      <span className={`pill-type ${tx.person_type.toLowerCase()}`}>
                        {tx.person_type}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`feed-badge ${
                          tx.event_type?.toLowerCase() || 'err'
                        }`}
                      >
                        {tx.event_type || '—'}
                      </span>
                    </td>
                    <td className="mono">{tx.barcode_scanned}</td>
                    <td>
                      <span className={`status-pill ${tx.validation_result.toLowerCase()}`}>
                        {tx.validation_result}
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
