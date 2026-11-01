// Enxuga o OpenAPI bruto (spec/raw.json, fora do git) para spec/openapi.json.
// Tira respostas, exemplos e o que não ajuda o modelo a montar a chamada; mantém o que o $ref usa.
// Uso: node scripts/trim-spec.mjs   (depois de salvar o OpenAPI bruto em spec/raw.json)
import { readFileSync, writeFileSync } from 'node:fs';

const raw = JSON.parse(readFileSync('spec/raw.json', 'utf8'));
const HTTP = ['get', 'head', 'post', 'put', 'patch', 'delete'];
const short = (s) => (typeof s === 'string' && s.length > 300 ? `${s.slice(0, 300)}…` : s);

const paths = {};
for (const [path, item] of Object.entries(raw.paths ?? {})) {
  // "parameters" no nível do path vale para todos os métodos dele (não é um método).
  const shared = item.parameters ?? [];
  for (const method of Object.keys(item).filter((m) => HTTP.includes(m))) {
    const { operationId, tags, parameters = [], requestBody, summary, description, deprecated } = item[method];
    if (deprecated) continue;
    const merged = [...shared.filter((s) => !parameters.some((p) => p.name === s.name && p.in === s.in)), ...parameters];
    (paths[path] ??= {})[method] = Object.fromEntries(
      Object.entries({ operationId, tags, summary, description: short(description), parameters: merged.length ? merged : undefined, requestBody })
        .filter(([, v]) => v !== undefined),
    );
  }
}

// $ref para components: só os tipos que entram em parâmetros e corpo (respostas ficam de fora).
const components = Object.fromEntries(
  ['schemas', 'parameters', 'requestBodies'].filter((k) => raw.components?.[k]).map((k) => [k, raw.components[k]]),
);

const spec = {
  openapi: raw.openapi,
  info: { title: raw.info?.title, version: raw.info?.version, description: short(raw.info?.description) },
  paths,
  ...(Object.keys(components).length && { components }),
};
writeFileSync('spec/openapi.json', JSON.stringify(spec));
const ops = Object.values(paths).reduce((n, p) => n + Object.keys(p).length, 0);
console.log(`${Object.keys(paths).length} paths, ${ops} operações, ${JSON.stringify(spec).length} bytes (bruto: ${JSON.stringify(raw).length})`);
