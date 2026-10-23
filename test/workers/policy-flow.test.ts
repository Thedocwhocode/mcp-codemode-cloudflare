import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { handleRequest } from '../../src/index';
import { consumeApproval } from '../../src/policy/approvals';

// API falsa: registra o que chegou e devolve ok. A key fake não pode aparecer em nenhuma saída.
const FAKE_KEY = 'fake-key-NUNCA-NA-SAIDA';
const calls: { path: string; auth: string | null }[] = [];
const fakeEnv = {
  APPROVALS: env.APPROVALS,
  UPSTREAM: {
    fetch: async (req: string | URL | Request, init?: RequestInit) => {
      calls.push({ path: new URL(req instanceof Request ? req.url : req).pathname, auth: new Headers(init?.headers).get('x-api-key') });
      return Response.json({ ok: true, apiKey: 'nao-deve-vazar' });
    },
  },
  KEY_EXEMPLO: { get: async () => FAKE_KEY },
  KEY_LEITURA: { get: async () => FAKE_KEY },
} as never;

describe('política ponta a ponta', () => {
  it('(a) escrita em readwrite chega à API com a key só no header', async () => {
    const out = await handleRequest(fakeEnv, { project: 'exemplo', method: 'POST', path: '/application.deploy', body: { applicationId: 'a' } });
    expect(out).toEqual({ ok: true, apiKey: '[REDACTED]' });
    expect(calls.at(-1)).toEqual({ path: '/api/application.deploy', auth: FAKE_KEY });
  });

  it('(b) escrita em readonly é bloqueada sem chamar a API', async () => {
    const before = calls.length;
    await expect(handleRequest(fakeEnv, { project: 'leitura', method: 'POST', path: '/application.deploy', body: {} })).rejects.toThrow(/readonly/);
    expect(calls.length).toBe(before);
  });

  it('(c) destrutiva vira plano e só o approve executa; (d) reuso é recusado', async () => {
    const before = calls.length;
    const out = (await handleRequest(fakeEnv, { project: 'exemplo', method: 'POST', path: '/application.delete', body: { applicationId: 'a' } })) as { approvalId: string };
    expect(out).toMatchObject({ approval_required: true });
    expect(calls.length).toBe(before);
    expect(JSON.stringify(out)).not.toContain(FAKE_KEY);
    expect(await consumeApproval(env.APPROVALS, out.approvalId)).toMatchObject({ path: '/application.delete' });
    expect(await consumeApproval(env.APPROVALS, out.approvalId)).toBeNull();
  });
});
