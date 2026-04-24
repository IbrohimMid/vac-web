// Slash-alias lookup for composer.

import type { ActionSpec } from './registry';

export function matchSlash(input: string, actions: ActionSpec[]): ActionSpec | null {
  const m = input.match(/^(\/[a-z0-9_-]+)/i);
  if (!m) return null;
  const alias = m[1]?.toLowerCase();
  if (!alias) return null;
  return actions.find((a) => a.slash_alias?.toLowerCase() === alias) ?? null;
}
