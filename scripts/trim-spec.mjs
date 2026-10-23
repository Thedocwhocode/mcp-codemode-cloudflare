// Enxuga o OpenAPI bruto do Dokploy (spec/raw.json, fora do git) para spec/openapi.json.
// As respostas do Dokploy são schemas vazios e os erros são genéricos: só ocupariam o sandbox.
// Uso: node scripts/trim-spec.mjs   (depois de salvar o OpenAPI bruto em spec/raw.json)
import { readFileSync, writeFileSync } from 'node:fs';

const raw = JSON.parse(readFileSync('spec/raw.json', 'utf8'));
const paths = {};
for (const [path, item] of Object.entries(raw.paths)) {
  paths[path] = {};
  for (const [method, op] of Object.entries(item)) {
    const { operationId, tags, parameters, requestBody, summary, description } = op;
    paths[path][method] = Object.fromEntries(
      Object.entries({ operationId, tags, summary, description, parameters: parameters?.length ? parameters : undefined, requestBody })
        .filter(([, v]) => v !== undefined),
    );
  }
}
const spec = {
  openapi: raw.openapi,
  info: { ...raw.info, description: 'Dokploy (tRPC): GET = query (parâmetros em query), POST = mutation (JSON no body). Paths relativos a /api.' },
  paths,
};
writeFileSync('spec/openapi.json', JSON.stringify(spec));
console.log(`${Object.keys(paths).length} paths, ${JSON.stringify(spec).length} bytes (bruto: ${JSON.stringify(raw).length})`);
