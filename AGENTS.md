# AGENTS.md

## Commands

### Type-check (frontend)
```bash
cd frontend && node ../node_modules/.bin/tsc --noEmit
```

### Lint (backend)
```bash
cd backend && node --check <file>
```

### Tests
```bash
npm test          # static suites: permission catalog guard + task code migration/restore
npm run test:live # suites that need a running backend on :3001 and touch real data
```

## Permissions

The **System Permissions Catalog** lives in `backend/src/permissions.js` as
`PERMISSION_MODULES`. A role's permissions are the permission *ids*, so grouping
them into a different module is a display-only change and needs no migration.

When adding a feature:

1. Add a module to `PERMISSION_MODULES`. Every permission must be namespaced
   under its own module id (`tasks.*` inside the `tasks` module) and carry a
   `name` and `description`.
2. Enforce it with `requirePermission('feature.action')` in the route file.
3. If existing role groups should receive it, add the id to `PERMISSION_GRANTS`
   in the same file. The seed loop only inserts a *missing* role group, so a
   permission added after a database was first created will not reach groups
   that already exist without this.
4. Gate the frontend nav item and route on it. `RolePermissionManager` renders
   straight from the catalog, so it needs no change.

`npm test` runs `backend/tests/permission-catalog.test.mjs`, which fails if a
route file declares no permissions and is not listed with a reason in
`ROUTES_WITHOUT_PERMISSIONS`, if a route enforces an undeclared permission, or
if `PERMISSION_GRANTS` and `DEFAULT_ROLE_GROUPS` disagree. Run it after any
permission change.
