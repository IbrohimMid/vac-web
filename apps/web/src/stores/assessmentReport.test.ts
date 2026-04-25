import { beforeEach, describe, expect, it } from 'vitest';
import { useAssessmentReport } from './assessmentReport';

function reset() {
  useAssessmentReport.getState().clear();
}

describe('assessmentReport store', () => {
  beforeEach(reset);

  it('defaults', () => {
    const s = useAssessmentReport.getState();
    expect(s.reportRunId).toBeNull();
    expect(s.selectedFindingIds.size).toBe(0);
  });

  it('enterReport / exitReport flips runId', () => {
    useAssessmentReport.getState().enterReport('r1');
    expect(useAssessmentReport.getState().reportRunId).toBe('r1');
    useAssessmentReport.getState().exitReport();
    expect(useAssessmentReport.getState().reportRunId).toBeNull();
  });

  it('toggleFinding adds + removes id', () => {
    useAssessmentReport.getState().toggleFinding('f1');
    expect(useAssessmentReport.getState().selectedFindingIds.has('f1')).toBe(true);
    useAssessmentReport.getState().toggleFinding('f1');
    expect(useAssessmentReport.getState().selectedFindingIds.has('f1')).toBe(false);
  });

  it('selection survives entering/exiting report mode', () => {
    useAssessmentReport.getState().enterReport('r1');
    useAssessmentReport.getState().toggleFinding('f1');
    useAssessmentReport.getState().toggleFinding('f2');
    useAssessmentReport.getState().exitReport();
    expect(useAssessmentReport.getState().selectedFindingIds.size).toBe(2);
  });

  it('setSelected replaces the set', () => {
    useAssessmentReport.getState().toggleFinding('f1');
    useAssessmentReport.getState().setSelected(['fA', 'fB', 'fC']);
    const ids = [...useAssessmentReport.getState().selectedFindingIds].sort();
    expect(ids).toEqual(['fA', 'fB', 'fC']);
  });

  it('clear() resets both fields', () => {
    useAssessmentReport.getState().enterReport('r1');
    useAssessmentReport.getState().toggleFinding('f1');
    useAssessmentReport.getState().clear();
    const s = useAssessmentReport.getState();
    expect(s.reportRunId).toBeNull();
    expect(s.selectedFindingIds.size).toBe(0);
  });

  it('clearSelection() leaves reportRunId untouched', () => {
    useAssessmentReport.getState().enterReport('r1');
    useAssessmentReport.getState().toggleFinding('f1');
    useAssessmentReport.getState().clearSelection();
    expect(useAssessmentReport.getState().reportRunId).toBe('r1');
    expect(useAssessmentReport.getState().selectedFindingIds.size).toBe(0);
  });
});
