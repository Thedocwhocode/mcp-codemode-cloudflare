# Adapting the policy to a REST API

The stock repository targets Dokploy, which is tRPC-shaped:

- every path has exactly one method;
- there are no path parameters (`/application.deploy`, never `/apps/{id}`).

`policy/classification.json` is therefore keyed by exact path, and `classify()` in `src/policy/classify.ts` does an exact lookup.

On a REST spec that breaks in two ways:

1. **Path templates never match.** The agent calls `/apps/42`, but the table holds `/apps/{id}`. The lookup misses, so every call counts as `destructive`, reads included. Nothing unsafe happens, because the policy fails closed, but every call needs approval and the server is unusable.
2. **One path has several methods.** `GET /apps/{id}` and `DELETE /apps/{id}` share a key. `scripts/classify.mjs` throws on that by design.

`check-config.mjs` reports both as `FAIL REST-shaped spec`. Make the changes below, and show the user the diff before you run the tests.

## 1. Key the table by method and template

Change `scripts/classify.mjs` so that each entry is `"METHOD /template"`:

```js
for (const [path, item] of Object.entries(spec.paths)) {
  for (const method of Object.keys(item)) {
    if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
    table[`${method.toUpperCase()} ${path}`] = classify(path, method);
  }
}
```

Starting rules for REST. Review them with the user:

| Rule | Class |
|---|---|
| `GET` / `HEAD` | read. Exceptions: endpoints that return raw files, secrets, keys or tokens are `destructive` |
| `DELETE` | destructive |
| `POST` / `PUT` / `PATCH` whose path holds a verb such as `cancel`, `revoke`, `rotate`, `reset`, `stop`, `restore`, `transfer` | destructive |
| Anything under users, members, roles, billing, keys, tokens, webhooks or settings | destructive |
| Other `POST` / `PUT` / `PATCH` | write |

## 2. Match concrete paths against templates

Replace the body of `src/policy/classify.ts` with:

```ts
import table from '../../policy/classification.json';
import type { Mode } from '../config/projects';

export type OpClass = 'read' | 'write' | 'destructive';

const esc = (s: string) => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
// Literal routes first, so "/apps/search" wins over "/apps/{id}".
const routes = Object.entries(table as Record<string, OpClass>)
  .map(([key, cls]) => {
    const [method, tpl] = key.split(' ');
    return { method, cls, literal: !tpl.includes('{'), re: new RegExp(`^${esc(tpl).replace(/\{[^/}]+\}/g, '[^/]+')}$`) };
  })
  .sort((a, b) => Number(b.literal) - Number(a.literal));

// Not in the table = destructive: fail closed.
export function classify(method: string, path: string): OpClass {
  return routes.find((r) => r.method === method && r.re.test(path))?.cls ?? 'destructive';
}

export type Decision = 'allow' | 'approval' | 'deny';

export function decide(mode: Mode, cls: OpClass): Decision {
  if (cls === 'read') return 'allow';
  if (mode !== 'readwrite') return 'deny';
  return cls === 'write' ? 'allow' : 'approval';
}
```

The method check (`r.method === method`) replaces the old rule "read must be GET".

## 3. Loosen `pathPattern`, but not too much

Path parameters now carry real values, so `API.pathPattern` has to accept them. It must still refuse:

- a host;
- `..`;
- a query string;
- encoded slashes.

For example:

```ts
pathPattern: /^\/(?!.*\.\.)(?!.*%2f)[A-Za-z0-9._~\-/]+$/i,
pathExample: '/apps/123',
```

## 4. Update the tests

- `test/policy.test.ts` uses Dokploy paths. Rewrite it for the new key format.
- Keep the fail-closed case: an unknown path must come back as destructive.
- Add three cases:
  - a template match (`GET /apps/42` → read);
  - a literal route that wins over a template;
  - a method mismatch (`DELETE` on a path that only has a read rule → destructive).

Then run `npm run typecheck && npm test` and the checker again. The checker sees `"METHOD /template"` keys and checks the table per method instead of failing on the REST shape.
