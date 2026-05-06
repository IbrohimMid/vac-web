// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useRelease } from '../../stores/release';
import { NotesDraftView } from './NotesDraftView';

const reset = () => useRelease.getState().clear();

describe('NotesDraftView', () => {
  beforeEach(reset);
  afterEach(() => {
    cleanup();
    reset();
  });

  it('renders nothing when there are no drafts', () => {
    const { container } = render(<NotesDraftView />);
    expect(container.firstChild).toBeNull();
  });

  it('renders summary and markdown body when notes are present in the store', () => {
    const draft = {
      id: 'n1',
      target_id: 't_prod',
      commit_range: 'abc..def',
      markdown: '# Heading\nbody',
    };
    useRelease.setState({
      notes: new Map([
        ['n1', draft as unknown as ReturnType<typeof useRelease.getState>['notes'] extends Map<string, infer V> ? V : never],
      ]),
    });
    render(<NotesDraftView />);
    expect(screen.getByText(/abc\.\.def/)).toBeInTheDocument();
    expect(screen.getByText(/# Heading/)).toBeInTheDocument();
  });
});
