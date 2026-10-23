// Planos de operações destrutivas: um Durable Object por approvalId, uso único, TTL de 10 min.
// O DO serializa as chamadas, então consumir duas vezes o mesmo id em paralelo não executa duas vezes.
import { DurableObject } from 'cloudflare:workers';

export const APPROVAL_TTL_MS = 10 * 60_000;

export interface Plan {
  project: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

interface Stored {
  plan: Plan;
  expiresAt: number;
}

export class Approvals extends DurableObject {
  async create(plan: Plan): Promise<void> {
    await this.ctx.storage.put<Stored>('p', { plan, expiresAt: Date.now() + APPROVAL_TTL_MS });
    await this.ctx.storage.setAlarm(Date.now() + APPROVAL_TTL_MS);
  }

  /** Devolve o plano e o apaga; null se não existe, já foi usado ou expirou. */
  async consume(): Promise<Plan | null> {
    const stored = await this.ctx.storage.get<Stored>('p');
    await this.ctx.storage.deleteAll();
    if (!stored || stored.expiresAt < Date.now()) return null;
    return stored.plan;
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}

export type ApprovalsNamespace = DurableObjectNamespace<Approvals>;

export async function createApproval(ns: ApprovalsNamespace, plan: Plan): Promise<string> {
  const approvalId = crypto.randomUUID();
  await ns.get(ns.idFromName(approvalId)).create(plan);
  return approvalId;
}

export async function consumeApproval(ns: ApprovalsNamespace, approvalId: string): Promise<Plan | null> {
  if (!/^[0-9a-f-]{36}$/.test(approvalId)) return null;
  return ns.get(ns.idFromName(approvalId)).consume();
}

/** Resumo do plano para o modelo/usuário: valores longos cortados, segredos já redigidos pelo chamador. */
export function summarize(plan: Plan): Plan {
  const clip = (v: unknown) => (typeof v === 'string' && v.length > 80 ? `${v.slice(0, 80)}…` : v);
  const body =
    plan.body && typeof plan.body === 'object'
      ? Object.fromEntries(Object.entries(plan.body).map(([k, v]) => [k, clip(typeof v === 'object' ? JSON.stringify(v) : v)]))
      : plan.body;
  return { ...plan, body };
}
