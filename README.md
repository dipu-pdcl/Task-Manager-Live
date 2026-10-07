# TaskFlow — Enterprise Task Management System

A modern, enterprise-grade Task Management System with Role-Based Access Control (RBAC),
separate Admin and User dashboards, KPI-driven performance management, and a premium
glassmorphism UI with full dark/light theming.

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS 4 + Recharts + Lucide icons
- **Backend**: Node.js (Express) + built-in `node:sqlite` (no external DB needed)
- **Auth**: JWT (bcrypt-hashed passwords), role-based access control
- **Exports**: CSV, Excel (.xlsx via ExcelJS), PDF (via PDFKit)

## Quick Start

The easiest way to set up and start the whole application (dependencies, frontend build,
JWT configuration, database, server) is one of the launcher scripts — supports Windows and Linux:

```bash
# Windows (one command)
start.bat

# Linux / macOS (one command)
chmod +x start.sh
./start.sh
```

Both scripts automatically verify Node.js 22.5+, install backend & frontend dependencies,
build the frontend, create a persistent `JWT_SECRET` in `backend/.env`, initialize the SQLite
database, and start the production server on `http://localhost:3001`
(specify a port: `start.bat 8080` or `./start.sh 8080`). On Linux,
`./start.sh --systemd` additionally installs a boot-starting systemd service.

For local development with hot reload:

```bash
# Install dependencies
npm run install:all

# Run both services (backend :3001, frontend :5173)
npm run dev

# Or production mode (builds frontend, backend serves it)
npm start
```

The frontend dev server (`:5173`) proxies `/api` to the backend (`:3001`), so only one
port is exposed in preview environments.

## First Run

The backend automatically seeds the database with sample users, teams, departments and
tasks on first start. Sample accounts (all passwords: `Taskflow@2026`) can be used to
evaluate the system until real user accounts are provisioned by an administrator.

### Production Configuration

A persistent `JWT_SECRET` is generated automatically on first start and saved to `backend/.env`,
so sessions survive restarts with no manual setup. For full control, set `JWT_SECRET` as an
environment variable before deploying (this takes precedence over `backend/.env`). If neither
is present, the backend falls back to an ephemeral random secret and prints a warning — every
restart then invalidates all existing sessions. Login is rate-limited (10 attempts per
15 minutes per account) to deter brute force attacks. See `DEPLOYMENT.md` for the full
production guide.

## Features

### Roles & Permissions
- **Super Admin** — full system access, users, teams, departments, KPI, settings, audit
- **Admin** — manages users/teams/departments, tasks, KPI, reports, exports
- **User** — assigned tasks, progress, comments, attachments, notifications, personal dashboard

### Dashboards
- **Executive Dashboard** (admin): summary cards (total/open/completion rate/done-per-day/overdue/pending/avg completion), charts (daily added vs completed, status & priority distribution, team/department performance, monthly productivity, user ranking, KPI scores, completion & overdue trends), recent activity feed
- **User Dashboard**: my tasks, today's tasks, overdue, completed, pending approval, avg completion time, personal KPI score, calendar, notifications, personal charts

### Task Management
- Full task form: status, priority, due date, team, department, assignees, flags, tags, recurrence, blocked flag (difficulty, type, budget, hours, reviewer, dependencies, checklist shown when editing)
- **Multiple assignees** with individual progress tracking
- **Self Tasks** (user mode): create a personal task assigned to yourself, track it, and mark it Completed for KPI points
- **Views**: List, Grid, Kanban (drag & drop), Calendar, Timeline
- Comments with @mentions, file attachments, checklist/subtasks, time tracking, approval workflow, task history
- **Advanced filters**: date presets + custom range, status/priority/difficulty/type/tags/flags, assignee/creator/reviewer/team/department, quick toggles, saved filter presets, sorting, export
- **Reports**: users can only download their reports in CSV format; admin exports CSV/XLSX/PDF

### KPI Management (Admin)
- Difficulty-weighted scoring (Easy 1 / Medium 2 / Hard 3 / Critical 5 pts)
- `Performance = Completed Points + On-Time Bonus - Overdue Penalty + Rating`
- **Self Task points**: every completed self task earns 1 pt if completed within 1 hour, 2 pts if longer
- Top/lowest performers, team & department ranking, monthly/yearly KPI, performance trend
- Users see only their own KPI summary

### Administration
- User management (create/edit, role assignment, reset passwords, activate/deactivate)
- Team & department management
- Settings: task statuses (add/edit/delete, color-coded), priorities (add/edit/delete, KPI weight), KPI formula (editable at any time), working days, business hours, holidays, notification rules, security (2FA toggle)
- Backup & Restore: full system backup (database, settings, holidays, attachments) downloaded as a single `.taskflow` file; validated restore with integrity checksum, confirmation step, and automatic pre-restore safety backup
- Audit logs, saved filters, exports (CSV/XLSX/PDF)

### UX
- Premium glassmorphism cards, gradient accents, smooth animations, fully responsive
- Dark/Light mode with persisted preference
- Global search, notification center, quick actions, color-coded statuses
- All dates and times are displayed in Bangladesh Standard Time (UTC+6) — dashboards, reports, KPI trends, exports, and "today"/overdue logic all use the Dhaka timezone

## Project Structure

```
backend/src/
  index.js        Express entry (serves frontend dist in production)
  db.js           SQLite schema
  seed.js         Demo data (users, teams, departments, tasks)
  config.js       Default settings (statuses, priorities, KPI)
  middleware.js   JWT auth, RBAC, audit logging, notifications
  routes/         auth, users, teams, departments, tasks, settings,
                  kpi, dashboard, reports/export, notifications, audit, uploads, backup
frontend/src/
  lib/            api client, auth, theme, settings, types, utils, filters
  components/     ui kit, layout, charts, filters, task views, task form
  pages/          login, dashboard, tasks, task detail, users, teams,
                  departments, kpi, reports, settings, audit, profile
```
