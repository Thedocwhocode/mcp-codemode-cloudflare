// Leitor mínimo do frontmatter de um SKILL.md, sem dependência de YAML.
// Só aceita, para cada campo de topo, uma string de uma linha numa forma que todo leitor YAML lê igual:
// entre aspas ("…" ou '…') ou "plain" sem nada que o YAML trate como outro tipo ou como sintaxe.

// Palavras que o YAML (1.1 ou 1.2) lê como null ou booleano.
const NON_STRING_WORD = /^(null|nil|~|true|false|yes|no|on|off|y|n)$/i;
// Números: inteiro, decimal, exponencial, hexa/octal/binário, .inf, .nan.
const NUMBER = /^[-+]?(\d[\d_]*(\.\d*)?([eE][-+]?\d+)?|\.\d+([eE][-+]?\d+)?|0x[\da-f_]+|0o[0-7_]+|0b[01_]+|\.inf|\.nan)$/i;
// Primeiro caractere que abre outra construção YAML (lista, mapa, bloco, âncora, tag, diretiva…).
const INDICATOR_START = /^[[\]{}|>&*!%@`,#?:'"]|^- /;

// Devolve { value } para uma string válida, ou { error } explicando por que não é uma.
export function parseScalar(raw) {
  const text = raw.trim();
  if (text === '') return { error: 'vazio' };
  const dq = text.match(/^"((?:[^"\\]|\\.)*)"$/);
  if (dq) return { value: JSON.parse(`"${dq[1]}"`) };
  const sq = text.match(/^'((?:[^']|'')*)'$/);
  if (sq) return { value: sq[1].replace(/''/g, "'") };
  if (NON_STRING_WORD.test(text)) return { error: `"${text}" é lido como null ou booleano; use aspas` };
  if (NUMBER.test(text)) return { error: `"${text}" é lido como número; use aspas` };
  if (INDICATOR_START.test(text)) return { error: 'começa com um indicador YAML (lista, mapa, bloco, aspas soltas…); use aspas' };
  if (/\s#/.test(text)) return { error: 'tem " #", que o YAML lê como comentário; use aspas' };
  if (/:(\s|$)/.test(text)) return { error: 'tem ": ", que o YAML lê como mapa; use aspas' };
  return { value: text };
}

// Lê os campos de topo. Linhas indentadas (ex.: dentro de "metadata:") são ignoradas.
// Retorna null se não houver frontmatter; senão { fields, errors }.
export function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return null;
  const fields = {};
  const errors = [];
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-z][a-z0-9-]*):(.*)$/);
    if (!kv) continue;
    const [, key, rest] = kv;
    if (rest.trim() === '') continue; // mapa aninhado (metadata:) ou campo vazio, tratado por quem exige o campo
    const parsed = parseScalar(rest);
    if ('error' in parsed) errors.push(`${key}: ${parsed.error}`);
    else fields[key] = parsed.value;
  }
  return { fields, errors };
}
