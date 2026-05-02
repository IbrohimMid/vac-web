import type { AssessmentQueryFallbackReason, AssessmentQuerySource } from '../../stores/assessment';

interface Props {
    query_source?: AssessmentQuerySource;
    fallback_reason?: AssessmentQueryFallbackReason | null;
    testId?: string;
}

export function AssessmentProvenanceChip({
    query_source,
    fallback_reason,
    testId,
}: Props) {
    if (!query_source && fallback_reason === undefined) return null;

    const sourcedFromIndex = query_source === 'index';
    const label = sourcedFromIndex ? 'Source: index' : 'Source: event log fallback';
    const title = sourcedFromIndex
        ? 'Assessment read served from the SQLite index.'
        : fallback_reason !== undefined
            ? `Assessment read fell back to the canonical event log (${fallback_reason}).`
            : 'Assessment read fell back to the canonical event log.';

    return (
        <span className="badge info mono" data-testid={testId} title={title}>
            {label}
        </span>
    );
}
