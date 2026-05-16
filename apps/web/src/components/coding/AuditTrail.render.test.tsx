// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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
