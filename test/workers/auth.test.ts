import { exports as ex } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const worker = (ex as unknown as { default: Fetcher }).default;

describe('endpoint MCP', { timeout: 30_000 }, () => {
  it('sem JWT do Access é negado', async () => {
    const res = await worker.fetch('https://mcp.exemplo.com/mcp', { method: 'POST', body: '{}' });
    expect(res.status).toBe(403);
  });
  it('qualquer outro caminho também exige o Access', async () => {
    const res = await worker.fetch('https://mcp.exemplo.com/qualquer');
    expect(res.status).toBe(403);
  });
  it('JWT forjado é negado', async () => {
    const res = await worker.fetch('https://mcp.exemplo.com/mcp', { method: 'POST', headers: { 'cf-access-jwt-assertion': 'a.b.c' } });
    expect(res.status).toBe(403);
  });
});
