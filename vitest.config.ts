import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      // Lógica pura (path, alias, redação, classificação): Node, sem runtime.
      { test: { name: 'unit', include: ['test/*.test.ts'] } },
      // Durable Object de aprovação e o Worker inteiro: runtime do Workers (Miniflare), bindings locais.
      {
        plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' }, remoteBindings: false })],
        test: { name: 'workers', include: ['test/workers/*.test.ts'] },
      },
    ],
  },
});
