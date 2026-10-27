import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GateScanner } from './GateScanner';
import { CanteenScanner } from './CanteenScanner';

const response = (data: unknown) => ({ ok: true, json: async () => data }) as Response;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('barcode scanner input', () => {
  it('submits gate scans when a keyboard scanner sends Enter, even at a slow typing rate', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/gate/report')) {
        return response({ accepted_entries: 0, accepted_exits: 0, transactions: [] });
      }
      if (url.endsWith('/gate/scan')) {
        return response({
          accepted: true, event_type: 'ENTRY', reason: 'ENTRY_ACCEPTED',
          person: {
            person_type: 'WORKER', person_id: 'WIR-TEST', name: 'Test Worker',
            detail: 'Test Company', worker_no: 'ABB-P3-W-1', status: 'Active',
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<GateScanner csrf="test-csrf" />);
    const input = screen.getByPlaceholderText(/Scan ID barcode/i);
    fireEvent.change(input, { target: { value: 'wir-test' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    await waitFor(() => expect(screen.getByText('GATE ENTRY APPROVED')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith('/api/gate/scan', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ barcode: 'wir-test' }),
    }));
  });

  it('submits canteen scans when a keyboard scanner sends Enter', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/canteen/report')) {
        return response({ transactions: [], successful_scans: 0, unique_people: 0 });
      }
      if (url.endsWith('/canteen/scan')) {
        return response({
          accepted: true, reason: 'CANTEEN_SCAN_ACCEPTED',
          person: {
            person_type: 'VISITOR', person_id: 'VIS-TEST', name: 'Test Visitor',
            visitor_no: 'ABB-P3-V-1', detail: 'Test Company',
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<CanteenScanner csrf="test-csrf" />);
    const input = screen.getByPlaceholderText(/worker or visitor ID/i);
    fireEvent.change(input, { target: { value: 'vis-test' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    await waitFor(() => expect(screen.getByText('MEAL APPROVED')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith('/api/canteen/scan', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ barcode: 'vis-test' }),
    }));
  });
});
