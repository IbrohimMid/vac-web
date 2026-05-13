// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Rail } from './Rail';
import { useCockpit } from '../../stores/cockpit';

describe('Rail accessibility', () => {
  beforeEach(() => useCockpit.setState({ railTab: 'Activity' }));
  afterEach(cleanup);

  it('uses a keyboardable tablist for cockpit rail navigation', () => {
    render(<Rail />);
    expect(screen.getByRole('tablist', { name: 'Cockpit rail sections' })).toBeInTheDocument();
    const activity = screen.getByRole('tab', { name: /Activity/i });
    expect(activity).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(activity, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: /Notify/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'rail-tab-notify');
  });
});
