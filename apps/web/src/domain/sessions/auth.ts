export interface AcpAuthEnvVar {
  name: string;
  label?: string;
  secret?: boolean;
  optional?: boolean;
}

export interface AcpAuthMethod {
  id: string;
  name: string;
  description?: string;
  type: 'agent' | 'env_var' | 'terminal' | string;
  vars?: AcpAuthEnvVar[];
  link?: string;
}

function asObject(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function asString(raw: unknown): string | null {
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

function asBoolean(raw: unknown): boolean | undefined {
  return typeof raw === 'boolean' ? raw : undefined;
}

function normalizeVars(raw: unknown): AcpAuthEnvVar[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const vars = raw
    .map((item) => {
      const obj = asObject(item);
      const name = asString(obj.name);
      if (!name) return null;
      return {
        name,
        ...(asString(obj.label) ? { label: asString(obj.label)! } : {}),
        ...(asBoolean(obj.secret) !== undefined ? { secret: asBoolean(obj.secret)! } : {}),
        ...(asBoolean(obj.optional) !== undefined
          ? { optional: asBoolean(obj.optional)! }
          : {}),
      } satisfies AcpAuthEnvVar;
    })
    .filter((item): item is AcpAuthEnvVar => item !== null);
  return vars.length > 0 ? vars : undefined;
}

export function normalizeAuthMethods(raw: unknown): AcpAuthMethod[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index) => {
      const obj = asObject(item);
      const id = asString(obj.id) ?? `auth_${index + 1}`;
      const name = asString(obj.name) ?? id;
      const type = (asString(obj.type) ?? 'agent') as AcpAuthMethod['type'];
      const description = asString(obj.description);
      const link = asString(obj.link);
      const vars = normalizeVars(obj.vars);
      return {
        id,
        name,
        type,
        ...(description ? { description } : {}),
        ...(link ? { link } : {}),
        ...(vars ? { vars } : {}),
      } satisfies AcpAuthMethod;
    })
    .filter((method) => method.id.length > 0);
}

export function authMethodTypeLabel(method: AcpAuthMethod): string {
  switch (method.type) {
    case 'env_var':
      return 'env var';
    case 'terminal':
      return 'terminal';
    case 'agent':
    default:
      return 'agent';
  }
}

export function authMethodSummary(methods: AcpAuthMethod[]): string {
  if (methods.length === 0) return 'not advertised';
  const labels = methods.slice(0, 2).map((method) => method.name || method.id);
  if (methods.length <= 2) return labels.join(' · ');
  return `${labels.join(' · ')} +${methods.length - 2}`;
}
