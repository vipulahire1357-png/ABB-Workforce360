import React, { useState, useEffect, FormEvent } from 'react';
import {
  ShieldCheck,
  AlertCircle,
  LoaderCircle,
} from 'lucide-react';
import { Role } from './types';
import { api } from './api';
import { Navbar, NavPage } from './components/Navbar';
import { WorkerManagement } from './components/WorkerManagement';
import { WorkerRegistration } from './components/WorkerRegistration';
import { GateScanner } from './components/GateScanner';
import { VisitorManagement } from './components/VisitorManagement';
import { GateHistory } from './components/GateHistory';
import { CanteenScanner } from './components/CanteenScanner';
import { CanteenHistory } from './components/CanteenHistory';

export default function App() {
  const [csrf, setCsrf] = useState('');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<Role>('ADMIN');
  const [page, setPage] = useState<NavPage>('workers');
  const [err, setErr] = useState('');

  // Restore session on mount if cookie is active
  useEffect(() => {
    api('/auth/me')
      .then((r) => r.json())
      .then((data) => {
        if (data.csrf_token && data.username) {
          setCsrf(data.csrf_token);
          setUsername(data.username);
          const r = (data.role || 'ADMIN') as Role;
          setRole(r);
          if (r === 'GATE') setPage('gate-scan');
          else if (r === 'CANTEEN') setPage('canteen-scan');
          else setPage('workers');
        }
      })
      .catch(() => {
        // Not logged in or expired
      });
  }, []);

  const login = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErr('');
    const fd = new FormData(e.currentTarget);
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          username: fd.get('username'),
          password: fd.get('password'),
        }),
      });
      if (!r.ok) {
        throw new Error('Invalid username or password');
      }
      const v = await r.json();
      setCsrf(v.csrf_token);
      setUsername(v.username);
      const userRole = (v.role || 'ADMIN') as Role;
      setRole(userRole);

      // Route to default page for user role
      if (userRole === 'GATE') {
        setPage('gate-scan');
      } else if (userRole === 'CANTEEN') {
        setPage('canteen-scan');
      } else {
        setPage('workers');
      }
    } catch (ex: any) {
      setErr(ex.message || String(ex));
    }
  };

  const logout = async () => {
    try {
      await api('/auth/logout', { method: 'POST' }, csrf);
    } catch {
      // ignore
    }
    setCsrf('');
    setUsername('');
    setRole('ADMIN');
    setPage('workers');
  };

  if (!csrf) {
    return (
      <main className="login-wrap">
        <form className="login" onSubmit={login}>
          <img src="/assets/abb-logo.svg" alt="ABB Logo" />
          <h1>ABB Workforce360</h1>
          <p>Sign in with your authorized portal credentials.</p>

          <label>
            Username
            <input name="username" required autoComplete="username" />
          </label>

          <label>
            Password
            <input type="password" name="password" required autoComplete="current-password" />
          </label>

          {err && (
            <div className="error">
              <AlertCircle size={16} />
              {err}
            </div>
          )}

          <button className="primary full" type="submit">
            <ShieldCheck size={16} /> Sign in
          </button>
          <small>Access is restricted to provisioned ABB Workforce360 operators.</small>
        </form>
      </main>
    );
  }

  return (
    <div className="shell">
      <Navbar
        page={page}
        setPage={setPage}
        username={username}
        role={role}
        onLogout={logout}
      />

      <main className="main">
        {page === 'workers' && (
          <WorkerManagement
            csrf={csrf}
            onNavigateRegister={() => setPage('register-worker')}
          />
        )}
        {page === 'register-worker' && (
          <WorkerRegistration csrf={csrf} />
        )}
        {page === 'gate-scan' && (
          <GateScanner csrf={csrf} />
        )}
        {page === 'visitors' && (
          <VisitorManagement csrf={csrf} />
        )}
        {page === 'gate-history' && (
          <GateHistory csrf={csrf} />
        )}
        {page === 'canteen-scan' && (
          <CanteenScanner csrf={csrf} />
        )}
        {page === 'canteen-history' && (
          <CanteenHistory csrf={csrf} />
        )}

        <footer className="footer">
          ABB Workforce360 <span>·</span> Plant 3 Operations & Services
        </footer>
      </main>
    </div>
  );
}
