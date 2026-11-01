# Search and execute patterns

Copy a pattern, change the filter, and keep the return value small.

Two conventions in these examples:

- `HTTP` lists the method keys. A path item can also hold `parameters`, `summary` or `$ref`, which are not operations.
- `PROJECT` is an alias from `spec["x-projects"]`. Replace it with the real one.

## Search (`codemode.spec()` only, no requests)

### Count operations per tag (first look at an unknown API)

```js
async () => {
  const spec = await codemode.spec();
  const tags = {};
  const HTTP = ["get", "head", "post", "put", "patch", "delete"];
  for (const ops of Object.values(spec.paths))
    for (const [method, op] of Object.entries(ops)) if (HTTP.includes(method))
      for (const t of op.tags ?? ["(none)"]) tags[t] = (tags[t] ?? 0) + 1;
  return { title: spec.info?.title, total: Object.keys(spec.paths).length, tags };
}
```

### Every operation of one tag, compact

```js
async () => {
  const spec = await codemode.spec();
  const HTTP = ["get", "head", "post", "put", "patch", "delete"];
  const out = [];
  for (const [path, ops] of Object.entries(spec.paths))
    for (const [method, op] of Object.entries(ops))
      if (HTTP.includes(method) && op.tags?.includes("application"))
        out.push(`${method.toUpperCase()} ${path}${op.summary ? " · " + op.summary : ""}`);
  return out;
}
```

### Full input schema of one operation

Use this right before a write, so the body has every required field. Name the method: a REST path can have several.

```js
async () => {
  const [path, method] = ["/application.deploy", "post"];
  const def = (await codemode.spec()).paths[path]?.[method];
  if (!def) return { error: `no ${method.toUpperCase()} ${path} in the spec` };
  return {
    method: method.toUpperCase(),
    query: def.parameters ?? [],
    body: def.requestBody?.content?.["application/json"]?.schema ?? null,
  };
}
```

### Find operations that take a given field

Use this to answer "what can I do with an `applicationId`?".

```js
async () => {
  const spec = await codemode.spec();
  const field = "applicationId";
  const HTTP = ["get", "head", "post", "put", "patch", "delete"];
  const out = [];
  for (const [path, ops] of Object.entries(spec.paths))
    for (const [method, op] of Object.entries(ops)) {
      if (!HTTP.includes(method)) continue;
      const inQuery = (op.parameters ?? []).some((p) => p.name === field);
      const inBody = field in (op.requestBody?.content?.["application/json"]?.schema?.properties ?? {});
      if (inQuery || inBody) out.push(`${method.toUpperCase()} ${path}`);
    }
  return out;
}
```

## Execute (`codemode.request()`)

### Resolve a name to an id, then act

Users say "the api app". The API wants an id. Do the lookup and the action in the same run.

```js
async () => {
  const PROJECT = "exemplo";
  const projects = await codemode.request({ project: PROJECT, method: "GET", path: "/project.all" });
  const apps = projects.flatMap((p) => p.environments.flatMap((e) => e.applications));
  const matches = apps.filter((a) => /api/i.test(a.name));
  if (matches.length !== 1) return { ambiguous: matches.map((a) => ({ name: a.name, id: a.applicationId })) };
  return codemode.request({
    project: PROJECT, method: "POST", path: "/application.deploy",
    body: { applicationId: matches[0].applicationId, title: "Deploy requested via MCP" },
  });
}
```

If the name matches more than one resource, return the candidates and ask the user. Do not pick one.

### Fan out within the 50-request budget

```js
async () => {
  const PROJECT = "exemplo";
  const BATCH = 40; // 1 list call + 40 detail calls = 41, under the 50-request limit
  const OFFSET = 0; // next run: OFFSET = 40, 80…
  const projects = await codemode.request({ project: PROJECT, method: "GET", path: "/project.all" });
  const all = projects.flatMap((p) => p.environments.flatMap((e) => e.applications));
  const apps = all.slice(OFFSET, OFFSET + BATCH);
  const rows = await Promise.all(apps.map(async (a) => {
    const deps = await codemode.request({ project: PROJECT, method: "GET", path: "/deployment.all", query: { applicationId: a.applicationId } });
    const last = [...deps].sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)))[0];
    return { app: a.name, status: last?.status, at: last?.createdAt };
  }));
  const done = OFFSET + apps.length;
  // Say what was not checked, so the answer never looks complete when it is not.
  return { failed: rows.filter((r) => r.status === "error"), checked: `${done} of ${all.length}`, nextOffset: done < all.length ? done : null };
}
```

Count the requests before you run. If `nextOffset` is not null, run again with that `OFFSET` before you tell the user the result.

### Handle errors per item

A single thrown error ends the whole run. Catch errors per item so one bad item does not hide the rest.

```js
const safe = (p) => p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, error: String(e.message ?? e) }));
```

### Trim logs in code

```js
async () => {
  const text = await codemode.request({ project: "exemplo", method: "GET", path: "/application.readLogs", query: { applicationId: "abc", tail: 500, since: "1h" } });
  const lines = String(text).split("\n");
  return lines.filter((l) => /error|fatal|panic|exception/i.test(l)).slice(-60);
}
```
