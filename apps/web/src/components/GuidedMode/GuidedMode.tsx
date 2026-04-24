// Guided mode: 3-step wizard for first-run / first-project. Output is a
// `vac.continuous.yaml` shape we write via `continuous.write_config`.
//
// Not a tab — an overlay. Project setup is a first-run flow, not a daily
// surface.

import { useState } from 'react';
import type { AssessorFamily } from '../../stores/assessment';
import { useContinuous, type FamilyCadence } from '../../stores/continuous';
import type { OverlayRenderProps } from '../../overlays/registry';
import type { TransportHandle } from '../../transport';

type ProjectType = 'saas_web' | 'mobile' | 'library' | 'data_pipeline' | 'infra';
type ReleaseGoal = 'prototype' | 'staging' | 'production' | 'regulated';

// Default family set per project type. Guided mode picks the intersection of
// (project default) ∪ (goal override) and lets the user deselect chips.
const PROJECT_DEFAULTS: Record<ProjectType, AssessorFamily[]> = {
  saas_web: ['rtd', 'pm', 'security', 'performance', 'reliability', 'ux'],
  mobile: ['rtd', 'pm', 'security', 'performance', 'ux', 'launch'],
  library: ['rtd', 'security', 'docs', 'qa'],
  data_pipeline: ['rtd', 'security', 'reliability', 'qa'],
  // No `ops` family in v1 (Phase 6 catalog); use reliability + release as the
  // closest Infra-flavoured equivalents.
  infra: ['rtd', 'security', 'reliability', 'release'],
};

const GOAL_EXTRAS: Record<ReleaseGoal, AssessorFamily[]> = {
  prototype: [],
  staging: ['qa'],
  production: ['qa', 'release', 'launch'],
  regulated: ['qa', 'release', 'launch', 'docs'],
};

const DEFAULT_CADENCE_SECONDS: Record<ReleaseGoal, number> = {
  prototype: 24 * 3600,
  staging: 6 * 3600,
  production: 3600,
  regulated: 900,
};

const VALID_FAMILIES: AssessorFamily[] = [
  'rtd',
  'pm',
  'ux',
  'frontend',
  'security',
  'reliability',
  'performance',
  'qa',
  'docs',
  'launch',
  'release',
  'growth',
];

export function GuidedMode({ params, dismiss }: OverlayRenderProps) {
  const transport = (params.transport as TransportHandle | undefined) ?? null;
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [projectType, setProjectType] = useState<ProjectType>('saas_web');
  const [goal, setGoal] = useState<ReleaseGoal>('production');
  const [selected, setSelected] = useState<Set<AssessorFamily>>(() =>
    new Set(mergeFamilies('saas_web', 'production')),
  );
  const [saving, setSaving] = useState(false);

  const regenerate = (pt: ProjectType, g: ReleaseGoal) => {
    setSelected(new Set(mergeFamilies(pt, g)));
  };

  const toggle = (f: AssessorFamily) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(f)) n.delete(f);
      else n.add(f);
      return n;
    });
  };

  const finish = async () => {
    setSaving(true);
    const cadenceSeconds = DEFAULT_CADENCE_SECONDS[goal];
    const families = Array.from(selected);
    // Seed local cadences + enable continuous mode optimistically; the bridge
    // is authoritative and will echo back.
    const store = useContinuous.getState();
    store.setEnabled(true);
    for (const f of families) {
      const cadence: FamilyCadence = {
        family: f,
        cadence_seconds: cadenceSeconds,
        input_patterns: defaultPatternsFor(f),
      };
      store.setCadence(cadence);
    }
    if (transport) {
      try {
        await transport.send('', 'continuous.write_config', {
          project_type: projectType,
          release_goal: goal,
          cadence_seconds: cadenceSeconds,
          families,
        });
      } catch {
        /* bridge will also persist; tolerate transient send failure */
      }
    }
    setSaving(false);
    dismiss();
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Guided setup" style={dialogStyle}>
      <header style={headerStyle}>
        <strong>Guided setup — step {step}/3</strong>
        <button onClick={dismiss} aria-label="Close">
          Close
        </button>
      </header>
      <div style={{ padding: 16 }}>
        {step === 1 && (
          <ProjectTypeStep
            value={projectType}
            onChange={(v) => {
              setProjectType(v);
              regenerate(v, goal);
            }}
          />
        )}
        {step === 2 && (
          <ReleaseGoalStep
            value={goal}
            onChange={(v) => {
              setGoal(v);
              regenerate(projectType, v);
            }}
          />
        )}
        {step === 3 && <FamilyStep selected={selected} toggle={toggle} />}
      </div>
      <footer
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 6,
          padding: '8px 16px',
          borderTop: '1px solid var(--border-1, #333)',
        }}
      >
        {step > 1 && (
          <button onClick={() => setStep(((step as number) - 1) as 1 | 2 | 3)}>Back</button>
        )}
        {step < 3 && (
          <button onClick={() => setStep(((step as number) + 1) as 1 | 2 | 3)}>Next</button>
        )}
        {step === 3 && (
          <button onClick={finish} disabled={saving || selected.size === 0}>
            {saving ? 'Saving…' : 'Finish'}
          </button>
        )}
      </footer>
    </div>
  );
}

