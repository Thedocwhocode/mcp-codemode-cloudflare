import { describe, expect, it } from 'vitest';
import { parseFrontmatter, parseScalar } from '../scripts/frontmatter.mjs';

describe('parseScalar', () => {
  it.each([
    ['Drive a remote Code Mode MCP server.', 'Drive a remote Code Mode MCP server.'],
    ['"null"', 'null'],
    ["'it''s fine: really'", "it's fine: really"],
    ['"tab\\tand \\"quotes\\""', 'tab\tand "quotes"'],
    ['Use when the user asks to deploy (search + execute)', 'Use when the user asks to deploy (search + execute)'],
    ['version 1.0.0', 'version 1.0.0'],
    ['MIT', 'MIT'],
  ])('aceita %s', (raw, value) => expect(parseScalar(raw)).toEqual({ value }));

  it.each([
    ['null # explanation', /comentário|null/],
    ['null', /null ou booleano/],
    ['~', /null ou booleano/],
    ['false', /null ou booleano/],
    ['Yes', /null ou booleano/],
    ['123', /número/],
    ['1.0', /número/],
    ['-2e5', /número/],
    ['0x1F', /número/],
    ['.inf', /número/],
    ['[]', /indicador/],
    ['{a: 1}', /indicador/],
    ['|', /indicador/],
    ['>-', /indicador/],
    ['&anchor x', /indicador/],
    ['- item', /indicador/],
    ['"unterminated', /indicador/],
    ['text # trailing comment', /comentário/],
    ['key: value', /mapa/],
    ['', /vazio/],
  ])('recusa %s', (raw, error) => {
    const out = parseScalar(raw);
    expect(out).toHaveProperty('error');
    expect((out as { error: string }).error).toMatch(error);
  });
});

describe('parseFrontmatter', () => {
  it('lê campos de topo e ignora o mapa aninhado', () => {
    const md = '---\nname: my-skill\ndescription: Does a thing.\nmetadata:\n  version: "1.0.0"\n---\n# Body\n';
    expect(parseFrontmatter(md)).toEqual({ fields: { name: 'my-skill', description: 'Does a thing.' }, errors: [] });
  });
  it('reporta o campo que o YAML leria como outro tipo', () => {
    const md = '---\nname: x\ndescription: false\n---\n';
    const out = parseFrontmatter(md);
    expect(out?.fields).not.toHaveProperty('description');
    expect(out?.errors).toEqual([expect.stringMatching(/^description: .*booleano/)]);
  });
  it('sem frontmatter devolve null', () => expect(parseFrontmatter('# só corpo\n')).toBeNull());
});
