import { describe, expect, it } from 'vitest';
import { classify, decide } from '../src/policy/classify';

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
