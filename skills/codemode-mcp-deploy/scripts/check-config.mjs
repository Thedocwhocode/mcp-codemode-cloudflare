#!/usr/bin/env node
// Pre-deploy check for an mcp-codemode-cloudflare checkout.
// Reads local files only: no network, no secrets, no writes.
// Usage: node check-config.mjs [path-to-repo]   (default: current directory)
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '.');
const results = [];
const ok = (msg) => results.push(['ok', msg]);
const warn = (msg) => results.push(['warn', msg]);
const fail = (msg) => results.push(['fail', msg]);

function read(rel) {
  const file = join(root, rel);
  if (!existsSync(file)) {
    fail(`missing ${rel}`);
    return null;
  }
  return readFileSync(file, 'utf8');
}

// JSONC: drop // and /* */ comments outside strings, then trailing commas.
function parseJsonc(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === '\\') out += text[++i] ?? '';
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2);
      if (i === -1) break;
      i++;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

// 1. Projects (src/config/projects.ts)
const projectsSrc = read('src/config/projects.ts');
const projects = [];
if (projectsSrc) {
  const re = /^\s*['"]?([A-Za-z0-9_-]+)['"]?\s*:\s*\{\s*keyBinding:\s*['"]([A-Z0-9_]+)['"]\s*,\s*mode:\s*['"](readonly|readwrite)['"]/gm;
  for (const m of projectsSrc.matchAll(re)) projects.push({ alias: m[1], binding: m[2], mode: m[3] });
  if (projects.length === 0) fail('src/config/projects.ts: no project entries found');
  else ok(`projects: ${projects.map((p) => `${p.alias} (${p.mode})`).join(', ')}`);
  if (projects.some((p) => p.alias === 'exemplo' || p.alias === 'leitura')) warn('projects.ts still has the sample aliases "exemplo"/"leitura"');
}

// 2. Wrangler config
const wranglerSrc = read('wrangler.jsonc');
let wrangler = null;
if (wranglerSrc) {
  try {
    wrangler = parseJsonc(wranglerSrc);
  } catch (e) {
    fail(`wrangler.jsonc does not parse: ${e.message}`);
  }
}
if (wrangler) {
  const secrets = wrangler.secrets_store_secrets ?? [];
  const bound = new Set(secrets.map((s) => s.binding));
  for (const p of projects) {
    if (!bound.has(p.binding)) fail(`project "${p.alias}": binding ${p.binding} is not in secrets_store_secrets`);
  }
  for (const s of secrets) {
    if (!projects.some((p) => p.binding === s.binding)) warn(`secrets_store_secrets has ${s.binding}, which no project uses`);
    if (/^0+$/.test(String(s.store_id))) fail(`${s.binding}: store_id is still the placeholder (run: npx wrangler secrets-store store list --remote)`);
  }
  if (secrets.length && projects.every((p) => bound.has(p.binding))) ok('every project has a Secrets Store binding');

  const routes = (wrangler.routes ?? []).map((r) => r.pattern ?? r);
  if (routes.length === 0) fail('no routes: the Worker needs a custom domain behind Cloudflare Access');
  else if (routes.some((r) => /SEU-DOMINIO|example\.com|YOUR/i.test(r))) fail(`routes still use a placeholder: ${routes.join(', ')}`);
  else ok(`routes: ${routes.join(', ')}`);

  if (wrangler.workers_dev !== false) fail('workers_dev must be false (a workers.dev URL would bypass Access)');
  if (wrangler.preview_urls !== false) fail('preview_urls must be false (preview URLs would bypass Access)');

  const vars = wrangler.vars ?? {};
  if (!vars.ACCESS_TEAM_DOMAIN || /SEU-TIME|YOUR/i.test(vars.ACCESS_TEAM_DOMAIN)) fail('vars.ACCESS_TEAM_DOMAIN is not set to your <team>.cloudflareaccess.com');
  else ok(`Access team domain: ${vars.ACCESS_TEAM_DOMAIN}`);
  if (!vars.ACCESS_AUD || /COLE|PASTE|YOUR/i.test(vars.ACCESS_AUD)) fail('vars.ACCESS_AUD is not set to the Access application AUD tag');
  else ok('Access AUD tag is set');

  if (!(wrangler.worker_loaders ?? []).some((l) => l.binding === 'LOADER')) fail('worker_loaders LOADER binding is missing (sandbox)');
  if (!(wrangler.durable_objects?.bindings ?? []).some((b) => b.name === 'APPROVALS')) fail('APPROVALS Durable Object binding is missing');
}

