// Valida e empacota as skills de skills/<nome>/ (formato Agent Skills: SKILL.md + arquivos de apoio).
// Uso: node scripts/skills.mjs check   → valida frontmatter, links, tipos de arquivo e ausência de segredos
//      node scripts/skills.mjs pack    → valida e gera dist/skills/<nome>.zip (pasta <nome>/ na raiz do zip; usa o comando zip)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { parseFrontmatter } from './frontmatter.mjs';

const ROOT = 'skills';
const OUT = 'dist/skills';
const ALLOWED = /\.(md|mjs|js|json|txt)$/;
const MAX_BYTES = 200_000;
// Padrões que a varredura de marketplaces trata como credencial ou como risco.
const SECRET = /(eyJ[A-Za-z0-9_-]{20,}\.|sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY)/;
const RISKY = /(curl[^\n|]*\|\s*(ba|z)?sh|rm\s+-rf\s+[/~]|eval\(atob|process\.env\[)/;

const files = (dir) =>
  readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));

function check(name) {
  const dir = join(ROOT, name);
  const errors = [];
  const skillFile = join(dir, 'SKILL.md');
  if (!existsSync(skillFile)) return [`${name}: falta SKILL.md`];
  const text = readFileSync(skillFile, 'utf8');
  const parsed = parseFrontmatter(text);
  const fm = parsed?.fields;
  if (!parsed) errors.push('SKILL.md sem frontmatter (--- … ---)');
  else {
    errors.push(...parsed.errors.map((e) => `frontmatter ${e}`));
    if (fm.name !== name) errors.push(`name "${fm.name}" difere da pasta "${name}"`);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(fm.name ?? '') || fm.name.length > 64) errors.push('name: minúsculas, dígitos e hífens, até 64');
    // parseFrontmatter só devolve strings; um valor que o YAML leria como outro tipo já virou erro acima.
    if (!fm.description) errors.push('description ausente ou inválida (uma linha de texto)');
    else if (fm.description.length > 1024) errors.push(`description com ${fm.description.length} caracteres (máx. 1024)`);
  }
  let total = 0;
  for (const file of files(dir)) {
    const rel = relative(dir, file);
    const body = readFileSync(file, 'utf8');
    total += Buffer.byteLength(body);
    if (!ALLOWED.test(file)) errors.push(`${rel}: tipo de arquivo não permitido`);
    if (SECRET.test(body)) errors.push(`${rel}: parece conter uma credencial`);
    if (RISKY.test(body)) errors.push(`${rel}: comando de risco (${body.match(RISKY)[0]})`);
    // Links relativos em Markdown precisam existir dentro da skill.
    if (file.endsWith('.md')) {
      for (const [, target] of body.matchAll(/\]\(([^)#\s]+)\)/g)) {
        if (/^[a-z]+:/i.test(target)) continue;
        const abs = resolve(dirname(file), target);
        const inside = relative(resolve(dir), abs);
        if (inside.startsWith('..') || isAbsolute(inside)) errors.push(`${rel}: link sai da skill (${target})`);
        else if (!existsSync(abs)) errors.push(`${rel}: link quebrado (${target})`);
      }
    }
  }
  if (total > MAX_BYTES) errors.push(`skill com ${total} bytes (máx. ${MAX_BYTES})`);
  return errors.map((e) => `${name}: ${e}`);
}

const cmd = process.argv[2];
if (!['check', 'pack'].includes(cmd)) {
  console.error('uso: node scripts/skills.mjs check|pack');
  process.exit(2);
}
const names = readdirSync(ROOT).filter((n) => statSync(join(ROOT, n)).isDirectory());
const errors = names.flatMap(check);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`ok: ${names.join(', ')}`);
if (cmd === 'pack') {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  for (const name of names) {
    const zip = resolve(OUT, `${name}.zip`);
    // -X: sem atributos extras; -r: recursivo; roda dentro de skills/ para a pasta ficar na raiz do zip.
    try {
      execFileSync('zip', ['-X', '-q', '-r', zip, name], { cwd: ROOT });
    } catch (e) {
      if (e.code === 'ENOENT') {
        console.error('o comando "zip" não está instalado (Debian/Ubuntu: apt install zip; macOS já tem)');
        process.exit(1);
      }
      throw e;
    }
    console.log(`${relative('.', zip)} (${statSync(zip).size} bytes)`);
  }
}
