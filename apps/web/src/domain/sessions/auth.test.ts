import { describe, expect, it } from 'vitest';
import {
  authMethodSummary,
  authMethodTypeLabel,
  normalizeAuthMethods,
} from './auth';

describe('ACP auth helpers', () => {
  it('normalizes auth methods and preserves env var metadata', () => {
    const methods = normalizeAuthMethods([
      {
        id: 'claude-login',
        name: 'Log in with Claude Code',
        description: 'Run `claude /login` in the terminal',
      },
      {
        id: 'azure-openai',
        name: 'Azure OpenAI',
        type: 'env_var',
        vars: [
          { name: 'AZURE_OPENAI_API_KEY', label: 'API Key' },
          { name: 'AZURE_OPENAI_ENDPOINT', label: 'Endpoint URL', secret: false },
        ],
        link: 'https://portal.azure.com',
      },
    ]);

    expect(methods).toHaveLength(2);
    const agentMethod = methods[0]!;
    const envMethod = methods[1]!;
    expect(agentMethod.type).toBe('agent');
    expect(agentMethod.description).toBe('Run `claude /login` in the terminal');
    expect(envMethod.type).toBe('env_var');
    expect(envMethod.vars).toHaveLength(2);
    expect(envMethod.vars?.[0]!.name).toBe('AZURE_OPENAI_API_KEY');
    expect(envMethod.vars?.[1]!.secret).toBe(false);
    expect(envMethod.link).toBe('https://portal.azure.com');
  });

  it('summarizes auth methods for compact UI badges', () => {
    const methods = normalizeAuthMethods([
      { id: 'one', name: 'Agent login' },
      { id: 'two', name: 'Env vars', type: 'env_var' },
      { id: 'three', name: 'Terminal login', type: 'terminal' },
    ]);

    const envMethod = methods[1]!;
    expect(authMethodTypeLabel(envMethod)).toBe('env var');
    expect(authMethodSummary(methods)).toBe('Agent login · Env vars +1');
    expect(authMethodSummary([])).toBe('not advertised');
  });
});
