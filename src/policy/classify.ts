import table from '../../policy/classification.json';
import type { Mode } from '../config/projects';

export type OpClass = 'read' | 'write' | 'destructive';
export type PolicyTable = Readonly<Record<string, OpClass>>;

// Chave da tabela: "MÉTODO /path", com parâmetros de path como no OpenAPI ("GET /apps/{id}").
// Serve para RPC (Dokploy: "POST /application.deploy") e para REST (vários métodos por path, {params}).
const esc = (s: string) => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&');

interface Route {
  method: string;
  cls: OpClass;
  params: number;
  re: RegExp;
}

export function compilePolicy(policy: PolicyTable): (method: string, path: string) => OpClass {
  const routes: Route[] = [];
  for (const [key, cls] of Object.entries(policy)) {
    const m = key.match(/^([A-Z]+) (\/\S*)$/);
    const method = m?.[1];
    const template = m?.[2];
    if (!method || !template) throw new Error(`chave de política inválida: ${JSON.stringify(key)} (esperado "MÉTODO /path")`);
    routes.push({
      method,
      // "read" passa até em projeto readonly: só vale para GET/HEAD, mesmo que a tabela diga outra coisa.
      cls: cls === 'read' && method !== 'GET' && method !== 'HEAD' ? 'destructive' : cls,
      params: (template.match(/\{[^/}]+\}/g) ?? []).length,
      // Um {param} casa um segmento inteiro, nunca "/" (o validatePath já recusa ".." e "%2f").
      re: new RegExp(`^${esc(template).replace(/\{[^/}]+\}/g, '[^/]+')}$`),
    });
  }
  const severity: Record<OpClass, number> = { read: 0, write: 1, destructive: 2 };
  // Mais específico vence: menos {params} ("/apps/search" antes de "/apps/{id}").
  // Empate entre templates diferentes que casam o mesmo path: vence a classe mais restritiva (fail-closed).
  return (method, path) => {
    const m = method.toUpperCase();
    const hits = routes.filter((r) => r.method === m && r.re.test(path));
    if (hits.length === 0) return 'destructive'; // fora da tabela = destructive
    const fewest = Math.min(...hits.map((r) => r.params));
    return hits
      .filter((r) => r.params === fewest)
      .reduce<OpClass>((worst, r) => (severity[r.cls] > severity[worst] ? r.cls : worst), 'read');
  };
}

export const classify = compilePolicy(table as PolicyTable);

export type Decision = 'allow' | 'approval' | 'deny';

// readonly: só leitura. readwrite: leitura e escrita; destrutiva sempre passa por aprovação.
export function decide(mode: Mode, cls: OpClass): Decision {
  if (cls === 'read') return 'allow';
  if (mode !== 'readwrite') return 'deny';
  return cls === 'write' ? 'allow' : 'approval';
}
