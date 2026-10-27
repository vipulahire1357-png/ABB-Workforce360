import React, { useState, useEffect, useRef } from 'react';
import {
  Scan,
  ShieldCheck,
  ShieldAlert,
  Clock,
  ArrowRightCircle,
  ArrowLeftCircle,
  User,
  Building,
  Volume2,
  VolumeX,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';
import { GateScanResult, GateTransaction, GateReport } from '../types';
import { api, timeFmt } from '../api';

interface GateScannerProps {
  csrf: string;
}

export const GateScanner: React.FC<GateScannerProps> = ({ csrf }) => {
  const [barcode, setBarcode] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GateScanResult | null>(null);
  const [recent, setRecent] = useState<GateTransaction[]>([]);
  const [report, setReport] = useState<GateReport | null>(null);
  const [sound, setSound] = useState(true);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [scannerActive, setScannerActive] = useState(false);
  const scannerActivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scannerKeyTimes = useRef<number[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const trackScannerInput = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const now = Date.now();
    if (event.key === 'Enter') {
      const recentKeys = scannerKeyTimes.current.filter((time) => now - time < 1500);
      if (recentKeys.length >= 4 && recentKeys[recentKeys.length - 1] - recentKeys[0] < 500) {
        setScannerActive(true);
        if (scannerActivityTimer.current) clearTimeout(scannerActivityTimer.current);
        scannerActivityTimer.current = setTimeout(() => setScannerActive(false), 10000);
      }
      scannerKeyTimes.current = [];
      return;
    }
    if (event.key.length === 1) {
      scannerKeyTimes.current = [...scannerKeyTimes.current.filter((time) => now - time < 1500), now];
    }
  };

  // Play synthesized audio cues
  const playSound = (accepted: boolean) => {
    if (!sound) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (accepted) {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
        osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
        osc.start();
        osc.stop(ctx.currentTime + 0.25);
      } else {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, ctx.currentTime); // A3
        osc.frequency.setValueAtTime(164.81, ctx.currentTime + 0.12); // E3
        gain.gain.setValueAtTime(0.25, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
      }
    } catch {
      // Audio not supported or blocked
    }
  };

  const loadMetrics = async () => {
    try {
      const res = await api('/gate/report', {}, csrf);
      const data: GateReport = await res.json();
      setReport(data);
      if (data.transactions) {
        setRecent(data.transactions.slice(-10).reverse());
      }
    } catch {
      // silent fail
    }
  };

  useEffect(() => {
    loadMetrics();
    inputRef.current?.focus();
  }, [csrf]);

  // Countdown timer for 10-minute cooldown
  useEffect(() => {
    if (!result?.remaining_seconds || result.remaining_seconds <= 0) {
      setCountdown(null);
      return;
    }
    setCountdown(result.remaining_seconds);
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [result]);

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = barcode.trim();
    if (!code || busy) return;

    setBusy(true);
    try {
      const res = await api('/gate/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode: code }),
      }, csrf);
      const data: GateScanResult = await res.json();
      setResult(data);
      playSound(data.accepted);
      setBarcode('');
      await loadMetrics();
    } catch (err: any) {
      setResult({
        accepted: false,
        reason: err.message || 'Scan processing failed',
      });
      playSound(false);
    } finally {
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const formatCountdown = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;
  };

  const onSiteCount = report
    ? Math.max(0, report.accepted_entries - report.accepted_exits)
    : 0;

  return (
    <div className="module-wrap">
      <header className="pagehead">
        <div>
          <div className="eyebrow">ABB PLANT 3 · ACCESS CONTROL</div>
          <h1>Gate Management & Scanning</h1>
          <p>Instant barcode verification for workers and registered visitors.</p>
        </div>
        <div className="head-actions">
          <button
            type="button"
            className="secondary sound-toggle"
            onClick={() => setSound(!sound)}
            title={sound ? 'Mute audio' : 'Unmute audio'}
          >
            {sound ? <Volume2 size={16} /> : <VolumeX size={16} />}
            <span>{sound ? 'Sound On' : 'Muted'}</span>
          </button>
        </div>
      </header>

      {/* Metrics Row */}
      <div className="stats stats-4">
        <div>
          <span>Total Scans Today</span>
          <b>{report?.total_transactions ?? '—'}</b>
        </div>
        <div className="stat-green">
          <span>Entries Today</span>
          <b>{report?.accepted_entries ?? '—'}</b>
        </div>
        <div className="stat-blue">
          <span>Exits Today</span>
          <b>{report?.accepted_exits ?? '—'}</b>
        </div>
        <div className="stat-highlight">
          <span>Estimated On-Site</span>
          <b>{onSiteCount}</b>
        </div>
      </div>

      <div className="scanner-layout">
        {/* Left Column: Scanner input and feedback */}
        <div className="scanner-main">
          <form className="scan-box-panel" onSubmit={handleScan}>
            <div className="scan-input-wrap">
              <Scan className="scan-icon" size={24} />
              <input
                ref={inputRef}
                type="text"
                className="scan-input"
                placeholder="Scan ID barcode or enter ID (WIR-... / VIS-...)"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                onKeyDown={trackScannerInput}
                autoFocus
                disabled={busy}
              />
              <button
                type="submit"
                className="primary scan-btn"
                disabled={busy || !barcode.trim()}
              >
                Verify
              </button>
            </div>
            <div className="scan-hint">
              Press Enter or scan with a hardware barcode scanner.
              <span className={`scanner-connection ${scannerActive ? 'active' : ''}`} role="status" aria-live="polite">
                <span className="scanner-connection-dot" />
                {scannerActive ? 'USB scanner active' : 'No USB scanner activity detected'}
              </span>
            </div>
          </form>

          {/* Result Card */}
          {result && (
            <div
              className={`result-card ${
                result.accepted
                  ? result.event_type === 'ENTRY'
                    ? 'result-entry'
                    : 'result-exit'
                  : 'result-rejected'
              }`}
            >
              <div className="result-header">
                <div className="result-badge">
                  {result.accepted ? (
                    result.event_type === 'ENTRY' ? (
                      <>
                        <ArrowRightCircle size={28} />
                        <div>
                          <h2>GATE ENTRY APPROVED</h2>
                          <span>Access Granted · ABB Plant 3</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <ArrowLeftCircle size={28} />
                        <div>
                          <h2>GATE EXIT APPROVED</h2>
                          <span>Departure Recorded</span>
                        </div>
                      </>
                    )
                  ) : (
                    <>
                      <ShieldAlert size={28} />
                      <div>
                        <h2>ACCESS REJECTED</h2>
                        <span>
                          {result.reason === 'NOT_YET_ELIGIBLE'
                            ? '10-Minute Minimum Cooldown Active'
                            : result.reason === 'ALREADY_COMPLETED'
                            ? 'Pair Already Completed Today'
                            : result.reason === 'WORKER_INACTIVE'
                            ? 'Worker Account is Inactive'
                            : result.reason === 'VISITOR_INACTIVE'
                            ? 'Visitor Pass is Inactive'
                            : result.reason === 'VISITOR_EXPIRED'
                            ? 'Visitor Pass has Expired'
                            : 'Unrecognized ID or Barcode'}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Cooldown Timer Alert */}
              {countdown !== null && countdown > 0 && (
                <div className="cooldown-banner">
                  <Clock size={20} className="spin-slow" />
                  <div>
                    <b>Wait Required Before Exit</b>
                    <p>Minimum 10-minute on-site rule. Eligible in {formatCountdown(countdown)}.</p>
                  </div>
                </div>
              )}

              {/* Person Profile */}
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
                    <div className="person-badges">
                      <span className={`pill-type ${result.person.person_type.toLowerCase()}`}>
                        {result.person.person_type}
                      </span>
                      <span className={`pill-status ${result.person.status.toLowerCase()}`}>
                        {result.person.status}
                      </span>
                    </div>

                    <h3>{result.person.name}</h3>
                    <div className="person-detail">
                      <Building size={14} />
                      <span>{result.person.detail}</span>
                    </div>

                    <div className="person-meta">
                      {result.person.worker_no && (
                        <span>Worker No: <b>{result.person.worker_no}</b></span>
                      )}
                      {result.person.visitor_no && (
                        <span>Visitor No: <b>{result.person.visitor_no}</b></span>
                      )}
                      {result.entry_time && (
                        <span>Entry Time: <b>{timeFmt(result.entry_time)}</b></span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Column: Live recent scan activity */}
        <div className="scanner-feed">
          <div className="panel feed-panel">
            <div className="feed-header">
              <h3>Recent Gate Activity</h3>
              <button
                type="button"
                className="secondary btn-sm"
                onClick={loadMetrics}
                title="Refresh feed"
              >
                <RotateCcw size={13} />
              </button>
            </div>

            <div className="feed-list">
              {recent.length === 0 ? (
                <div className="feed-empty">No scans recorded today yet.</div>
              ) : (
                recent.map((tx) => (
                  <div key={tx.id} className={`feed-item ${tx.validation_result.toLowerCase()}`}>
                    <div className="feed-item-left">
                      <span className={`feed-badge ${tx.event_type?.toLowerCase() || 'err'}`}>
                        {tx.event_type || 'REJ'}
                      </span>
                      <div>
                        <b>{tx.person_id}</b>
                        <small>{tx.person_type} · {timeFmt(tx.scan_timestamp)}</small>
                      </div>
                    </div>
                    <div className="feed-item-right">
                      <span className={`status-pill ${tx.validation_result.toLowerCase()}`}>
                        {tx.validation_result}
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
