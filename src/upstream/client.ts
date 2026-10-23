// Callback do host para codemode.request(): roda fora do sandbox e é o único que vê a key.
import type { RequestOptions } from '@cloudflare/codemode/mcp';
import { API, LIMITS } from '../config/api';
import { PROJECTS, type Project } from '../config/projects';

export type SecretBinding = { get(): Promise<string> };
// UPSTREAM: binding do Workers VPC (API privada). Sem ele, o Worker usa fetch normal (API pública).
export type UpstreamEnv = { UPSTREAM?: Fetcher } & Record<string, unknown>;
export type ProjectRequest = RequestOptions & { project?: string };

export class RequestError extends Error {}

export function resolveProject(alias: unknown): [string, Project] {
  const project = typeof alias === 'string' ? PROJECTS[alias] : undefined;
  if (!project) {
    throw new RequestError(`"project" inválido: ${JSON.stringify(alias)}. Válidos: ${Object.keys(PROJECTS).join(', ')}`);
  }
  return [alias as string, project];
}

export function validatePath(path: unknown): string {
  if (typeof path !== 'string' || !API.pathPattern.test(path)) {
    throw new RequestError(`"path" inválido: ${JSON.stringify(path)}. Exemplo: "${API.pathExample}"`);
  }
  return path;
}

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, API.sensitiveFields.test(k) && v !== null && v !== '' ? '[REDACTED]' : redact(v)]),
    );
  }
  return value;
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > LIMITS.maxResponseBytes) {
      await reader.cancel();
      throw new RequestError(`resposta acima de ${LIMITS.maxResponseBytes} bytes; filtre a consulta`);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(await new Blob(chunks).arrayBuffer());
}

export async function callUpstream(env: UpstreamEnv, project: Project, opts: ProjectRequest): Promise<unknown> {
  const path = validatePath(opts.path);
  const url = new URL(`${API.baseUrl}${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));

  const key = await (env[project.keyBinding] as SecretBinding | undefined)?.get();
  if (!key) throw new RequestError('key do projeto não configurada');
  const init: RequestInit = {
    method: opts.method,
    headers: { [API.authHeader]: key, accept: 'application/json', ...(opts.body !== undefined && { 'content-type': 'application/json' }) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: AbortSignal.timeout(LIMITS.timeoutMs),
  };
  const res = await (env.UPSTREAM ? env.UPSTREAM.fetch(url, init) : fetch(url, init));
  const text = await readCapped(res);
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // resposta não-JSON segue como texto
  }
  if (!res.ok) throw new RequestError(`${API.name} ${res.status} em ${path}: ${JSON.stringify(redact(data)).slice(0, 500)}`);
  return redact(data);
}
