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
const regexFrom = (text) => {
  const m = text?.match(/^\/(.+)\/([a-z]*)$/);
  return m ? new RegExp(m[1], m[2]) : null;
};
let pathPattern = null;
let methods = null;
if (apiSrc) {
  try {
    // pathPattern is either a literal regex or PATH_PATTERNS.<name>.
    const literal = apiSrc.match(/pathPattern:\s*(\/.+\/[a-z]*),/)?.[1];
    const named = apiSrc.match(/pathPattern:\s*PATH_PATTERNS\.(\w+)/)?.[1];
    const namedSrc = named && apiSrc.match(new RegExp(`\\b${named}:\\s*(\\/.+\\/[a-z]*),`))?.[1];
    pathPattern = regexFrom(literal ?? namedSrc);
    if (!pathPattern) warn('could not read API.pathPattern; skipped the path check');
    else ok(`API.pathPattern: ${named ? `PATH_PATTERNS.${named}` : 'custom regex'}`);
  } catch {
    warn('could not evaluate API.pathPattern; skipped the path check');
  }
  methods = apiSrc.match(/methods:\s*\[([^\]]*)\]/)?.[1]?.match(/[A-Z]+/g) ?? null;
  const header = apiSrc.match(/authHeader:\s*['"]([^'"]+)['"]/)?.[1];
  const prefix = apiSrc.match(/authPrefix:\s*['"]([^'"]*)['"]/)?.[1];
  if (header && /^authorization$/i.test(header) && !prefix) {
    warn('authHeader is Authorization but authPrefix is empty: most APIs expect authPrefix "Bearer " (with the space)');
  }
  if (prefix && !prefix.endsWith(' ')) warn(`authPrefix "${prefix}" has no trailing space; the header would read "${prefix}<key>"`);
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
  const HTTP = ['get', 'head', 'post', 'put', 'patch', 'delete'];
  const specKeys = paths.flatMap((p) => Object.keys(spec.paths[p]).filter((m) => HTTP.includes(m)).map((m) => `${m.toUpperCase()} ${p}`));
  const counts = Object.values(table).reduce((a, c) => ({ ...a, [c]: (a[c] ?? 0) + 1 }), {});
  ok(`spec "${spec.info?.title ?? '?'}": ${paths.length} paths, ${specKeys.length} operations; policy: ${JSON.stringify(counts)}`);

  const oldKeys = Object.keys(table).filter((k) => !/^[A-Z]+ \//.test(k));
  if (oldKeys.length) {
    // The server refuses to start with these keys (compilePolicy throws).
    fail(`policy/classification.json uses the old "/path" keys (e.g. ${oldKeys[0]}). Run: npm run spec:classify`);
  } else {
    const missing = specKeys.filter((k) => !(k in table));
    const stale = Object.keys(table).filter((k) => !specKeys.includes(k));
    if (missing.length) warn(`${missing.length} spec operations have no class and will be treated as destructive, e.g. ${missing.slice(0, 3).join(', ')}`);
    if (stale.length) warn(`${stale.length} policy entries are not in the spec (stale), e.g. ${stale.slice(0, 3).join(', ')}`);
    const fakeRead = Object.keys(table).filter((k) => table[k] === 'read' && !/^(GET|HEAD) /.test(k));
    if (fakeRead.length) warn(`${fakeRead.length} non-GET entries say read; the server treats them as destructive, e.g. ${fakeRead.slice(0, 3).join(', ')}`);
  }

  if (methods) {
    const used = [...new Set(specKeys.map((k) => k.split(' ')[0]))];
    const blocked = used.filter((m) => !methods.includes(m));
    if (blocked.length) warn(`the spec uses ${blocked.join(', ')} but API.methods allows only ${methods.join(', ')}`);
  }

  if (pathPattern) {
    // Fill {params} with a sample value: the pattern sees concrete paths at runtime.
    const rejected = paths.filter((p) => !pathPattern.test(p.replace(/\{[^/}]+\}/g, '1')));
    if (rejected.length) {
      const hint = rejected.some((p) => p.includes('{')) ? ' (REST paths need pathPattern: PATH_PATTERNS.rest)' : '';
      fail(`${rejected.length} spec paths fail API.pathPattern, e.g. ${rejected.slice(0, 3).join(', ')}${hint}`);
    } else ok('every spec path matches API.pathPattern');
  }
}
if (pathPattern) {
  // A pattern that accepts every spec path can still be too broad. These must always be refused.
  const probes = ['/../admin', '/a/../b', '//evil.example/x', 'http://evil.example/x', '/a?x=1', '/a%2fb', '/a%2Fb', '/a#b', 'a/b', '/a b', ''];
  const accepted = probes.filter((p) => pathPattern.test(p));
  if (accepted.length) fail(`API.pathPattern accepts unsafe paths: ${accepted.map((p) => JSON.stringify(p)).join(', ')}`);
  else ok('API.pathPattern refuses traversal, hosts, queries and encoded slashes');
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
