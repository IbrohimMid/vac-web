// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { WorkspaceLayout } from './WorkspaceLayout';

function renderLayout() {
  return render(
    <WorkspaceLayout
      explorer={<div data-testid="explorer-slot">Explorer</div>}
      center={<div data-testid="center-slot">Center</div>}
      agent={<div data-testid="agent-slot">Agent</div>}
    />,
  );
}

describe('WorkspaceLayout mobile tab bar', () => {
  afterEach(cleanup);

  it('renders all three pane sections and mobile nav', () => {
    renderLayout();
    expect(screen.getByLabelText('Project explorer')).toBeInTheDocument();
    expect(screen.getByLabelText('Code workspace primary')).toBeInTheDocument();
    expect(screen.getByLabelText('Agent thread')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Mobile workspace tabs' })).toBeInTheDocument();
  });

  it('defaults to Code (center) tab selected', () => {
    renderLayout();
    expect(screen.getByRole('button', { name: 'Code' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Explorer' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('button', { name: 'Task' })).toHaveAttribute('aria-selected', 'false');
  });

  it('body carries data-mobile-tab=center by default', () => {
    renderLayout();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const body = document.querySelector('.codeworkspace-body')!;
    expect(body).toHaveAttribute('data-mobile-tab', 'center');
  });

  it('switches to Explorer tab and updates aria-selected + data-mobile-tab', () => {
    renderLayout();
    fireEvent.click(screen.getByRole('button', { name: 'Explorer' }));
    expect(screen.getByRole('button', { name: 'Explorer' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Code' })).toHaveAttribute('aria-selected', 'false');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(document.querySelector('.codeworkspace-body')!).toHaveAttribute('data-mobile-tab', 'explorer');
  });

  it('switches to Task (agent) tab', () => {
    renderLayout();
    fireEvent.click(screen.getByRole('button', { name: 'Task' }));
    expect(screen.getByRole('button', { name: 'Task' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Code' })).toHaveAttribute('aria-selected', 'false');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(document.querySelector('.codeworkspace-body')!).toHaveAttribute('data-mobile-tab', 'agent');
  });
});
