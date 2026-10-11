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

When touching routes or permissions, keep these invariants by hand:
a route file must declare every permission it enforces (or document
why it has none), must never enforce an undeclared permission, and
`PERMISSION_GRANTS` and `DEFAULT_ROLE_GROUPS` must agree. Verify
with `cd backend && node --check <file>` after any permission change.
