# Search and execute patterns

Copy a pattern, change the filter, and keep the return value small.

## Search (`codemode.spec()` only, no requests)

### Count operations per tag (first look at an unknown API)

```js
async () => {
  const spec = await codemode.spec();
  const tags = {};
  for (const ops of Object.values(spec.paths))
    for (const op of Object.values(ops))
      for (const t of op.tags ?? ["(none)"]) tags[t] = (tags[t] ?? 0) + 1;
  return { title: spec.info?.title, total: Object.keys(spec.paths).length, tags };
}
```

### Every operation of one tag, compact

```js
async () => {
  const spec = await codemode.spec();
  const out = [];
  for (const [path, ops] of Object.entries(spec.paths))
    for (const [method, op] of Object.entries(ops))
      if (op.tags?.includes("application"))
        out.push(`${method.toUpperCase()} ${path}${op.summary ? " · " + op.summary : ""}`);
  return out;
}
```

### Full input schema of one operation

Use this right before a write, so the body has every required field.

```js
async () => {
  const op = (await codemode.spec()).paths["/application.deploy"];
  const [method, def] = Object.entries(op)[0];
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
  const out = [];
  for (const [path, ops] of Object.entries(spec.paths))
    for (const [method, op] of Object.entries(ops)) {
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
  const projects = await codemode.request({ project: "example", method: "GET", path: "/project.all" });
  const apps = projects.flatMap((p) => p.environments.flatMap((e) => e.applications));
  const matches = apps.filter((a) => /api/i.test(a.name));
  if (matches.length !== 1) return { ambiguous: matches.map((a) => ({ name: a.name, id: a.applicationId })) };
  return codemode.request({
    project: "example", method: "POST", path: "/application.deploy",
    body: { applicationId: matches[0].applicationId, title: "Deploy requested via MCP" },
  });
}
```

If the name matches more than one resource, return the candidates and ask the user. Do not pick one.

### Fan out within the 50-request budget

```js
async () => {
  const projects = await codemode.request({ project: "example", method: "GET", path: "/project.all" });
  const apps = projects.flatMap((p) => p.environments.flatMap((e) => e.applications)).slice(0, 40);
  const rows = await Promise.all(apps.map(async (a) => {
    const deps = await codemode.request({ project: "example", method: "GET", path: "/deployment.all", query: { applicationId: a.applicationId } });
    const last = [...deps].sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)))[0];
    return { app: a.name, status: last?.status, at: last?.createdAt };
  }));
  return rows.filter((r) => r.status === "error");
}
```

Count the requests before you run. One list call plus 40 detail calls is 41, which fits. For more than 49 resources, split into several `execute` runs.

### Handle errors per item

A single thrown error ends the whole run. Catch errors per item so one bad item does not hide the rest.

```js
const safe = (p) => p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, error: String(e.message ?? e) }));
```

### Trim logs in code

```js
async () => {
  const text = await codemode.request({ project: "example", method: "GET", path: "/application.readLogs", query: { applicationId: "abc", tail: 500, since: "1h" } });
  const lines = String(text).split("\n");
  return lines.filter((l) => /error|fatal|panic|exception/i.test(l)).slice(-60);
}
```
