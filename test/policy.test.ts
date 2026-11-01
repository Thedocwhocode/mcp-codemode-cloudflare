import { describe, expect, it } from 'vitest';
import { classifyOperation } from '../scripts/policy-rules.mjs';
import { classify, compilePolicy, decide } from '../src/policy/classify';

describe('classify', () => {
  it.each([
    ['GET', '/project.all', 'read'],
    ['POST', '/application.deploy', 'write'],
    ['POST', '/application.delete', 'destructive'],
    ['POST', '/application.stop', 'destructive'],
    ['POST', '/application.saveEnvironment', 'destructive'],
    ['POST', '/schedule.runManually', 'destructive'],
    ['POST', '/settings.cleanAll', 'destructive'],
    ['POST', '/user.createApiKey', 'destructive'],
    ['GET', '/docker.readContainerFile', 'destructive'],
  ])('%s %s → %s', (method, path, cls) => expect(classify(method, path)).toBe(cls));

  it('fora da tabela é destructive', () => expect(classify('GET', '/inventado.qualquer')).toBe('destructive'));
  it('método trocado é destructive', () => {
    expect(classify('POST', '/project.all')).toBe('destructive');
    expect(classify('GET', '/application.deploy')).toBe('destructive');
  });
});

describe('decide', () => {
  it('readonly só lê', () => {
    expect(decide('readonly', 'read')).toBe('allow');
    expect(decide('readonly', 'write')).toBe('deny');
    expect(decide('readonly', 'destructive')).toBe('deny');
  });
  it('readwrite escreve e pede aprovação para destrutiva', () => {
    expect(decide('readwrite', 'write')).toBe('allow');
    expect(decide('readwrite', 'destructive')).toBe('approval');
  });
});

describe('compilePolicy (REST)', () => {
  const rest = compilePolicy({
    'GET /apps': 'read',
    'POST /apps': 'write',
    'GET /apps/search': 'read',
    'GET /apps/{id}': 'read',
    'PATCH /apps/{id}': 'write',
    'DELETE /apps/{id}': 'destructive',
    'POST /apps/{id}/deploy': 'write',
    'POST /apps/{id}/{action}': 'destructive',
    'POST /apps/{id}/sneaky': 'read',
  });

  it.each([
    ['GET', '/apps', 'read'],
    ['POST', '/apps', 'write'],
    ['GET', '/apps/42', 'read'],
    ['PATCH', '/apps/42', 'write'],
    ['DELETE', '/apps/42', 'destructive'],
    ['POST', '/apps/42/deploy', 'write'],
    ['POST', '/apps/42/restart', 'destructive'],
    ['get', '/apps/42', 'read'],
  ])('%s %s → %s', (method, path, cls) => expect(rest(method, path)).toBe(cls));

  it('literal vence template', () => {
    expect(rest('GET', '/apps/search')).toBe('read');
    expect(rest('DELETE', '/apps/search')).toBe('destructive');
  });
  it('método sem entrada para o path é destructive', () => expect(rest('PUT', '/apps/42')).toBe('destructive'));
  it('{param} casa um segmento só', () => {
    expect(rest('GET', '/apps/42/extra')).toBe('destructive');
    expect(rest('GET', '/apps/')).toBe('destructive');
  });
  it('"read" fora de GET/HEAD vira destructive', () => expect(rest('POST', '/apps/42/sneaky')).toBe('destructive'));
  it('template mais específico vence o genérico', () => {
    const t = compilePolicy({ 'GET /apps/{id}/{section}': 'read', 'GET /apps/{id}/keys': 'destructive' });
    expect(t('GET', '/apps/42/keys')).toBe('destructive');
    expect(t('GET', '/apps/42/logs')).toBe('read');
  });
  it('empate entre templates fica com a classe mais restritiva', () => {
    const t = compilePolicy({ 'GET /apps/{id}/keys': 'destructive', 'GET /{kind}/42/keys': 'read' });
    expect(t('GET', '/apps/42/keys')).toBe('destructive');
    const u = compilePolicy({ 'GET /{kind}/42/keys': 'read', 'GET /apps/{id}/keys': 'write' });
    expect(u('GET', '/apps/42/keys')).toBe('write');
  });
  it('chave fora do formato "MÉTODO /path" quebra no carregamento', () => {
    expect(() => compilePolicy({ '/apps': 'read' })).toThrow(/chave de política inválida/);
  });
});

describe('regras do gerador (scripts/policy-rules.mjs)', () => {
  it.each([
    ['/apps', 'get', 'read'],
    ['/apps/{id}', 'head', 'read'],
    ['/apps', 'post', 'write'],
    ['/apps/{id}', 'put', 'write'],
    ['/apps/{id}', 'delete', 'destructive'],
    ['/apps/{id}/cancel', 'post', 'destructive'],
    ['/subscriptions/{id}', 'patch', 'destructive'],
    ['/orgs/{org}/members', 'post', 'destructive'],
    ['/projects/{id}/api-keys', 'post', 'destructive'],
    ['/projects/{id}/secrets', 'get', 'destructive'],
    ['/apps/{id}/env', 'get', 'destructive'],
    ['/application.deploy', 'post', 'write'],
    ['/application.delete', 'post', 'destructive'],
    ['/docker.readContainerFile', 'get', 'destructive'],
  ])('%s %s → %s', (path, method, cls) => expect(classifyOperation(path, method)).toBe(cls));
});