// 3. API config, spec and policy table
const apiSrc = read('src/config/api.ts');
const specSrc = read('spec/openapi.json');
const tableSrc = read('policy/classification.json');
let pathPattern = null;
if (apiSrc) {
  const m = apiSrc.match(/pathPattern:\s*\/(.+)\/([a-z]*),/);
  if (m) {
    try {
      pathPattern = new RegExp(m[1], m[2]);
    } catch {
      warn('could not evaluate API.pathPattern; skipped the path check');
    }
  }
  const base = apiSrc.match(/baseUrl:\s*['"]([^'"]+)['"]/)?.[1];
  const usesVpc = wrangler && (wrangler.vpc_services ?? []).some((v) => v.binding === 'UPSTREAM');
  if (base && /127\.0\.0\.1|localhost/.test(base) && wrangler && !usesVpc) {
    fail(`API.baseUrl is ${base} but no UPSTREAM vpc_services binding is set: a private API needs Tunnel + Workers VPC`);
  } else if (base) ok(`API.baseUrl: ${base}${usesVpc ? ' (through Workers VPC)' : ''}`);
}
if (specSrc && tableSrc) {
  const spec = JSON.parse(specSrc);
  const table = JSON.parse(tableSrc);
  const paths = Object.keys(spec.paths ?? {});
  const counts = Object.values(table).reduce((a, c) => ({ ...a, [c]: (a[c] ?? 0) + 1 }), {});
  ok(`spec "${spec.info?.title ?? '?'}": ${paths.length} paths; policy: ${JSON.stringify(counts)}`);

  const HTTP = ['get', 'post', 'put', 'patch', 'delete', 'head'];
  // Two table layouts: stock ("/path") or REST-adapted ("METHOD /template", see references/rest-apis.md).
  const restKeyed = Object.keys(table).some((k) => /^[A-Z]+ \//.test(k));
  const specKeys = paths.flatMap((p) =>
    restKeyed ? Object.keys(spec.paths[p]).filter((m) => HTTP.includes(m)).map((m) => `${m.toUpperCase()} ${p}`) : [p],
  );
  const missing = specKeys.filter((k) => !(k in table));
  const stale = Object.keys(table).filter((k) => !specKeys.includes(k));
  if (missing.length) warn(`${missing.length} spec operations have no class and will be treated as destructive, e.g. ${missing.slice(0, 3).join(', ')}`);
  if (stale.length) warn(`${stale.length} policy entries are not in the spec (stale), e.g. ${stale.slice(0, 3).join(', ')}`);

  const multi = paths.filter((p) => Object.keys(spec.paths[p]).length > 1);
  const templated = paths.filter((p) => p.includes('{'));
  if (restKeyed) {
    ok('policy is keyed by "METHOD /template" (REST layout); make sure src/policy/classify.ts matches templates');
    const bad = specKeys.filter((k) => table[k] === 'read' && !/^(GET|HEAD) /.test(k));
    if (bad.length) warn(`${bad.length} non-GET operations are classed as read, e.g. ${bad.slice(0, 3).join(', ')}`);
  } else {
    if (multi.length || templated.length) {
      fail(
        `REST-shaped spec: ${multi.length} paths with several methods, ${templated.length} with {params}. ` +
          'The stock policy is keyed by exact path with one method each. See references/rest-apis.md before deploying.',
      );
    }
    const mismatch = paths.filter((p) => {
      const method = Object.keys(spec.paths[p])[0]?.toUpperCase();
      // GET marked destructive is fine (sensitive read). read on non-GET or write on GET is not.
      return (table[p] === 'read' && method !== 'GET') || (table[p] === 'write' && method === 'GET');
    });
    if (mismatch.length) warn(`${mismatch.length} entries disagree with the spec method and will act as destructive, e.g. ${mismatch.slice(0, 3).join(', ')}`);
  }

  if (pathPattern) {
    // Fill {params} with a sample value: the pattern sees concrete paths at runtime.
    const rejected = paths.filter((p) => !pathPattern.test(p.replace(/\{[^/}]+\}/g, '1')));
    if (rejected.length) fail(`${rejected.length} spec paths fail API.pathPattern, e.g. ${rejected.slice(0, 3).join(', ')}`);
    else ok('every spec path matches API.pathPattern');
  }
}

// 4. Secret hygiene
const gitignore = existsSync(join(root, '.gitignore')) ? readFileSync(join(root, '.gitignore'), 'utf8') : '';
if (!/\.dev\.vars/.test(gitignore)) fail('.gitignore does not exclude .dev.vars');
for (const rel of ['wrangler.jsonc', 'src/config/api.ts', 'src/config/projects.ts']) {
  const text = existsSync(join(root, rel)) ? readFileSync(join(root, rel), 'utf8') : '';
  if (/(eyJ[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY)/.test(text)) {
    fail(`${rel} seems to contain a credential. Keys belong in the Secrets Store only`);
  }
}

const icon = { ok: 'OK  ', warn: 'WARN', fail: 'FAIL' };
for (const [level, msg] of results) console.log(`${icon[level]} ${msg}`);
const failures = results.filter(([l]) => l === 'fail').length;
console.log(failures ? `\n${failures} problem(s) to fix before deploying.` : '\nReady for: npm run typecheck && npm test && npm run deploy');
process.exit(failures ? 1 : 0);
