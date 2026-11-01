// Gera policy/classification.json: "MÉTODO /path" → read | write | destructive.
// Vale para RPC (Dokploy: "POST /application.deploy") e REST ("DELETE /apps/{id}").
// As regras ficam em scripts/policy-rules.mjs. Revise o diff do JSON a cada atualização do OpenAPI. Operação fora da tabela = destructive (fail-closed).
// Uso: node scripts/classify.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { classifyOperation } from './policy-rules.mjs';

const spec = JSON.parse(readFileSync('spec/openapi.json', 'utf8'));
const HTTP = ['get', 'head', 'post', 'put', 'patch', 'delete'];

const table = {};
for (const [path, item] of Object.entries(spec.paths).sort(([a], [b]) => a.localeCompare(b))) {
  for (const method of Object.keys(item).filter((m) => HTTP.includes(m))) {
    table[`${method.toUpperCase()} ${path}`] = classifyOperation(path, method);
  }
}
writeFileSync('policy/classification.json', `${JSON.stringify(table, null, 1)}\n`);
const count = Object.values(table).reduce((acc, c) => ({ ...acc, [c]: (acc[c] ?? 0) + 1 }), {});
console.log(count);
