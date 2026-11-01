# Dokploy behind the Code Mode server

Read this only when `spec.info.title` is "Dokploy API".

## Conventions

- Dokploy is tRPC. A path looks like `/<router>.<procedure>`, for example `/application.deploy`.
- `GET` is a query: put the arguments in `query`.
- `POST` is a mutation: put the JSON in `body`.
- Ids are strings: `projectId`, `environmentId`, `applicationId`, `composeId`, `postgresId` and so on.

## Shape of `/project.all`

Services are not at the top of a project. They sit inside environments:

```
project
└─ environments[]
   ├─ applications[]   (applicationId, name, applicationStatus)
   ├─ compose[]        (composeId, name, composeStatus)
   └─ postgres[] · mysql[] · mariadb[] · mongo[] · redis[] · libsql[]
```

## Common tasks and their policy class

| Task | Operation | Class in the reference policy |
|---|---|---|
| List everything | `GET /project.all` | read |
| One app in detail | `GET /application.one?applicationId=` | read |
| Deploy history | `GET /deployment.all?applicationId=` | read |
| App logs | `GET /application.readLogs?applicationId=&tail=&since=&search=` | read |
| Deploy / redeploy | `POST /application.deploy`, `/application.redeploy` | write |
| Start | `POST /application.start` | write |
| Stop | `POST /application.stop` | destructive: needs approval |
| Reload (restart) | `POST /application.reload` | destructive: needs approval |
| Change env vars | `POST /application.saveEnvironment` | destructive: it replaces the whole env |
| Delete | `POST /application.delete` | destructive: needs approval |
| Compose equivalents | `/compose.one`, `/compose.deploy`, `/compose.readLogs`, `/compose.stop`… | same pattern |

Notes:

- `since` takes `all` or a value like `30m`, `2h`, `1d`.
- `search` in `readLogs` accepts only letters, digits, space, `.`, `_` and `-`.
- `saveEnvironment` replaces the env, it does not merge. The current values come back `[REDACTED]`, so you cannot rebuild them yourself. Tell the user to change env vars in the Dokploy UI.
- After a deploy, check `/deployment.all` for the newest entry. `applicationStatus: "done"` means the build finished, not that the app answers requests.
