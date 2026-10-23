// Smoke test do MCP contra um `wrangler dev --remote`: lista os tools e roda um código em um deles.
// Uso: node scripts/smoke.mjs <tool> <arquivo-com-o-código | approvalId> [url]
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const [tool, file, url = 'http://127.0.0.1:8799/mcp'] = process.argv.slice(2);
const client = new Client({ name: 'smoke', version: '0.0.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(url)));
const { tools } = await client.listTools();
console.log('tools:', tools.map((t) => `${t.name} (${JSON.stringify(t).length} chars)`).join(', '));
if (tool) {
  const args = tool === 'approve' ? { approvalId: file } : { code: readFileSync(file, 'utf8') };
  const res = await client.callTool({ name: tool, arguments: args });
  console.log(res.isError ? 'ERRO:' : 'ok:', res.content.map((c) => c.text).join('\n'));
}
await client.close();