function ProjectTypeStep({
  value,
  onChange,
}: {
  value: ProjectType;
  onChange: (v: ProjectType) => void;
}) {
  const items: Array<{ id: ProjectType; label: string; hint: string }> = [
    { id: 'saas_web', label: 'SaaS web app', hint: 'Frontend + API + DB' },
    { id: 'mobile', label: 'Mobile app', hint: 'iOS / Android + API' },
    { id: 'library', label: 'Library / SDK', hint: 'Published to a registry' },
    { id: 'data_pipeline', label: 'Data pipeline', hint: 'ETL / batch / streaming' },
    { id: 'infra', label: 'Infra / platform tool', hint: 'Ops-facing service' },
  ];
  return (
    <div>
      <p style={{ margin: '0 0 8px 0' }}>What kind of project is this?</p>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {items.map((i) => (
          <li key={i.id} style={{ margin: '4px 0' }}>
            <label>
              <input
                type="radio"
                checked={value === i.id}
                onChange={() => onChange(i.id)}
              />{' '}
              <strong>{i.label}</strong>{' '}
              <span style={{ color: 'var(--text-2)', fontSize: 12 }}>— {i.hint}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReleaseGoalStep({
  value,
  onChange,
}: {
  value: ReleaseGoal;
  onChange: (v: ReleaseGoal) => void;
}) {
  const items: Array<{ id: ReleaseGoal; label: string; hint: string }> = [
    { id: 'prototype', label: 'Prototype', hint: 'Exploring — loose gates' },
    { id: 'staging', label: 'Staging', hint: 'Internal users' },
    { id: 'production', label: 'Production', hint: 'Real users; standard gates' },
    { id: 'regulated', label: 'Regulated', hint: 'Compliance + audit trail required' },
  ];
  return (
    <div>
      <p style={{ margin: '0 0 8px 0' }}>What's the release target?</p>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {items.map((i) => (
          <li key={i.id} style={{ margin: '4px 0' }}>
            <label>
              <input
                type="radio"
                checked={value === i.id}
                onChange={() => onChange(i.id)}
              />{' '}
              <strong>{i.label}</strong>{' '}
              <span style={{ color: 'var(--text-2)', fontSize: 12 }}>— {i.hint}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FamilyStep({
  selected,
  toggle,
}: {
  selected: Set<AssessorFamily>;
  toggle: (f: AssessorFamily) => void;
}) {
  return (
    <div>
      <p style={{ margin: '0 0 8px 0' }}>
        Assessor families to run continuously ({selected.size} selected):
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {VALID_FAMILIES.map((f) => {
          const on = selected.has(f);
          return (
            <button
              key={f}
              onClick={() => toggle(f)}
              aria-pressed={on}
              style={{
                padding: '4px 10px',
                borderRadius: 12,
                background: on ? 'var(--accent, #5af)' : 'transparent',
                color: on ? '#000' : 'var(--text-1)',
                border: '1px solid var(--border-1, #333)',
                cursor: 'pointer',
              }}
            >
              {f}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function mergeFamilies(pt: ProjectType, g: ReleaseGoal): AssessorFamily[] {
  const seen = new Set<AssessorFamily>();
  const out: AssessorFamily[] = [];
  for (const f of PROJECT_DEFAULTS[pt]) {
    if (VALID_FAMILIES.includes(f) && !seen.has(f)) {
      seen.add(f);
      out.push(f);
    }
  }
  for (const f of GOAL_EXTRAS[g]) {
    if (VALID_FAMILIES.includes(f) && !seen.has(f)) {
      seen.add(f);
      out.push(f);
    }
  }
  return out;
}

function defaultPatternsFor(family: AssessorFamily): string[] {
  switch (family) {
    case 'security':
      return ['package*.json', 'requirements*.txt', 'Dockerfile', 'Cargo.lock'];
    case 'frontend':
    case 'ux':
      return ['apps/web/src/**'];
    case 'performance':
      return ['apps/**', 'packages/**'];
    case 'docs':
      return ['docs/**', 'README.md', 'CHANGELOG.md'];
    default:
      return [];
  }
}

const dialogStyle: React.CSSProperties = {
  background: 'var(--bg-1, #1a1a1a)',
  color: 'var(--text-1)',
  border: '1px solid var(--border-1, #333)',
  borderRadius: 8,
  width: 'min(560px, 90vw)',
  maxHeight: '85vh',
  overflow: 'auto',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '8px 16px',
  borderBottom: '1px solid var(--border-1, #333)',
};

// Export pure helpers for unit tests.
export { mergeFamilies, defaultPatternsFor };
