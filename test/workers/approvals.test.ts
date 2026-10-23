import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { consumeApproval, createApproval, type Plan } from '../../src/policy/approvals';

const plan: Plan = { project: 'exemplo', method: 'POST', path: '/application.delete', body: { applicationId: 'x' } };

describe('aprovações', () => {
  it('executa uma vez só', async () => {
    const id = await createApproval(env.APPROVALS, plan);
    expect(await consumeApproval(env.APPROVALS, id)).toEqual(plan);
    expect(await consumeApproval(env.APPROVALS, id)).toBeNull();
  });

  it('expirado é recusado', async () => {
    const id = await createApproval(env.APPROVALS, plan);
    await runInDurableObject(env.APPROVALS.get(env.APPROVALS.idFromName(id)), async (_obj, state) => {
      const stored = (await state.storage.get<{ plan: Plan; expiresAt: number }>('p'))!;
      await state.storage.put('p', { ...stored, expiresAt: Date.now() - 1 });
    });
    expect(await consumeApproval(env.APPROVALS, id)).toBeNull();
  });

  it('id inventado ou fora do formato é recusado', async () => {
    expect(await consumeApproval(env.APPROVALS, crypto.randomUUID())).toBeNull();
    expect(await consumeApproval(env.APPROVALS, '../x')).toBeNull();
  });
});
