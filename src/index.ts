import { DynamicWorkerExecutor } from '@cloudflare/codemode';
import { openApiMcpServer } from '@cloudflare/codemode/mcp';
import { createLegacyMcpHandler } from 'agents/mcp';
import { z } from 'zod';
import rawSpec from '../spec/openapi.json';
import { API, LIMITS } from './config/api';
import { publicProjects } from './config/projects';
import { callUpstream, redact, RequestError, resolveProject, type ProjectRequest, type UpstreamEnv } from './upstream/client';
import { accessIdentity, type AccessEnv } from './auth/access';
import { consumeApproval, createApproval, summarize, type ApprovalsNamespace, type Plan } from './policy/approvals';
import { classify, decide } from './policy/classify';

export { Approvals } from './policy/approvals';

// Estado de cada execute (o context é um objeto por chamada do tool): id para a auditoria e contagem.
const executes = new WeakMap<object, { id: string; calls: number }>();

// Auditoria em Workers Logs: só metadados, nunca body, query, resposta ou key.
function audit(entry: Record<string, unknown>) {
  console.log(JSON.stringify({ audit: `${API.name}-mcp`, ts: new Date().toISOString(), ...entry }));
}

export interface Env extends AccessEnv {
  UPSTREAM?: Fetcher;
  LOADER: WorkerLoader;
  APPROVALS: ApprovalsNamespace;
}

// `x-projects` vai junto da spec para o `search` descobrir os aliases (sem binding nem key).
const spec = { ...rawSpec, 'x-projects': publicProjects() };

const EXECUTE_HELP = `${API.help}
Projeto "readonly" só lê. Operação destrutiva (remover, parar, limpar, credenciais) não executa:
volta { approval_required, approvalId, plano }. Mostre o plano ao usuário; só ele decide chamar o tool "approve".`;

export async function handleRequest(env: Env, opts: ProjectRequest) {
  const [alias, project] = resolveProject(opts.project);
  if (!(API.methods as readonly string[]).includes(opts.method)) throw new RequestError(`métodos aceitos: ${API.methods.join(', ')}`);
  const cls = classify(opts.method, opts.path);
  const decision = decide(project.mode, cls);
  if (decision === 'deny') throw new RequestError(`"${alias}" é ${project.mode}: ${opts.path} (${cls}) não é permitido`);
  if (decision === 'approval') {
    const plan: Plan = { project: alias, method: opts.method, path: opts.path, query: opts.query, body: opts.body };
    const approvalId = await createApproval(env.APPROVALS, plan);
    return { approval_required: true, approvalId, expira_em_min: 10, plano: redact(summarize(plan)) };
  }
  return callUpstream(env as unknown as UpstreamEnv, project, opts);
}

function mcpServer(env: Env, user: string) {
  const server = openApiMcpServer({
    spec,
    // globalOutbound: null → o código do modelo não tem rede; a única saída é o callback `request`.
    executor: new DynamicWorkerExecutor({ loader: env.LOADER, globalOutbound: null, timeout: 60_000 }),
    name: API.name,
    version: '1.0.0',
    description: EXECUTE_HELP,
    request: async (opts, context) => {
      const ex = executes.get(context) ?? { id: crypto.randomUUID(), calls: 0 };
      ex.calls += 1;
      executes.set(context, ex);
      const req = opts as ProjectRequest;
      const base = { user, execute: ex.id, project: req.project, op: `${req.method} ${req.path}`, cls: classify(req.method, req.path) };
      if (ex.calls > LIMITS.callsPerExecute) {
        audit({ ...base, status: 'limite' });
        throw new RequestError(`limite de ${LIMITS.callsPerExecute} chamadas por execute`);
      }
      const t0 = Date.now();
      try {
        const out = await handleRequest(env, req);
        const status = out && typeof out === 'object' && 'approval_required' in out ? 'aprovacao_pendente' : 'ok';
        audit({ ...base, status, ms: Date.now() - t0 });
        return out;
      } catch (e) {
        audit({ ...base, status: 'erro', erro: e instanceof RequestError ? e.message.slice(0, 200) : 'falha', ms: Date.now() - t0 });
        throw e;
      }
    },
  });

  server.registerTool(
    'approve',
    {
      description:
        'Executa UMA operação destrutiva já planejada pelo execute. Só chame depois que o usuário aprovar explicitamente ' +
        'o plano mostrado. O approvalId vale uma vez, por 10 minutos.',
      inputSchema: { approvalId: z.string().describe('approvalId devolvido pelo execute') },
    },
    async ({ approvalId }) => {
      const plan = await consumeApproval(env.APPROVALS, approvalId);
      if (!plan) {
        audit({ user, tool: 'approve', status: 'recusado' });
        return { content: [{ type: 'text', text: 'approvalId inválido, já usado ou expirado' }], isError: true };
      }
      const base = { user, tool: 'approve', project: plan.project, op: `${plan.method} ${plan.path}`, cls: 'destructive' };
      const t0 = Date.now();
      try {
        const [, project] = resolveProject(plan.project);
        const result = await callUpstream(env as unknown as UpstreamEnv, project, plan);
        audit({ ...base, status: 'ok', ms: Date.now() - t0 });
        return { content: [{ type: 'text', text: JSON.stringify({ executado: summarize(plan), result }).slice(0, 24_000) }] };
      } catch (e) {
        audit({ ...base, status: 'erro', ms: Date.now() - t0 });
        return { content: [{ type: 'text', text: e instanceof Error ? e.message : 'falha' }], isError: true };
      }
    },
  );
  return server;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Fail-closed: sem JWT válido do Access, nada responde (o Access já barra antes; isto cobre bypass).
    const user = await accessIdentity(request, env);
    if (!user) return new Response('forbidden', { status: 403 });
    if (new URL(request.url).pathname === '/mcp') {
      return createLegacyMcpHandler(mcpServer(env, user), { route: '/mcp' })(request, env, ctx);
    }
    return new Response('not found', { status: 404 });
  },
};
