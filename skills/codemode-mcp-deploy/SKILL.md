---
name: codemode-mcp-deploy
description: Set up, adapt and deploy the open-source mcp-codemode-cloudflare server, a remote Code Mode MCP (search + execute + approve) that runs on a Cloudflare Worker behind Cloudflare Access and puts any OpenAPI-described API in front of a coding agent with three tools, per-project keys in the Secrets Store, read-only/read-write modes and approval for destructive calls. Use when the user wants to expose an API (public, or private behind a Cloudflare Tunnel) to Claude Code, Cursor or another MCP client without handing the agent the API key, or asks to configure, check or deploy this repository.
license: MIT
compatibility: Needs Node 20+, the wrangler CLI logged in to a Cloudflare account on the Workers Paid plan, and a domain on Cloudflare. Works best in a shell-capable agent with the repository checked out.
metadata:
  version: "1.0.0"
  source: https://github.com/Thedocwhocode/mcp-codemode-cloudflare
---

# Deploy a Code Mode MCP server on Cloudflare

The repository [mcp-codemode-cloudflare](https://github.com/Thedocwhocode/mcp-codemode-cloudflare) turns an OpenAPI spec into a remote MCP server with three tools:

- `search` reads the spec.
- `execute` runs agent-written JavaScript in a sandbox with no network. Its only way out is `codemode.request()`.
- `approve` runs one destructive call that the user approved.

The Worker validates every request, applies the policy and injects the key. The agent never sees the key.

Your job is to take the user from a fresh checkout to a working `claude mcp add`. Go one stage at a time. Do not move to the next stage until the current one is done.

## Ground rules

- **Never handle a secret.** API keys go in only through `npx wrangler secrets-store secret create …`, which prompts the user for the value without echoing it. Do not ask the user to paste a key into the chat, and do not write one to any file, `.dev.vars` included.
- **Do not deploy or change the Cloudflare account without a yes.** Before `wrangler deploy`, `secrets-store … create`, `vpc service create` or any Zero Trust change, say what will happen and wait for the user.
- **Edit only these files:**
  - `src/config/api.ts`
  - `src/config/projects.ts`
  - `wrangler.jsonc`
  - `spec/openapi.json`
  - `policy/classification.json`
  - the two scripts in `scripts/`, when adapting to a new API

  Touch `src/` beyond `config/` only for the REST adaptation described in [references/rest-apis.md](references/rest-apis.md).
- **Fail closed.** When you are unsure how to classify an operation, use `destructive`.

## Stage 1: Gather the inputs

Ask for anything the user has not already given you:

1. The API's base URL, and whether it is public or private (only reachable on a server or LAN).
2. The auth header the API expects (for example `x-api-key`, or `Authorization: Bearer`).
3. Where the OpenAPI JSON is: a URL or a file.
4. The projects or keys: a short alias for each, `readonly` or `readwrite`, and a one-line description.
5. The hostname for the MCP server (for example `mcp.example.com`, on a zone in their Cloudflare account) and the emails allowed in.

## Stage 2: Describe the API (`src/config/api.ts`)

Set these fields:

| Field | What to set |
|---|---|
| `name` | Short API name. It shows up in the audit log |
| `baseUrl` | The real origin for a public API. For a private API, the local origin (for example `http://127.0.0.1:3000/api`) |
| `authHeader` | The header name |
| `methods` | The HTTP methods the spec uses |
| `pathPattern` | A regex that matches every spec path and nothing with a host, `..` or `?` |
| `pathExample` | One real path |
| `sensitiveFields` | Response fields to mask. Keep the defaults and add the API's own names |
| `help` | Two or three lines on call conventions and the shape of the main list endpoint |

If the API wants `Authorization: Bearer <key>`, the header value needs a prefix. Change the `headers` line in `src/upstream/client.ts` to send `` `Bearer ${key}` ``, and add a unit test for it in `test/client.test.ts`.

## Stage 3: Spec and policy

1. Save the raw spec as `spec/raw.json`. Git ignores it.
2. Run `npm run spec:trim`, then `npm run spec:classify`.
3. Both scripts were written for Dokploy (tRPC: one method per path, no path parameters). Before you trust their output on another API, read [references/rest-apis.md](references/rest-apis.md).
4. Show the user the counts and a sample of each class from `policy/classification.json`. Ask them to look at the `write` list in particular. Anything that deletes, stops, rotates credentials, changes permissions, spends money or sends messages must be `destructive`.

## Stage 4: Projects and keys

1. Edit `src/config/projects.ts`: one entry per alias, with `keyBinding` in UPPER_SNAKE case.
2. Tell the user to create each key in the API with the least permissions it needs. The MCP mode is a second barrier, not the only one.
3. With the user's yes, create the store once:

   ```bash
   npx wrangler secrets-store store create mcp-keys --remote
   ```

4. Then create each secret. The user types the value at the prompt:

   ```bash
   npx wrangler secrets-store secret create <STORE_ID> --name <secret_name> --scopes workers --remote
   ```

5. Add one `secrets_store_secrets` entry per project to `wrangler.jsonc`, with the same `binding` name as in `projects.ts`.

## Stage 5: Cloudflare Access (the user does this in the dashboard)

Walk the user through these steps:

1. Zero Trust → Access → Applications → Add an application → Self-hosted.
2. Set the domain to the MCP hostname.
3. Add a policy: Allow, with the user's emails.
4. Turn on **Managed OAuth** for the application.
5. Copy the **Application Audience (AUD) Tag** and the team domain.

Put these in `wrangler.jsonc`:

- `routes`
- `vars.ACCESS_TEAM_DOMAIN`
- `vars.ACCESS_AUD`

Leave `workers_dev` and `preview_urls` set to `false`. Either URL would skip Access.

## Stage 6: Private API only (Tunnel + Workers VPC)

1. The user creates a Cloudflared tunnel with **no public hostname** and runs `cloudflared` on the API's server. The repository has a systemd unit in `infra/cloudflared.service`. The tunnel token goes in a file with mode `0600`, never in git.
2. With the user's yes, create the VPC service:

   ```bash
   npx wrangler vpc service create <name> --type http --tunnel-id <TUNNEL_ID> --ipv4 127.0.0.1 --http-port <PORT>
   ```

3. Uncomment `vpc_services` in `wrangler.jsonc` and set the service id.

## Stage 7: Check, test, deploy

Run the bundled checker from the repository root. It reads local files only and makes no network calls:

```bash
node <this-skill-folder>/scripts/check-config.mjs .
```

Fix every `FAIL`, explain every `WARN` to the user, then run:

```bash
npm run typecheck && npm test
```

All tests must pass. Do not skip or delete a test to get green.

With the user's yes, run `npm run deploy`. Then check that Access answers before the Worker does:

```bash
curl -i https://<mcp-hostname>/mcp
```

The expected answer is 401 with an OAuth `WWW-Authenticate`, or a redirect to the Access login. A 200 or a 403 from the Worker means Access is not in front of it. Stop and fix that before you go on.

## Stage 8: Connect the agent

```bash
claude mcp add --scope user --transport http <name> https://<mcp-hostname>/mcp
claude mcp login <name>
```

Other MCP clients take the same URL as a remote HTTP server with OAuth.

To check that it works, ask for a read-only task, for example "list the resources of project <alias>". Workers Logs should show an `audit` line for the call.

If the companion skill **codemode-mcp** is installed, the agent will follow the search → execute → approve workflow by itself.

## Costs to mention

- Workers Paid is $5 a month. It includes about 1,000 sandbox runs a day.
- Each `search` or `execute` uses one sandbox run.
- Above that, each run costs about $0.002.
- Cloudflare has no spending cap on Workers. Suggest a billing alert.

Prices change: send the user to the Cloudflare pricing pages before they commit.
