# REST APIs

The server handles both API shapes. Nothing in `src/` beyond `src/config/` needs to change.

| | RPC (the Dokploy example) | REST |
|---|---|---|
| Path | `/application.deploy` | `/apps/{id}/deploy` |
| Methods per path | one | several (`GET`, `PATCH`, `DELETE` on `/apps/{id}`) |
| Policy key | `"POST /application.deploy"` | `"DELETE /apps/{id}"` |

The policy table (`policy/classification.json`) is always keyed by `"METHOD /template"`, in the same form as the OpenAPI spec. At runtime the server matches the concrete path the agent sends (`/apps/42`) against the templates:

- one `{param}` matches exactly one path segment, never a `/`;
- the most specific route wins (`/apps/search` before `/apps/{id}`);
- a path or method missing from the table counts as `destructive` (fail closed);
- an entry that says `read` on anything but `GET`/`HEAD` also counts as `destructive`, because `read` passes even on `readonly` projects.

## What to set in `src/config/api.ts`

```ts
baseUrl: 'https://api.example.com/v1',
authHeader: 'authorization',
authPrefix: 'Bearer ',            // with the trailing space; '' when the header takes the bare key
methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const,   // only the ones the spec uses
pathPattern: PATH_PATTERNS.rest,
pathExample: '/apps/123',
```

`PATH_PATTERNS.rest` accepts real values in the path. It refuses:

- a host;
- `..` and `//`;
- a query string;
- an encoded slash (`%2f`);
- spaces.

Query parameters go in `query`, never in the path.

## Spec and classification

```bash
npm run spec:trim       # spec/raw.json → spec/openapi.json
npm run spec:classify   # spec/openapi.json → policy/classification.json
```

`spec:trim` does the following:

- keeps `components.schemas`, `components.parameters` and `components.requestBodies`, so `$ref`s still resolve;
- merges path-level `parameters` into each operation;
- drops responses, examples and deprecated operations;
- cuts long descriptions at 300 characters.

`spec:classify` applies the rules in `scripts/policy-rules.mjs`:

| Rule | Class |
|---|---|
| `GET` / `HEAD` | read |
| `GET` on secrets, credentials, tokens, keys, env/vars, files, raw, download, export | destructive |
| `DELETE` | destructive |
| `POST` / `PUT` / `PATCH` with an action segment such as `cancel`, `revoke`, `rotate`, `reset`, `restore`, `transfer`, `refund`, `send`, `publish`, `merge`, `stop` | destructive |
| Any write under users, members, orgs, teams, roles, permissions, billing, payments, subscriptions, keys, tokens, secrets, webhooks, settings, auth | destructive |
| Other `POST` / `PUT` / `PATCH` | write |

These rules lean towards `destructive`, so a new API starts out safe and a little too strict. Go through the table with the user:

- **Downgrade to `write`** an operation the agent should run freely, for example `POST /users/{id}/avatar`.
- **Upgrade to `destructive`** anything the rules missed: an operation that spends money, sends email or SMS, changes DNS, or replaces a whole resource with `PUT`.

Edit `scripts/policy-rules.mjs` when the change should survive the next `spec:classify`. Edit the JSON directly for a one-off.

## Checks

```bash
node <this-skill-folder>/scripts/check-config.mjs .
npm run typecheck && npm test
```

The checker reports:

- spec methods that `API.methods` does not allow;
- spec paths that `API.pathPattern` refuses (with a hint to use `PATH_PATTERNS.rest`);
- a bare `Authorization` header with no `authPrefix`;
- old `"/path"` keys in the policy table. The server refuses to start with those.

The unit tests in `test/policy.test.ts` cover template matching with a sample REST table. The server's own tests use the Dokploy table. After the user's table is in place, add two or three cases for their API (one read, one write, one destructive) to `test/policy.test.ts`.
