export const api = async (path: string, init: RequestInit = {}, csrf = '') => {
  const headers = new Headers(init.headers);
  if (csrf) {
    headers.set('X-WIR-CSRF', csrf);
  }
  const r = await fetch('/api' + path, { ...init, headers, credentials: 'include' });
  if (!r.ok) {
    let msg = 'Request failed';
    try {
      const err = await r.json();
      msg = err.detail || msg;
    } catch {
      // ignore json parse errors
    }
    throw new Error(typeof msg === 'string' ? msg : 'Please check the entered details');
  }
  return r;
};

export const dateFmt = (s?: string | null) => {
  if (!s) return '—';
  try {
    const parts = s.split('T')[0].split('-');
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return new Date(s).toLocaleDateString('en-GB');
  } catch {
    return s;
  }
};

export const localDateInput = (date = new Date()) => {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export const timeFmt = (s?: string | null) => {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return s;
  }
};

export const dateTimeFmt = (s?: string | null) => {
  if (!s) return '—';
  return `${dateFmt(s)} ${timeFmt(s)}`;
};
