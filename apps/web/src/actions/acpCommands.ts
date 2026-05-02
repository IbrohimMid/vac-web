import type { ActionSpec } from './registry';
import type { AcpCommandAdvert } from '../stores/session';

function readString(raw: unknown, keys: string[]): string | null {
  if (typeof raw === 'string') return raw;
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function slug(input: string): string {
  const clean = input
    .trim()
    .replace(/^\//, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return clean || 'command';
}

export function normalizeAcpCommand(raw: unknown, index: number): AcpCommandAdvert {
  const name = readString(raw, ['name', 'id', 'command', 'alias']) ?? `command-${index + 1}`;
  const title = readString(raw, ['title', 'label', 'name', 'id', 'command']) ?? name;
  const description = readString(raw, ['description', 'summary', 'help']) ?? '';
  const slashRaw = readString(raw, ['slash', 'slash_alias', 'slashAlias', 'command', 'name', 'id']) ?? name;
  const slash = `/${slug(slashRaw)}`;
  return {
    id: `acp-command:${slug(name)}:${index}`,
    name,
    title,
    description,
    slash,
    raw,
  };
}

export function acpCommandToAction(command: AcpCommandAdvert): ActionSpec {
  return {
    id: command.id,
    label: command.title,
    description: command.description || 'ACP command from the active agent',
    group: 'ACP Commands',
    slash_alias: command.slash,
    palette_visible: false,
    required_capabilities: [],
    available_when: 'session.open && !session.streaming',
    source: 'acp',
    insert_text: `${command.slash} `,
    acp_command: command.raw,
  };
}

export function isAcpCommandAction(action: ActionSpec): boolean {
  return action.source === 'acp' || action.id.startsWith('acp-command:');
}
