import React from 'react';
import {
  Users,
  UserPlus,
  Shield,
  UserCheck,
  History,
  Coffee,
  BarChart3,
  LogOut,
  ShieldAlert,
  ShieldCheck,
  UtensilsCrossed,
} from 'lucide-react';
import { Role } from '../types';

export type NavPage =
  | 'workers'
  | 'register-worker'
  | 'gate-scan'
  | 'visitors'
  | 'gate-history'
  | 'canteen-scan'
  | 'canteen-history';

interface NavbarProps {
  page: NavPage;
  setPage: (p: NavPage) => void;
  username: string;
  role: Role;
  onLogout: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ page, setPage, username, role, onLogout }) => {
  const roleLabel =
    role === 'ADMIN'
      ? 'Administrator'
      : role === 'GATE'
      ? 'Gate Security'
      : 'Canteen Staff';

  const roleIcon =
    role === 'ADMIN' ? (
      <ShieldCheck size={14} />
    ) : role === 'GATE' ? (
      <Shield size={14} />
    ) : (
      <UtensilsCrossed size={14} />
    );

  return (
    <aside className="nav">
      <img src="/assets/abb-logo.svg" className="logo" alt="ABB" />
      <div className="brand">
        ABB Workforce360
        <span>Plant 3 Access & Services</span>
      </div>

      <div className="role-chip">
        {roleIcon}
        <span>{roleLabel}</span>
      </div>

      {(role === 'ADMIN' || role === 'GATE') && (
        <>
          <div className="navlabel">GATE & VISITOR</div>
          <button
            className={page === 'gate-scan' ? 'navitem active' : 'navitem'}
            onClick={() => setPage('gate-scan')}
          >
            <Shield size={17} />
            Gate Management
          </button>
          <button
            className={page === 'visitors' ? 'navitem active' : 'navitem'}
            onClick={() => setPage('visitors')}
          >
            <UserCheck size={17} />
            Visitor Registration
          </button>
          <button
            className={page === 'gate-history' ? 'navitem active' : 'navitem'}
            onClick={() => setPage('gate-history')}
          >
            <History size={17} />
            Gate Transactions
          </button>
        </>
      )}

      {(role === 'ADMIN' || role === 'CANTEEN') && (
        <>
          <div className="navlabel">CANTEEN</div>
          <button
            className={page === 'canteen-scan' ? 'navitem active' : 'navitem'}
            onClick={() => setPage('canteen-scan')}
          >
            <Coffee size={17} />
            Canteen Scanner
          </button>
          <button
            className={page === 'canteen-history' ? 'navitem active' : 'navitem'}
            onClick={() => setPage('canteen-history')}
          >
            <BarChart3 size={17} />
            Canteen Reports
          </button>
        </>
      )}

      {role === 'ADMIN' && (
        <>
          <div className="navlabel">WORKFORCE RECORDS</div>
          <button
            className={page === 'workers' ? 'navitem active' : 'navitem'}
            onClick={() => setPage('workers')}
          >
            <Users size={17} />
            Worker Management
          </button>
          <button
            className={page === 'register-worker' ? 'navitem active' : 'navitem'}
            onClick={() => setPage('register-worker')}
          >
            <UserPlus size={17} />
            Worker Registration
          </button>
        </>
      )}

      <div className="navbottom">
        <div className="navuser">
          <b>{username}</b>
          <small>{role}</small>
        </div>
        <button title="Sign out" onClick={onLogout} className="logout-btn">
          <LogOut size={16} />
        </button>
      </div>
    </aside>
  );
};
