import React, { useState, useEffect, useRef, FormEvent } from 'react';
import {
  UtensilsCrossed,
  CheckCircle2,
  AlertCircle,
  Volume2,
  VolumeX,
  Building,
  User,
  Clock,
  RotateCcw,
  ShieldAlert,
} from 'lucide-react';
import { CanteenScanResult, CanteenReport, CanteenTransaction } from '../types';
import { api, timeFmt } from '../api';

interface CanteenScannerProps {
  csrf: string;
}

export const CanteenScanner: React.FC<CanteenScannerProps> = ({ csrf }) => {
  const [barcode, setBarcode] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CanteenScanResult | null>(null);
  const [report, setReport] = useState<CanteenReport | null>(null);
  const [recent, setRecent] = useState<CanteenTransaction[]>([]);
  const [sound, setSound] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const playSound = (accepted: boolean) => {
    if (!sound) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (accepted) {
        // High upbeat bell
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
        osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.1); // E5
        osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.2); // G5
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
      } else {
        // Double low buzz
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(180, ctx.currentTime);
        gain.gain.setValueAtTime(0.25, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
        osc.start();
        osc.stop(ctx.currentTime + 0.25);
      }
    } catch {
      // Audio not supported
    }
  };

  const loadReport = async () => {
    try {
      const res = await api('/canteen/report', {}, csrf);
      const data: CanteenReport = await res.json();
      setReport(data);
      if (data.transactions) {
        setRecent(data.transactions.slice(-10).reverse());
      }
    } catch {
      // silent
    }
  };

  useEffect(() => {
    loadReport();
    inputRef.current?.focus();
  }, [csrf]);

  const handleScan = async (e: FormEvent) => {
    e.preventDefault();
    const code = barcode.trim();
    if (!code || busy) return;

    setBusy(true);
    try {
      const res = await api('/canteen/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode: code }),
      }, csrf);
      const data: CanteenScanResult = await res.json();
      setResult(data);
      playSound(data.accepted);
      setBarcode('');
      await loadReport();
    } catch (err: any) {
      setResult({
        accepted: false,
        reason: err.message || 'Scan verification failed',
      });
      playSound(false);
    } finally {
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  return (
    <div className="module-wrap">
      <header className="pagehead">
        <div>
          <div className="eyebrow">ABB PLANT 3 · CANTEEN SERVICES</div>
          <h1>Canteen Scan Management (CSM)</h1>
          <p>Meal eligibility verification: Gate entry validation and single daily meal policy.</p>
        </div>
        <div className="head-actions">
          <button
            type="button"
            className="secondary sound-toggle"
            onClick={() => setSound(!sound)}
            title={sound ? 'Mute sound' : 'Unmute sound'}
          >
            {sound ? <Volume2 size={16} /> : <VolumeX size={16} />}
            <span>{sound ? 'Sound On' : 'Muted'}</span>
          </button>
        </div>
      </header>

      {/* Metrics Row */}
      <div className="stats stats-4">
        <div className="stat-green">
          <span>Meals Served Today</span>
          <b>{report?.successful_scans ?? '—'}</b>
        </div>
        <div>
          <span>Unique Workers</span>
          <b>{report?.unique_workers ?? '—'}</b>
        </div>
        <div className="stat-orange">
          <span>Duplicates Prevented</span>
          <b>{report?.duplicate_attempts ?? '—'}</b>
        </div>
        <div className="stat-red">
          <span>No Gate Entry Blocks</span>
          <b>{report?.no_gate_entry ?? '—'}</b>
        </div>
      </div>

      <div className="scanner-layout">
        {/* Left Column: Rapid Scanner Input and Result */}
        <div className="scanner-main">
          <form className="scan-box-panel canteen-box" onSubmit={handleScan}>
            <div className="scan-input-wrap">
              <UtensilsCrossed className="scan-icon canteen-icon" size={24} />
              <input
                ref={inputRef}
                type="text"
                className="scan-input"
                placeholder="Scan Worker ID barcode (WIR-...)"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                autoFocus
                disabled={busy}
              />
              <button
                type="submit"
                className="primary scan-btn"
                disabled={busy || !barcode.trim()}
              >
                Scan Meal
              </button>
            </div>
            <div className="scan-hint">
              Optimized for fast barcode scanner input. Verifies gate check-in & 1-meal-per-day rule.
            </div>
          </form>

          {/* Result Card */}
          {result && (
            <div
              className={`result-card ${
                result.accepted ? 'result-canteen-accepted' : 'result-rejected'
              }`}
            >
              <div className="result-header">
                <div className="result-badge">
                  {result.accepted ? (
                    <>
                      <CheckCircle2 size={32} />
                      <div>
                        <h2>MEAL APPROVED</h2>
                        <span>Canteen scan accepted · Lunch recorded</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <ShieldAlert size={32} />
                      <div>
                        <h2>MEAL SCAN REJECTED</h2>
                        <span>
                          {result.reason === 'NO_GATE_ENTRY'
                            ? 'No Gate Entry Today — Worker must check in at security gate first'
                            : result.reason === 'ALREADY_SCANNED'
                            ? 'Already Scanned Today — 1 meal per worker policy'
                            : result.reason === 'WORKER_NOT_ELIGIBLE'
                            ? 'Worker Account is Inactive'
                            : result.reason === 'WORKER_NOT_FOUND'
                            ? 'Worker ID Not Found on Record'
                            : 'Scan Rejected'}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Gate Entry Reference Badge */}
              {result.gate_entry_time && (
                <div className="gate-entry-banner">
                  <Clock size={16} />
                  <span>
                    Verified Gate Entry: <b>{timeFmt(result.gate_entry_time)}</b> today
                  </span>
                </div>
              )}

              {/* Worker Profile */}
              {result.person && (
                <div className="result-person">
                  {result.person.photo_url ? (
                    <img
                      src={result.person.photo_url}
                      alt={result.person.name}
                      className="person-photo"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <div className="person-photo-placeholder">
                      <User size={32} />
                    </div>
                  )}

                  <div className="person-info">
                    <h3>{result.person.name}</h3>
                    <div className="person-detail">
                      <Building size={14} />
                      <span>{result.person.detail}</span>
                    </div>
                    <div className="person-meta">
                      <span>Worker No: <b>{result.person.worker_no}</b></span>
                      <span>Worker ID: <b>{result.person.person_id}</b></span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Column: Live recent canteen scans */}
        <div className="scanner-feed">
          <div className="panel feed-panel">
            <div className="feed-header">
              <h3>Recent Canteen Scans</h3>
              <button
                type="button"
                className="secondary btn-sm"
                onClick={loadReport}
                title="Refresh feed"
              >
                <RotateCcw size={13} />
              </button>
            </div>

            <div className="feed-list">
              {recent.length === 0 ? (
                <div className="feed-empty">No canteen scans recorded today yet.</div>
              ) : (
                recent.map((tx) => (
                  <div key={tx.id} className={`feed-item ${tx.scan_result.toLowerCase()}`}>
                    <div className="feed-item-left">
                      <span className={`feed-badge ${tx.scan_result.toLowerCase()}`}>
                        {tx.scan_result === 'ACCEPTED' ? 'MEAL' : 'REJ'}
                      </span>
                      <div>
                        <b>{tx.worker_id}</b>
                        <small>{timeFmt(tx.scan_timestamp)}</small>
                      </div>
                    </div>
                    <div className="feed-item-right">
                      <span className={`status-pill ${tx.scan_result.toLowerCase()}`}>
                        {tx.scan_result}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
