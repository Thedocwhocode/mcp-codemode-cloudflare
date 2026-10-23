import { describe, expect, it } from 'vitest';
import { redact, resolveProject, validatePath } from '../src/upstream/client';

describe('validatePath', () => {
  it.each(['/project.all', '/application.one', '/settings.getOpenApiDocument'])('aceita %s', (p) => {
    expect(validatePath(p)).toBe(p);
  });
  it.each(['project.all', '/../project.all', '//evil.com/x.y', 'http://x/a.b', '/a.b/c', '/a.b?x=1', '/a', '', 42])(
    'recusa %s',
    (p) => expect(() => validatePath(p)).toThrow(/"path" inválido/),
  );
});

describe('resolveProject', () => {
  it('resolve alias conhecido', () => expect(resolveProject('exemplo')[0]).toBe('exemplo'));
  it('erro lista os válidos', () => expect(() => resolveProject('inexistente')).toThrow(/Válidos: .*exemplo/));
  it('exige project', () => expect(() => resolveProject(undefined)).toThrow(/"project" inválido/));
});

describe('redact', () => {
  it('esconde segredos em qualquer profundidade e mantém o resto', () => {
    const out = redact({
      name: 'app', env: 'A=1', databasePassword: 'x', nested: [{ refreshToken: 't', status: 'done' }], apiKey: 'k',
    });
    expect(out).toEqual({
      name: 'app', env: '[REDACTED]', databasePassword: '[REDACTED]', nested: [{ refreshToken: '[REDACTED]', status: 'done' }],
      apiKey: '[REDACTED]',
    });
  });
});
