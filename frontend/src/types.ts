export type Role = 'ADMIN' | 'GATE' | 'CANTEEN';

export interface UserSession {
  username: string;
  role: Role;
  csrf_token: string;
}

export interface Worker {
  worker_id: string;
  worker_no: string;
  name: string;
  contractor_name: string;
  joining_date: string;
  contact_no: string;
  emergency_contact: string;
  aadhaar_masked: string;
  photo_url: string;
  status: string;
}

export interface Visitor {
  visitor_id: string;
  visitor_no: string;
  name: string;
  company_name: string;
  location: string;
  host: string;
  purpose: string;
  contact_no: string;
  aadhaar_masked: string;
  photo_url?: string | null;
  registration_timestamp: string;
  expiration_timestamp: string;
  status: string;
}

export interface GateScanPerson {
  person_type: 'WORKER' | 'VISITOR';
  person_id: string;
  name: string;
  detail: string;
  worker_no?: string;
  visitor_no?: string;
  photo_url?: string | null;
  status: string;
}

export interface GateScanResult {
  accepted: boolean;
  event_type?: 'ENTRY' | 'EXIT' | null;
  reason: string;
  person?: GateScanPerson | null;
  entry_time?: string | null;
  remaining_seconds?: number | null;
  transaction_id?: number | null;
}

export interface GateTransaction {
  id: number;
  event_date: string;
  scan_timestamp: string;
  person_id: string;
  person_type: 'WORKER' | 'VISITOR' | 'UNKNOWN';
  event_type: 'ENTRY' | 'EXIT' | null;
  barcode_scanned: string;
  validation_result: 'ACCEPTED' | 'REJECTED';
  rejection_reason?: string | null;
  operator_id?: number | null;
}

export interface CanteenScanResult {
  accepted: boolean;
  reason: string;
  person?: {
    person_id: string;
    name: string;
    worker_no: string;
    detail: string;
    photo_url: string;
  } | null;
  gate_entry_time?: string | null;
  transaction_id?: number | null;
}

export interface CanteenTransaction {
  id: number;
  worker_id: string;
  business_date: string;
  scan_timestamp: string;
  gate_entry_id?: number | null;
  operator_id?: number | null;
  scan_result: 'ACCEPTED' | 'REJECTED';
  rejection_reason?: string | null;
}

export interface CanteenReport {
  date: string;
  total_scans: number;
  successful_scans: number;
  unique_workers: number;
  rejected_scans: number;
  duplicate_attempts: number;
  no_gate_entry: number;
  transactions: CanteenTransaction[];
}

export interface GateReport {
  date: string;
  total_transactions: number;
  accepted_entries: number;
  accepted_exits: number;
  rejected: number;
  unique_persons: number;
  transactions: GateTransaction[];
}
