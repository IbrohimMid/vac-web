// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AuditTrail, useAuditEntryCount } from './AuditTrail';
import { useAudit } from '../../stores/audit';

describe('<AuditTrail/>', () => {
  beforeEach(() => useAudit.setState({ entries: [] }));
  afterEach(() => cleanup());

  it('renders the empty state when no entries exist', () => {
    render(<AuditTrail />);
    expect(screen.getByTestId('audit-trail-empty')).toBeInTheDocument();
    expect(screen.getByText(/No audit entries yet/i)).toBeInTheDocument();
  });

  it('renders bridge + user entries in newest-first order', () => {
    useAudit.getState().append({ source: 'user', kind: 'user.approve', summary: 'You approved req-1', requestId: 'req-1', status: 'approved' });
    useAudit.getState().append({ source: 'bridge', kind: 'bridge.mutation.applied', summary: 'Bridge applied req-1', requestId: 'req-1', status: 'applied', detail: 'src/foo.ts' });
    render(<AuditTrail />);
    const rows = screen.getAllByTestId('audit-trail-entry');
    expect(rows.length).toBe(2);
    expect(rows[0]).toHaveAttribute('data-source', 'bridge');
    expect(rows[1]).toHaveAttribute('data-source', 'user');
    expect(rows[0]?.textContent).toContain('Bridge applied req-1');
    expect(rows[0]?.textContent).toContain('src/foo.ts');
    expect(rows[1]?.textContent).toContain('You approved req-1');
  });

  it('filterRequestId restricts visible entries', () => {
    useAudit.getState().append({ source: 'user', kind: 'user.approve', summary: 'a', requestId: 'req-A' });
    useAudit.getState().append({ source: 'bridge', kind: 'bridge.mutation.applied', summary: 'b', requestId: 'req-B' });
    useAudit.getState().append({ source: 'bridge', kind: 'bridge.mutation.applied', summary: 'c', requestId: 'req-A' });
    render(<AuditTrail filterRequestId="req-A" />);
    const rows = screen.getAllByTestId('audit-trail-entry');
    expect(rows.length).toBe(2);
    rows.forEach((row) => expect(row).toHaveAttribute('data-request-id', 'req-A'));
  });

  it('limit caps visible entries even when more exist', () => {
    for (let i = 0; i < 5; i += 1) {
      useAudit.getState().append({ source: 'system', kind: 'noise', summary: `n${i}` });
    }
    render(<AuditTrail limit={2} />);
    expect(screen.getAllByTestId('audit-trail-entry').length).toBe(2);
  });

  it('renders error code filter chips with counts when showErrorCodeFilter is on (B11)', () => {
    useAudit.getState().append({ source: 'bridge', kind: 'bridge.mutation.failed', summary: 'a', requestId: 'r1', status: 'failed', errorCode: 'shell.deny' });
    useAudit.getState().append({ source: 'bridge', kind: 'bridge.mutation.failed', summary: 'b', requestId: 'r2', status: 'failed', errorCode: 'shell.deny' });
    useAudit.getState().append({ source: 'bridge', kind: 'bridge.mutation.failed', summary: 'c', requestId: 'r3', status: 'failed', errorCode: 'fs.out_of_root' });
    render(<AuditTrail showErrorCodeFilter />);
    const shellChip = screen.getByTestId('audit-trail-filter-chip-shell.deny');
    const fsChip = screen.getByTestId('audit-trail-filter-chip-fs.out_of_root');
    expect(shellChip.textContent).toContain('shell.deny');
    expect(shellChip.textContent).toContain('2');
    expect(fsChip.textContent).toContain('1');
  });

  it('clicking a filter chip narrows the trail to that error code (B11)', () => {
    useAudit.getState().append({ source: 'bridge', kind: 'bridge.mutation.failed', summary: 'shell-row', requestId: 'r1', status: 'failed', errorCode: 'shell.deny' });
    useAudit.getState().append({ source: 'bridge', kind: 'bridge.mutation.failed', summary: 'fs-row', requestId: 'r2', status: 'failed', errorCode: 'fs.out_of_root' });
    render(<AuditTrail showErrorCodeFilter />);
    fireEvent.click(screen.getByTestId('audit-trail-filter-chip-shell.deny'));
    const rows = screen.getAllByTestId('audit-trail-entry');
    expect(rows.length).toBe(1);
    expect(rows[0]?.textContent).toContain('shell-row');
    expect(screen.getByTestId('audit-trail-filter-chip-shell.deny')).toHaveAttribute('aria-pressed', 'true');
  });

  it('clicking the clear button resets the filter (B11)', () => {
    useAudit.getState().append({ source: 'bridge', kind: 'bridge.mutation.failed', summary: 'a', requestId: 'r1', status: 'failed', errorCode: 'shell.deny' });
    useAudit.getState().append({ source: 'bridge', kind: 'bridge.mutation.applied', summary: 'ok', requestId: 'r2', status: 'applied' });
    render(<AuditTrail showErrorCodeFilter />);
    fireEvent.click(screen.getByTestId('audit-trail-filter-chip-shell.deny'));
    expect(screen.getAllByTestId('audit-trail-entry').length).toBe(1);
    fireEvent.click(screen.getByTestId('audit-trail-filter-clear'));
    expect(screen.getAllByTestId('audit-trail-entry').length).toBe(2);
  });

  it('groupDeniedAttempts collapses consecutive same-errorCode entries into one group (B11)', () => {
    // Newest-first ordering: applied is pushed first (oldest), then 3 shell.deny.
    useAudit.getState().append({ source: 'bridge', kind: 'bridge.mutation.applied', summary: 'success', requestId: 'r0', status: 'applied' });
    useAudit.getState().append({ source: 'bridge', kind: 'bridge.mutation.failed', summary: 'denied a', requestId: 'r1', status: 'failed', errorCode: 'shell.deny' });
    useAudit.getState().append({ source: 'bridge', kind: 'bridge.mutation.failed', summary: 'denied b', requestId: 'r2', status: 'failed', errorCode: 'shell.deny' });
    useAudit.getState().append({ source: 'bridge', kind: 'bridge.mutation.failed', summary: 'denied c', requestId: 'r3', status: 'failed', errorCode: 'shell.deny' });
    render(<AuditTrail groupDeniedAttempts />);
    const groups = screen.getAllByTestId('audit-trail-group');
    expect(groups.length).toBe(1);
    expect(groups[0]).toHaveAttribute('data-count', '3');
    expect(groups[0]).toHaveAttribute('data-error-code', 'shell.deny');
    // The applied row stays flat (no errorCode → not grouped).
    const flat = screen.getAllByTestId('audit-trail-entry').filter((row) => row.getAttribute('data-error-code') === '');
    expect(flat.length).toBe(1);
    expect(flat[0]?.textContent).toContain('success');
  });

  it('groupDeniedAttempts off renders consecutive same-errorCode entries as flat list (B11)', () => {
    useAudit.getState().append({ source: 'bridge', kind: 'bridge.mutation.failed', summary: 'a', requestId: 'r1', status: 'failed', errorCode: 'shell.deny' });
    useAudit.getState().append({ source: 'bridge', kind: 'bridge.mutation.failed', summary: 'b', requestId: 'r2', status: 'failed', errorCode: 'shell.deny' });
    render(<AuditTrail />);
    expect(screen.queryAllByTestId('audit-trail-group').length).toBe(0);
    expect(screen.getAllByTestId('audit-trail-entry').length).toBe(2);
  });
});

describe('useAuditEntryCount', () => {
  beforeEach(() => useAudit.setState({ entries: [] }));
  afterEach(() => cleanup());

  it('reflects the current entry count', () => {
    useAudit.getState().append({ source: 'system', kind: 'x', summary: 'y' });
    useAudit.getState().append({ source: 'system', kind: 'x', summary: 'z' });
    function Probe() { const n = useAuditEntryCount(); return <span data-testid="probe">{n}</span>; }
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('2');
  });
});
