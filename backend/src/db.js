import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { backfillTaskCodes } from './services/taskCodeService.js';
import { DEFAULT_ROLE_GROUPS, PERMISSION_GRANTS } from './permissions.js';

// Built-in super admin credentials.
// The env var still overrides, but the fallback must be deterministic: it used
// to fall back to crypto.randomBytes(), so any install started without
// DEFAULT_ADMIN_PASSWORD got an unknown password that nobody could log in with.
export const SUPER_ADMIN_EMAIL = 'dipu@populardiagnostic.com';
export const DEFAULT_SUPER_ADMIN_PASSWORD = process.env.DEFAULT_ADMIN_PASSWORD || '@dmin5066';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, '..', 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const ATTACHMENT_DIR = path.join(DATA_DIR, 'attachment');
export const DOCUMENT_DIR = path.join(DATA_DIR, 'documents');
// DB_PATH can be overridden so the app can be pointed at an isolated database
// (tests, staging) without touching production data.
export const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(DATA_DIR, 'taskflow.db');
mkdirSync(UPLOAD_DIR, { recursive: true });
mkdirSync(ATTACHMENT_DIR, { recursive: true });
mkdirSync(DOCUMENT_DIR, { recursive: true });

export let db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA busy_timeout = 10000;');
try {
  db.exec('PRAGMA journal_mode = WAL;');
} catch { /* ignore if already WAL or held */ }
db.exec('PRAGMA foreign_keys = ON;');

export function openDatabase(filePath = DB_PATH) {
  const handle = new DatabaseSync(filePath);
  handle.exec('PRAGMA busy_timeout = 10000;');
  try {
    handle.exec('PRAGMA journal_mode = WAL;');
  } catch { /* ignore */ }
  handle.exec('PRAGMA foreign_keys = ON;');
  createBaseTables(handle);
  ensureSchema(handle);
  migrate(handle);
  return handle;
}

export const DEFAULT_TEAMS = [
  { id: 1, name: 'Application', description: 'Application development, software systems, and engineering' },
  { id: 2, name: 'Support', description: 'User technical support, IT helpdesk, and incident assistance' },
  { id: 3, name: 'Network', description: 'Network infrastructure, routing, bandwidth, and connectivity' },
  { id: 4, name: 'Infrastructure', description: 'Servers, cloud services, and IT infrastructure systems' },
  { id: 5, name: 'Operation', description: 'IT systems operations, monitoring, and maintenance' },
  { id: 6, name: 'Design', description: 'UI/UX design, graphics, and digital media' },
  { id: 7, name: 'Surveillance', description: 'CCTV surveillance, security cameras, and physical monitoring' },
  { id: 8, name: 'System Admin', description: 'Operating systems administration, access control, and identity' },
  { id: 9, name: 'Inventory', description: 'Hardware assets, equipment tracking, and inventory control' },
  { id: 10, name: 'Purchase', description: 'IT procurement, vendor management, and purchasing' },
  { id: 11, name: 'Branch IT', description: 'Branch-level IT support, equipment deployment, and field services' },
];

export const DEFAULT_BRANCHES = [
  { id: 11, name: 'Dhanmondi', description: 'Dhanmondi Branch', hotline: '09613-787801' },
  { id: 12, name: 'English Road', description: 'English Road Branch', hotline: '09613-787802' },
  { id: 13, name: 'Shantinagar', description: 'Shantinagar Branch', hotline: '09613-787803' },
  { id: 14, name: 'Narayanganj', description: 'Narayanganj Branch', hotline: '09613-787804' },
  { id: 15, name: 'Uttara', description: 'Uttara Branch', hotline: '09613-787805' },
  { id: 16, name: 'Shamoly', description: 'Shamoly Branch', hotline: '09613-787806' },
  { id: 17, name: 'Mirpur', description: 'Mirpur Branch', hotline: '09613-787807' },
  { id: 18, name: 'Savar', description: 'Savar Branch', hotline: '09613-787808' },
  { id: 19, name: 'Badda', description: 'Badda Branch', hotline: '09613-787809' },
  { id: 20, name: 'Chattagram', description: 'Chattagram Branch', hotline: '09613-787810' },
  { id: 21, name: 'Rajshahi', description: 'Rajshahi Branch', hotline: '09613-787811' },
  { id: 22, name: 'Bogura', description: 'Bogura Branch', hotline: '09613-787812' },
  { id: 23, name: 'Rangpur', description: 'Rangpur Branch', hotline: '09613-787813' },
  { id: 24, name: 'Mymensing', description: 'Mymensing Branch', hotline: '09613-787814' },
  { id: 25, name: 'Dinajpur', description: 'Dinajpur Branch', hotline: '09613-787815' },
  { id: 26, name: 'Gazipur', description: 'Gazipur Branch', hotline: '09613-787816' },
  { id: 27, name: 'Noakhali', description: 'Noakhali Branch', hotline: '09613-787817' },
  { id: 28, name: 'Kustia', description: 'Kustia Branch', hotline: '09613-787818' },
  { id: 29, name: 'Barisal', description: 'Barisal Branch', hotline: '09613-787819' },
  { id: 30, name: 'Bosila', description: 'Bosila Branch', hotline: '09613-787820' },
  { id: 31, name: 'Khulna', description: 'Khulna Branch', hotline: '09613-787821' },
  { id: 32, name: 'Jatrabari', description: 'Jatrabari Branch', hotline: '09613-787822' },
  { id: 33, name: 'Garib-e-Newaj', description: 'Garib-e-Newaj Branch', hotline: '09613-787823' },
  { id: 34, name: 'Tangail', description: 'Tangail Branch', hotline: '09613-787824' },
  { id: 35, name: 'Cumilla', description: 'Cumilla Branch', hotline: '09613-787825' },
];

export function ensureSchema(handle = db) {
  handle.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
    );

    CREATE TABLE IF NOT EXISTS role_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      color TEXT DEFAULT '#6366f1',
      is_system INTEGER NOT NULL DEFAULT 0,
      permissions TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
    );

    CREATE TABLE IF NOT EXISTS daily_task_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      points INTEGER NOT NULL DEFAULT 2,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
    );

    CREATE TABLE IF NOT EXISTS daily_task_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours')),
      UNIQUE(user_id)
    );

    CREATE TABLE IF NOT EXISTS daily_task_awards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      template_key TEXT DEFAULT '',
      points INTEGER NOT NULL DEFAULT 2,
      awarded_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours')),
      UNIQUE(task_id, user_id)
    );
  `);

  // Seed default role groups if missing
  try {
    for (const rg of DEFAULT_ROLE_GROUPS) {
      const existing = handle.prepare('SELECT id FROM role_groups WHERE slug = ?').get(rg.slug);
      if (!existing) {
        handle.prepare(`
          INSERT INTO role_groups (slug, name, description, color, is_system, permissions)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(rg.slug, rg.name, rg.description, rg.color, rg.is_system, JSON.stringify(rg.permissions));
      }
    }
  } catch (err) {
    console.error('Error seeding default role groups:', err);
  }

  // Grant newly added permissions to existing system role groups. Default role
  // groups are only inserted when missing, so an upgraded database keeps its
  try {
    for (const [slug, grants] of Object.entries(PERMISSION_GRANTS)) {
      const row = handle.prepare('SELECT id, permissions FROM role_groups WHERE slug = ?').get(slug);
      if (!row) continue;
      let perms = [];
      try {
        const parsed = typeof row.permissions === 'string' ? JSON.parse(row.permissions) : row.permissions;
        if (Array.isArray(parsed)) perms = parsed;
      } catch { perms = []; }
      const missing = grants.filter((p) => !perms.includes(p));
      if (missing.length === 0) continue;
      perms.push(...missing);
      handle.prepare('UPDATE role_groups SET permissions = ? WHERE id = ?').run(JSON.stringify(perms), row.id);
      console.log(`[MIGRATE] Granted ${missing.join(', ')} to role group "${slug}"`);
    }
  } catch (err) {
    console.error('Error granting permissions:', err);
  }

  // Daily task schema additions to the shared tasks table. A partial unique
  // index makes generation idempotent: one task per template, per day, per user.
  try {
    const taskCols = handle.prepare('PRAGMA table_info(tasks)').all().map((c) => c.name);
    if (!taskCols.includes('daily_task_key')) {
      handle.exec("ALTER TABLE tasks ADD COLUMN daily_task_key TEXT DEFAULT ''");
      handle.exec("ALTER TABLE tasks ADD COLUMN daily_task_date TEXT DEFAULT ''");
      handle.exec("ALTER TABLE tasks ADD COLUMN daily_task_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE");
      handle.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_task_unique
        ON tasks(daily_task_key, daily_task_date, daily_task_user_id)
        WHERE daily_task_key <> ''`);
      handle.exec("CREATE INDEX IF NOT EXISTS idx_daily_task_user ON tasks(daily_task_user_id, daily_task_date)");
      console.log('[MIGRATE] Added daily task columns to tasks');
    }
  } catch (err) {
    console.error('Error adding daily task columns:', err);
  }

  // Permanent, human-facing Task ID for every task. The autoincrement `id` is
  // an internal row pointer that restore and data reset can reuse, so it cannot
  // serve as an identifier; task_code is minted once at insert and never
  // regenerated. It lives on both `tasks` and `priority_tasks` so the id is
  // unique across every kind of task in the system.
  //
  // Order matters: add the column, backfill, then create the unique index, so
  // the index is only ever built over already-distinct values. SQLite cannot
  // express UNIQUE in ADD COLUMN, so uniqueness is a partial index; the partial
  // predicate also lets a legacy restore insert many '' rows without tripping it.
  try {
    const hasTable = (name) => !!handle
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
      .get(name);

    for (const table of ['tasks', 'priority_tasks']) {
      if (!hasTable(table)) continue;
      const cols = handle.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name);
      if (!cols.includes('task_code')) {
        handle.exec(`ALTER TABLE "${table}" ADD COLUMN task_code TEXT DEFAULT ''`);
        console.log(`[MIGRATE] Added task_code column to ${table}`);
      }
    }

    // Backfill before the index exists, so a failure part-way through leaves
    // some rows without a code (repaired on the next boot) rather than a
    // half-built unique index.
    const backfilled = backfillTaskCodes(handle);
    if (backfilled.length) console.log(`[MIGRATE] Backfilled task codes: ${backfilled.join(', ')}`);

    for (const table of ['tasks', 'priority_tasks']) {
      if (!hasTable(table)) continue;
      handle.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${table}_task_code
        ON "${table}"(task_code) WHERE task_code <> ''`);
    }
  } catch (err) {
    console.error('Error adding task_code columns:', err);
  }

  // Seed the four standard daily task templates (idempotent by key).
  try {
    const defaults = [
      { key: 'cctv', name: 'CCTV Monitoring', description: 'Review CCTV footage and confirm all cameras are recording and operational.' },
      { key: 'isp', name: 'All ISP Check', description: 'Check every ISP link status, latency, and uptime.' },
      { key: 'network', name: 'Internal Network Check', description: 'Verify internal network connectivity, switches, and access points.' },
      { key: 'server', name: 'Server Check & Backup Check', description: 'Check server health, services, and confirm the latest backup completed.' },
    ];
    const ins = handle.prepare(`
      INSERT OR IGNORE INTO daily_task_templates (key, name, description, enabled, points, sort_order)
      VALUES (?, ?, ?, 1, 2, ?)
    `);
    defaults.forEach((d, i) => ins.run(d.key, d.name, d.description, i));
    // Normalise any rows still carrying the earlier 1-point default.
    handle.prepare('UPDATE daily_task_templates SET points = 2 WHERE points = 1').run();
  } catch (err) {
    console.error('Error seeding daily task templates:', err);
  }

  // Seed default KPI configuration rules (idempotent by rule_key).
  try {
    const kpiDefaults = [
      // Self Task
      { rule_key: 'self_task', rule_name: 'Self Task Completion', rule_category: 'task', points: 3, enabled: 1, description: 'Points awarded when a user completes a self-created task' },
      // Create Task - Creator
      { rule_key: 'create_task', rule_name: 'Create Task Completion (Creator)', rule_category: 'task', points: 3, enabled: 1, description: 'Points awarded to the task creator when they complete the task' },
      // Create Task - Assignee
      { rule_key: 'assignee_task', rule_name: 'Assignee Task Completion', rule_category: 'task', points: 3, enabled: 1, description: 'Points awarded to an assigned user when they complete their assigned work' },
      // Overdue Task
      { rule_key: 'overdue_task', rule_name: 'Overdue Task Penalty', rule_category: 'penalty', points: -3, enabled: 1, description: 'Negative points applied when a task is not completed by its due date' },
      // Daily Task Completion
      { rule_key: 'daily_task_complete', rule_name: 'Daily Task Completion', rule_category: 'daily', points: 2, enabled: 1, description: 'Points awarded for completing a daily task' },
      // Daily Task Overdue
      { rule_key: 'daily_task_overdue', rule_name: 'Daily Task Overdue Penalty', rule_category: 'penalty', points: -1, enabled: 1, description: 'Negative points applied when a daily task is missed on a past day' },
      // Admin Assigned Task Bonus
      { rule_key: 'admin_bonus', rule_name: 'Admin Assigned Task Bonus', rule_category: 'bonus', points: 1, enabled: 1, description: 'Bonus point when an Admin assigns a task and the assignee completes it' },
    ];
    const ins = handle.prepare(`
      INSERT OR IGNORE INTO kpi_config (rule_key, rule_name, rule_category, points, enabled, description)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    kpiDefaults.forEach((d) => ins.run(d.rule_key, d.rule_name, d.rule_category, d.points, d.enabled, d.description));
  } catch (err) {
    console.error('Error seeding KPI config:', err);
  }

  // Ensure default_role_group_id setting exists (defaults to 'user' role group)
  try {
    const defaultSetting = handle.prepare("SELECT value FROM settings WHERE key = 'default_role_group_id'").get();
    if (!defaultSetting) {
      const userGroup = handle.prepare("SELECT id FROM role_groups WHERE slug = 'user'").get();
      if (userGroup) {
        handle.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('default_role_group_id', ?, datetime('now','+6 hours'))")
          .run(JSON.stringify(userGroup.id));
      }
    }
  } catch {}

  const hasUsersTable = handle.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
  if (hasUsersTable) {
    const userCols = handle.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
    if (!userCols.includes('employee_id')) {
      handle.exec("ALTER TABLE users ADD COLUMN employee_id TEXT DEFAULT ''");
    }
    if (!userCols.includes('live_status')) {
      handle.exec("ALTER TABLE users ADD COLUMN live_status TEXT NOT NULL DEFAULT 'inactive'");
    }
    if (!userCols.includes('last_active_at')) {
      handle.exec("ALTER TABLE users ADD COLUMN last_active_at TEXT");
    }
    if (!userCols.includes('status_message')) {
      handle.exec("ALTER TABLE users ADD COLUMN status_message TEXT DEFAULT ''");
    }
    if (!userCols.includes('status_updated_at')) {
      handle.exec("ALTER TABLE users ADD COLUMN status_updated_at TEXT");
    }
    if (!userCols.includes('token_version')) {
      handle.exec("ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0");
    }
    if (!userCols.includes('weekend_days')) {
      handle.exec("ALTER TABLE users ADD COLUMN weekend_days TEXT DEFAULT '[5]'");
    }
    if (!userCols.includes('duty_time')) {
      handle.exec("ALTER TABLE users ADD COLUMN duty_time TEXT DEFAULT ''");
    }
    if (!userCols.includes('role_group_id')) {
      handle.exec("ALTER TABLE users ADD COLUMN role_group_id INTEGER REFERENCES role_groups(id) ON DELETE SET NULL");
    }
    if (!userCols.includes('password_must_change')) {
      handle.exec("ALTER TABLE users ADD COLUMN password_must_change INTEGER NOT NULL DEFAULT 0");
    }
    // Populate employee_id and weekend_days for any users where blank
    handle.exec("UPDATE users SET employee_id = 'EMP' || printf('%03d', id) WHERE employee_id IS NULL OR employee_id = ''");
    handle.exec("UPDATE users SET weekend_days = '[5]' WHERE weekend_days IS NULL OR weekend_days = ''");
    handle.exec("UPDATE users SET duty_time = '' WHERE duty_time IS NULL");

    // Link users to their appropriate role group
    try {
      handle.exec(`
        UPDATE users
        SET role_group_id = (SELECT id FROM role_groups WHERE slug = users.role)
        WHERE role_group_id IS NULL OR role_group_id = 0
      `);
      // For any fallback
      const defaultUserGroup = handle.prepare("SELECT id FROM role_groups WHERE slug = 'user'").get();
      if (defaultUserGroup) {
        handle.exec(`UPDATE users SET role_group_id = ${defaultUserGroup.id} WHERE role_group_id IS NULL OR role_group_id = 0`);
      }
    } catch {}

    // Ensure default super admin exists if database is fresh
    try {
      const superGroup = handle.prepare("SELECT id FROM role_groups WHERE slug = 'super_admin'").get();
      const existingSuperAdmin = handle.prepare("SELECT id, password_hash, is_active, live_status FROM users WHERE lower(email) = lower(?)").get(SUPER_ADMIN_EMAIL);
      if (!existingSuperAdmin) {
        const defaultHash = bcrypt.hashSync(DEFAULT_SUPER_ADMIN_PASSWORD, 12);
        handle.prepare(`
          INSERT INTO users (name, email, password_hash, role, role_group_id, title, employee_id, is_active, live_status, password_must_change)
          VALUES ('Admin', ?, ?, 'super_admin', ?, 'Administrator', 'EMP001', 1, 'active', 0)
        `).run(SUPER_ADMIN_EMAIL, defaultHash, superGroup?.id || null);
        console.log('[SEED] Created default super admin. Email: ' + SUPER_ADMIN_EMAIL + ' | Password: ' + DEFAULT_SUPER_ADMIN_PASSWORD);
      } else {
        if (!existingSuperAdmin.is_active) {
          handle.prepare("UPDATE users SET is_active = 1 WHERE id = ?").run(existingSuperAdmin.id);
        }
        if (superGroup) {
          handle.prepare("UPDATE users SET role_group_id = ? WHERE id = ?").run(superGroup.id, existingSuperAdmin.id);
        }
        // Only rewrite the hash when it genuinely differs. Rehashing on every
        // boot reset token_version, which silently logged the user out of every
        // other session each time the server restarted.
        let passwordMatches = false;
        try {
          passwordMatches = bcrypt.compareSync(DEFAULT_SUPER_ADMIN_PASSWORD, existingSuperAdmin.password_hash || '');
        } catch { passwordMatches = false; }
        if (!passwordMatches) {
          const pwdHash = bcrypt.hashSync(DEFAULT_SUPER_ADMIN_PASSWORD, 12);
          handle.prepare("UPDATE users SET password_hash = ?, password_must_change = 0, is_active = 1, live_status = 'active', token_version = 0 WHERE id = ?").run(pwdHash, existingSuperAdmin.id);
          console.log('[SEED] Set default super admin password to the built-in value');
        } else if (existingSuperAdmin.live_status !== 'active') {
          handle.prepare("UPDATE users SET live_status = 'active' WHERE id = ?").run(existingSuperAdmin.id);
        }
      }
    } catch (err) {
      console.error('[SEED] Superadmin setup error:', err);
    }
  }

  const hasTasksTable = handle.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'").get();
  if (hasTasksTable) {
    const taskCols = handle.prepare('PRAGMA table_info(tasks)').all().map((c) => c.name);
    if (!taskCols.includes('is_self_task')) {
      handle.exec("ALTER TABLE tasks ADD COLUMN is_self_task INTEGER NOT NULL DEFAULT 0");
    }
    if (!taskCols.includes('project_id')) {
      handle.exec("ALTER TABLE tasks ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL");
      handle.exec("CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id)");
    }
    // Who marked the task done. Separate from created_by (who raised it) and
    // from task_assignees, because with several assignees only the person who
    // actually flipped the status is the completer.
    if (!taskCols.includes('completed_by')) {
      handle.exec("ALTER TABLE tasks ADD COLUMN completed_by INTEGER REFERENCES users(id) ON DELETE SET NULL");
      handle.exec("CREATE INDEX IF NOT EXISTS idx_tasks_completed_by ON tasks(completed_by)");
    }
  }

  const hasPriorityTable = handle.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='priority_tasks'").get();
  if (hasPriorityTable) {
    const priorityCols = handle.prepare('PRAGMA table_info(priority_tasks)').all().map((c) => c.name);
    if (!priorityCols.includes('transferred_to_task_id')) {
      handle.exec("ALTER TABLE priority_tasks ADD COLUMN transferred_to_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL");
    }
    if (!priorityCols.includes('transferred_at')) {
      handle.exec("ALTER TABLE priority_tasks ADD COLUMN transferred_at TEXT");
    }
  }

  const hasChatTable = handle.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chat_messages'").get();
  if (hasChatTable) {
    const chatCols = handle.prepare('PRAGMA table_info(chat_messages)').all().map((c) => c.name);
    if (!chatCols.includes('recipient_id')) {
      handle.exec("ALTER TABLE chat_messages ADD COLUMN recipient_id INTEGER REFERENCES users(id) ON DELETE CASCADE");
    }
    if (!chatCols.includes('conversation_id')) {
      handle.exec("ALTER TABLE chat_messages ADD COLUMN conversation_id TEXT DEFAULT ''");
    }
    if (!chatCols.includes('mentions')) {
      handle.exec("ALTER TABLE chat_messages ADD COLUMN mentions TEXT DEFAULT '[]'");
    }
    if (!chatCols.includes('group_id')) {
      handle.exec("ALTER TABLE chat_messages ADD COLUMN group_id INTEGER REFERENCES chat_groups(id) ON DELETE CASCADE");
    }
    // Performance indexes.
    // Each one is created only when its table already exists. These statements
    // used to run unconditionally, so on a brand new database the first index
    // for a table that had not been created yet threw "no such table" and
    // aborted ensureSchema -- which is why a fresh install would never finish
    // starting, let alone accept the super admin login.
    const hasTable = (name) =>
      !!handle.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
    const addIndex = (table, name, cols) => {
      if (hasTable(table)) {
        handle.exec(`CREATE INDEX IF NOT EXISTS ${name} ON ${table}(${cols})`);
      }
    };

    // Indexes for faster conversation queries
    addIndex('chat_messages', 'idx_chat_conversation', 'conversation_id, created_at');
    addIndex('chat_messages', 'idx_chat_recipient', 'recipient_id, created_at');
    addIndex('chat_messages', 'idx_chat_group', 'group_id, created_at');

    // General performance indexes
    addIndex('users', 'idx_users_email', 'email');
    addIndex('users', 'idx_users_role', 'role');
    addIndex('users', 'idx_users_active', 'is_active');
    addIndex('users', 'idx_users_live_status', 'live_status');
    addIndex('tasks', 'idx_tasks_status', 'status');

    // Per-assignee completion. KPI now pays a share of each task's points per
    // person who personally completed it, scored from task_assignees.completed_at.
    // Older rows were only ever stamped on tasks.completed_at, so backfill the
    // recorded completer (falling back to the sole assignee) or those people
    // would silently lose points they had already earned.
    if (hasTable('tasks') && hasTable('task_assignees')) {
      const backfilled = handle.prepare(`
        UPDATE task_assignees SET completed_at = (
          SELECT t.completed_at FROM tasks t
          WHERE t.id = task_assignees.task_id AND t.status = 'done' AND t.completed_at IS NOT NULL
        )
        WHERE completed_at IS NULL
          AND EXISTS (
            SELECT 1 FROM tasks t
            WHERE t.id = task_assignees.task_id AND t.status = 'done' AND t.completed_at IS NOT NULL
          )
          AND (
            -- the recorded completer is an assignee, so credit them
            EXISTS (
              SELECT 1 FROM tasks t
              WHERE t.id = task_assignees.task_id AND t.completed_by = task_assignees.user_id
            )
            -- or there is exactly one assignee, who must be the completer
            OR 1 = (SELECT COUNT(*) FROM task_assignees x WHERE x.task_id = task_assignees.task_id)
          )
      `).run();
      if (backfilled.changes) {
        console.log(`[MIGRATE] Backfilled personal completion on ${backfilled.changes} task assignment(s)`);
      }
    }
    addIndex('tasks', 'idx_tasks_priority', 'priority');
    addIndex('tasks', 'idx_tasks_created_by', 'created_by');
    addIndex('tasks', 'idx_tasks_due_date', 'due_date');
    addIndex('tasks', 'idx_tasks_archived', 'archived');
    addIndex('task_assignees', 'idx_task_assignees_task', 'task_id');
    addIndex('task_assignees', 'idx_task_assignees_user', 'user_id');
    addIndex('task_comments', 'idx_task_comments_task', 'task_id');
    addIndex('task_history', 'idx_task_history_task', 'task_id');
    addIndex('notifications', 'idx_notifications_user', 'user_id, read, created_at');
    addIndex('audit_logs', 'idx_audit_logs_user', 'user_id, action, entity_type, entity_id, created_at');
    addIndex('leave_applications', 'idx_leave_applications_user', 'user_id, status, start_date, end_date');
    addIndex('time_entries', 'idx_time_entries_task', 'task_id');
    addIndex('approvals', 'idx_approvals_task', 'task_id');
    addIndex('priority_tasks', 'idx_priority_tasks_status', 'status');
    addIndex('priority_tasks', 'idx_priority_tasks_assignee', 'assignee_user_id');
  }

  try {
    const hasDocsTable = handle.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='documents'").get();
    if (hasDocsTable) {
      const docCols = handle.prepare('PRAGMA table_info(documents)').all().map((c) => c.name);
      if (!docCols.includes('vendor_name')) {
        handle.exec("ALTER TABLE documents ADD COLUMN vendor_name TEXT DEFAULT ''");
      }
      if (!docCols.includes('original_name')) {
        handle.exec("ALTER TABLE documents ADD COLUMN original_name TEXT DEFAULT ''");
      }
      if (!docCols.includes('file_path')) {
        handle.exec("ALTER TABLE documents ADD COLUMN file_path TEXT DEFAULT ''");
      }
      if (!docCols.includes('file_type')) {
        handle.exec("ALTER TABLE documents ADD COLUMN file_type TEXT DEFAULT 'other'");
      }
      if (!docCols.includes('mime')) {
        handle.exec("ALTER TABLE documents ADD COLUMN mime TEXT DEFAULT ''");
      }
      if (!docCols.includes('is_active')) {
        handle.exec("ALTER TABLE documents ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1");
      }
      if (!docCols.includes('view_count')) {
        handle.exec("ALTER TABLE documents ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0");
      }
      if (!docCols.includes('download_count')) {
        handle.exec("ALTER TABLE documents ADD COLUMN download_count INTEGER NOT NULL DEFAULT 0");
      }
      if (!docCols.includes('last_updated')) {
        handle.exec("ALTER TABLE documents ADD COLUMN last_updated TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))");
      }
      if (!docCols.includes('access_permission')) {
         handle.exec("ALTER TABLE documents ADD COLUMN access_permission TEXT NOT NULL DEFAULT 'authenticated'");
      }
      if (!docCols.includes('version')) {
        handle.exec("ALTER TABLE documents ADD COLUMN version TEXT DEFAULT '1.0'");
      }
      if (!docCols.includes('team_id')) {
        handle.exec("ALTER TABLE documents ADD COLUMN team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL");
      }
      if (!docCols.includes('department_id')) {
        handle.exec("ALTER TABLE documents ADD COLUMN department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL");
      }
      if (!docCols.includes('project_id')) {
        handle.exec("ALTER TABLE documents ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL");
      }
      if (!docCols.includes('tags')) {
        handle.exec("ALTER TABLE documents ADD COLUMN tags TEXT DEFAULT '[]'");
      }
      if (!docCols.includes('description')) {
        handle.exec("ALTER TABLE documents ADD COLUMN description TEXT DEFAULT ''");
      }
      if (!docCols.includes('upload_date')) {
        handle.exec("ALTER TABLE documents ADD COLUMN upload_date TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))");
      }
      handle.exec("CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id)");
      handle.exec("CREATE INDEX IF NOT EXISTS idx_documents_department ON documents(department_id)");
      handle.exec("CREATE INDEX IF NOT EXISTS idx_documents_team ON documents(team_id)");
      handle.exec("CREATE INDEX IF NOT EXISTS idx_documents_uploader ON documents(uploaded_by)");
      handle.exec("CREATE INDEX IF NOT EXISTS idx_documents_access ON documents(access_permission)");
      handle.exec("CREATE INDEX IF NOT EXISTS idx_documents_active ON documents(is_active)");
      if (!docCols.includes('folder_id')) {
        handle.exec("ALTER TABLE documents ADD COLUMN folder_id INTEGER REFERENCES document_folders(id) ON DELETE SET NULL");
      }
      try { handle.exec("CREATE INDEX IF NOT EXISTS idx_documents_folder ON documents(folder_id)"); } catch {}
      if (!docCols.includes('upload_date')) {
        handle.exec("ALTER TABLE documents ADD COLUMN upload_date TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))");
      }
      if (!docCols.includes('file_type')) {
        handle.exec("ALTER TABLE documents ADD COLUMN file_type TEXT DEFAULT 'other'");
        handle.exec("CREATE INDEX IF NOT EXISTS idx_documents_file_type ON documents(file_type)");
      }
      if (!docCols.includes('tags')) {
        handle.exec("ALTER TABLE documents ADD COLUMN tags TEXT DEFAULT '[]'");
        handle.exec("CREATE INDEX IF NOT EXISTS idx_documents_tags ON documents(tags)");
      }
    }
  } catch (err) {
    console.error('Error ensuring documents schema:', err);
  }

  handle.exec(`
    CREATE TABLE IF NOT EXISTS leave_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      leave_type TEXT NOT NULL,
      duration_type TEXT NOT NULL DEFAULT 'full_day',
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      days_count REAL NOT NULL DEFAULT 1,
      year INTEGER NOT NULL,
      reason TEXT NOT NULL,
      reliever_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      emergency_contact TEXT DEFAULT '',
      attachment_url TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      admin_remarks TEXT DEFAULT '',
      approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      approved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
    );

    CREATE TABLE IF NOT EXISTS leave_quotas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      year INTEGER NOT NULL,
      el_quota REAL NOT NULL DEFAULT 14,
      cl_quota REAL NOT NULL DEFAULT 10,
      sl_quota REAL NOT NULL DEFAULT 14,
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours')),
      UNIQUE(user_id, year)
    );
  `);

  // Merge duplicate Super Admin accounts (e.g. other legacy emails into dipu@populardiagnostic.com)
  try {
    const primaryUser = handle.prepare("SELECT id FROM users WHERE lower(email) = 'dipu@populardiagnostic.com'").get();
    const duplicateUser = handle.prepare("SELECT id FROM users WHERE lower(email) = 'admin@taskflow.io'").get();

    if (primaryUser && duplicateUser && primaryUser.id !== duplicateUser.id) {
      const pId = primaryUser.id;
      const dId = duplicateUser.id;

      // 1. Tasks
      handle.prepare("UPDATE tasks SET created_by = ? WHERE created_by = ?").run(pId, dId);
      handle.prepare("UPDATE tasks SET reviewer_id = ? WHERE reviewer_id = ?").run(pId, dId);

      // 2. Task Assignees (handle conflicts)
      const dupAssignees = handle.prepare("SELECT task_id, progress, status, assigned_at, completed_at FROM task_assignees WHERE user_id = ?").all(dId);
      for (const a of dupAssignees) {
        const existsOnPrimary = handle.prepare("SELECT id FROM task_assignees WHERE task_id = ? AND user_id = ?").get(a.task_id, pId);
        if (!existsOnPrimary) {
          handle.prepare("UPDATE task_assignees SET user_id = ? WHERE task_id = ? AND user_id = ?").run(pId, a.task_id, dId);
        } else {
          handle.prepare("DELETE FROM task_assignees WHERE task_id = ? AND user_id = ?").run(a.task_id, dId);
        }
      }

      // 3. Task Comments & Checklist & Attachments
      handle.prepare("UPDATE task_comments SET user_id = ? WHERE user_id = ?").run(pId, dId);
      handle.prepare("UPDATE task_checklist SET created_by = ? WHERE created_by = ?").run(pId, dId);
      handle.prepare("UPDATE task_attachments SET user_id = ? WHERE user_id = ?").run(pId, dId);

      // 4. Time Entries
      handle.prepare("UPDATE time_entries SET user_id = ? WHERE user_id = ?").run(pId, dId);

      // 5. Approvals
      handle.prepare("UPDATE approvals SET requester_id = ? WHERE requester_id = ?").run(pId, dId);
      handle.prepare("UPDATE approvals SET approver_id = ? WHERE approver_id = ?").run(pId, dId);

      // 6. Notifications & Audit Logs & Saved Filters & Task History
      handle.prepare("UPDATE notifications SET user_id = ? WHERE user_id = ?").run(pId, dId);
      handle.prepare("UPDATE audit_logs SET user_id = ? WHERE user_id = ?").run(pId, dId);
      handle.prepare("UPDATE saved_filters SET user_id = ? WHERE user_id = ?").run(pId, dId);
      handle.prepare("UPDATE task_history SET user_id = ? WHERE user_id = ?").run(pId, dId);

      // 7. Priority Tasks & Remarks
      handle.prepare("UPDATE priority_tasks SET created_by = ? WHERE created_by = ?").run(pId, dId);
      handle.prepare("UPDATE priority_tasks SET assignee_user_id = ? WHERE assignee_user_id = ?").run(pId, dId);
      handle.prepare("UPDATE priority_task_remarks SET user_id = ? WHERE user_id = ?").run(pId, dId);

      // 8. Leaves & Quotas
      handle.prepare("UPDATE leave_applications SET user_id = ? WHERE user_id = ?").run(pId, dId);
      handle.prepare("UPDATE leave_applications SET reliever_user_id = ? WHERE reliever_user_id = ?").run(pId, dId);
      handle.prepare("UPDATE leave_applications SET approved_by = ? WHERE approved_by = ?").run(pId, dId);
      handle.prepare("DELETE FROM leave_quotas WHERE user_id = ?").run(dId);

      // 9. Teams & Departments
      handle.prepare("UPDATE teams SET lead_id = ? WHERE lead_id = ?").run(pId, dId);
      handle.prepare("UPDATE departments SET head_id = ? WHERE head_id = ?").run(pId, dId);

      // 10. Delete duplicate account
      handle.prepare("DELETE FROM users WHERE id = ?").run(dId);
    }
  } catch (err) {
    console.error('Error merging duplicate Super Admin accounts:', err);
  }

  // Ensure default 11 teams exist without deleting existing or restored teams
  try {
    const hasTeamsTable = handle.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='teams'").get();
    if (hasTeamsTable) {
      const insertStmt = handle.prepare('INSERT OR IGNORE INTO teams (id, name, description) VALUES (?, ?, ?)');
      for (const t of DEFAULT_TEAMS) {
        insertStmt.run(t.id, t.name, t.description);
      }
    }
  } catch (err) {
    console.error('Error ensuring teams:', err);
  }

  // Ensure default 25 branches exist without deleting existing or restored branches
  try {
    const hasDeptTable = handle.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='departments'").get();
    if (hasDeptTable) {
      const deptCols = handle.prepare('PRAGMA table_info(departments)').all().map((c) => c.name);
      if (!deptCols.includes('hotline')) {
        handle.exec("ALTER TABLE departments ADD COLUMN hotline TEXT DEFAULT ''");
      }
      if (!deptCols.includes('ext')) {
        handle.exec("ALTER TABLE departments ADD COLUMN ext TEXT DEFAULT ''");
      }
      if (!deptCols.includes('hotline_ext')) {
        handle.exec("ALTER TABLE departments ADD COLUMN hotline_ext TEXT DEFAULT ''");
      }
      if (!deptCols.includes('manager_name')) {
        handle.exec("ALTER TABLE departments ADD COLUMN manager_name TEXT DEFAULT ''");
      }
      if (!deptCols.includes('manager_ext')) {
        handle.exec("ALTER TABLE departments ADD COLUMN manager_ext TEXT DEFAULT ''");
      }
      const insertStmt = handle.prepare('INSERT OR IGNORE INTO departments (id, name, description, hotline, ext, hotline_ext, manager_name, manager_ext) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      for (const b of DEFAULT_BRANCHES) {
        insertStmt.run(b.id, b.name, b.description, b.hotline || '', '', b.hotline || '', b.manager_name || '', b.manager_ext || '');
        if (b.hotline) {
          handle.prepare("UPDATE departments SET hotline = ? WHERE id = ? AND (hotline IS NULL OR hotline = '')")
            .run(b.hotline, b.id);
        }
      }
      // Populate any remaining branch without hotline
      const remaining = handle.prepare("SELECT id, hotline_ext, hotline FROM departments WHERE hotline IS NULL OR hotline = ''").all();
      for (const r of remaining) {
        if (r.hotline_ext) {
          const parts = r.hotline_ext.split(/,\s*Ext:\s*/i);
          const h = (parts[0] || '').trim();
          handle.prepare("UPDATE departments SET hotline = ?, ext = '', hotline_ext = ? WHERE id = ?").run(h, h, r.id);
        } else {
          handle.prepare("UPDATE departments SET hotline = '09613-787801', ext = '', hotline_ext = '09613-787801' WHERE id = ?").run(r.id);
        }
      }
      // Remove all ext options from branches: clear ext column and clean hotline_ext
      handle.exec(`
        UPDATE departments
        SET ext = '',
            hotline_ext = hotline
        WHERE hotline IS NOT NULL AND hotline != '';
      `);
    }
  } catch (err) {
    console.error('Error ensuring branches:', err);
  }
}

const SCHEMA_VERSION = 1;

function recreateTableDhaka(handle, name) {
  const row = handle.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name);
  if (!row || !row.sql) return;
  const def = row.sql;
  if (!def.includes("datetime('now')") && !def.includes("date('now')")) return;
  const newDef = def.replace(/datetime\('now'\)/g, "datetime('now','+6 hours')").replace(/date\('now'\)/g, "date('now','+6 hours')");
  const tmp = 'zz__' + name;
  handle.exec(newDef.replace(/^CREATE TABLE\s+[^\s(]+/, `CREATE TABLE ${tmp}`));
  handle.exec(`INSERT INTO ${tmp} SELECT * FROM ${name}`);
  handle.exec(`DROP TABLE ${name}`);
  handle.exec(`ALTER TABLE ${tmp} RENAME TO ${name}`);
}

export function migrate(handle = db) {
  const v = Number(handle.prepare('PRAGMA user_version').get().user_version) || 0;
  if (v >= SCHEMA_VERSION) return;
  handle.exec('PRAGMA foreign_keys = OFF;');
  handle.exec('BEGIN;');
  try {
    for (const t of ['users', 'teams', 'departments', 'projects', 'project_members', 'tasks', 'task_assignees', 'task_comments', 'task_checklist', 'task_attachments', 'time_entries', 'approvals', 'notifications', 'audit_logs', 'settings', 'saved_filters', 'task_history', 'chat_messages', 'chat_reads', 'chat_groups', 'chat_group_members', 'chat_attachments', 'documents', 'document_folders', 'document_permissions', 'document_history']) {
      recreateTableDhaka(handle, t);
    }
    handle.exec(`
UPDATE users SET created_at = datetime(created_at, '+6 hours') WHERE created_at IS NOT NULL AND created_at != '';
UPDATE users SET updated_at = datetime(updated_at, '+6 hours') WHERE updated_at IS NOT NULL AND updated_at != '';
UPDATE users SET last_login = datetime(last_login, '+6 hours') WHERE last_login IS NOT NULL AND last_login != '';
UPDATE teams SET created_at = datetime(created_at, '+6 hours') WHERE created_at IS NOT NULL AND created_at != '';
UPDATE departments SET created_at = datetime(created_at, '+6 hours') WHERE created_at IS NOT NULL AND created_at != '';
UPDATE tasks SET created_at = datetime(created_at, '+6 hours') WHERE created_at IS NOT NULL AND created_at != '';
UPDATE tasks SET updated_at = datetime(updated_at, '+6 hours') WHERE updated_at IS NOT NULL AND updated_at != '';
UPDATE tasks SET completed_at = datetime(completed_at, '+6 hours') WHERE completed_at IS NOT NULL AND completed_at != '';
UPDATE task_assignees SET assigned_at = datetime(assigned_at, '+6 hours') WHERE assigned_at IS NOT NULL AND assigned_at != '';
UPDATE task_assignees SET completed_at = datetime(completed_at, '+6 hours') WHERE completed_at IS NOT NULL AND completed_at != '';
UPDATE task_comments SET created_at = datetime(created_at, '+6 hours') WHERE created_at IS NOT NULL AND created_at != '';
UPDATE task_checklist SET created_at = datetime(created_at, '+6 hours') WHERE created_at IS NOT NULL AND created_at != '';
UPDATE task_attachments SET uploaded_at = datetime(uploaded_at, '+6 hours') WHERE uploaded_at IS NOT NULL AND uploaded_at != '';
UPDATE time_entries SET created_at = datetime(created_at, '+6 hours') WHERE created_at IS NOT NULL AND created_at != '';
UPDATE time_entries SET date = date(date, '+6 hours') WHERE date IS NOT NULL AND date != '';
UPDATE approvals SET created_at = datetime(created_at, '+6 hours') WHERE created_at IS NOT NULL AND created_at != '';
UPDATE approvals SET updated_at = datetime(updated_at, '+6 hours') WHERE updated_at IS NOT NULL AND updated_at != '';
UPDATE notifications SET created_at = datetime(created_at, '+6 hours') WHERE created_at IS NOT NULL AND created_at != '';
UPDATE audit_logs SET created_at = datetime(created_at, '+6 hours') WHERE created_at IS NOT NULL AND created_at != '';
UPDATE settings SET updated_at = datetime(updated_at, '+6 hours') WHERE updated_at IS NOT NULL AND updated_at != '';
UPDATE saved_filters SET created_at = datetime(created_at, '+6 hours') WHERE created_at IS NOT NULL AND created_at != '';
UPDATE task_history SET created_at = datetime(created_at, '+6 hours') WHERE created_at IS NOT NULL AND created_at != '';
UPDATE chat_messages SET created_at = datetime(created_at, '+6 hours') WHERE created_at IS NOT NULL AND created_at != '';
UPDATE chat_messages SET updated_at = datetime(updated_at, '+6 hours') WHERE updated_at IS NOT NULL AND updated_at != '';
UPDATE chat_attachments SET uploaded_at = datetime(uploaded_at, '+6 hours') WHERE uploaded_at IS NOT NULL AND uploaded_at != '';
`);
    handle.exec('COMMIT;');
  } catch (e) {
    handle.exec('ROLLBACK;');
    handle.exec('PRAGMA foreign_keys = ON;');
    throw e;
  }
  handle.exec('PRAGMA foreign_keys = ON;');
  handle.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
}

export function closeDatabase() {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch { /* noop */ }
  try {
    db.close();
  } catch { /* already closed */ }
}

export function replaceDatabase(buffer) {
  closeDatabase();
  for (const suffix of ['-wal', '-shm']) {
    try { rmSync(DB_PATH + suffix, { force: true }); } catch { /* noop */ }
  }
  writeFileSync(DB_PATH, buffer);
  db = openDatabase(DB_PATH);
}

/**
 * Restores the entire database atomically from structured table data.
 * This restores 100% of all records, relationships, foreign keys, settings,
 * and sequences safely in an atomic transaction without closing SQLite handles.
 */
export function restoreTablesFromData(tablesData, handle = db) {
  handle.exec('PRAGMA busy_timeout = 10000;');
  handle.exec('PRAGMA foreign_keys = OFF;');
  handle.exec('BEGIN TRANSACTION;');

  try {
    // 1. Get all current user tables in destination DB
    const existingTableRows = handle.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    const existingTables = existingTableRows.map((r) => r.name);

    // 2. Clear all existing data from tables in safe order
    for (const t of existingTables) {
      handle.exec(`DELETE FROM "${t.replace(/"/g, '""')}";`);
    }

    // 3. Insert all data from backup tables
    const tableNames = Object.keys(tablesData || {});
    for (const tableName of tableNames) {
      if (tableName.startsWith('sqlite_')) continue;
      const rows = tablesData[tableName];
      if (!Array.isArray(rows) || rows.length === 0) continue;

      // Make sure destination table exists
      if (!existingTables.includes(tableName)) continue;

      const columns = Object.keys(rows[0]);
      if (columns.length === 0) continue;

      const colList = columns.map((c) => `"${c.replace(/"/g, '""')}"`).join(', ');
      const placeholders = columns.map(() => '?').join(', ');
      const insertSql = `INSERT INTO "${tableName.replace(/"/g, '""')}" (${colList}) VALUES (${placeholders})`;
      const insertStmt = handle.prepare(insertSql);

      for (const row of rows) {
        const values = columns.map((col) => (row[col] === undefined ? null : row[col]));
        insertStmt.run(...values);
      }
    }

    // 4. Recompute sqlite_sequence from restored data to avoid stale or wrong backup seq values
    try {
      handle.exec('DELETE FROM sqlite_sequence;');
      const seqStmt = handle.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)');
      const autoTables = handle.prepare("SELECT name FROM sqlite_master WHERE type='table' AND sql LIKE '%AUTOINCREMENT%'").all();
      for (const t of autoTables) {
        const maxRow = handle.prepare(`SELECT MAX(id) AS mx FROM "${t.name.replace(/"/g, '""')}"`).get();
        const mx = Number(maxRow?.mx || 0);
        seqStmt.run(t.name, mx + 1);
      }
    } catch { /* noop if sqlite_sequence not writable */ }

    // 5. Restore is row-by-row and does NOT re-run ensureSchema, so a backup
    // taken before task_code existed inserts rows without that column and they
    // land as ''. Fill them in here, inside the same transaction, so every
    // restored task is immediately identifiable. Codes that ARE present in the
    // backup are left exactly as they were, which is what keeps a restored
    // Task ID stable. New codes are generated against the already-restored set,
    // so they cannot overlap anything that came back.
    try {
      const backfilled = backfillTaskCodes(handle);
      if (backfilled.length) console.log(`[RESTORE] Assigned Task IDs to restored rows: ${backfilled.join(', ')}`);
    } catch (err) {
      console.error('Error backfilling task codes after restore:', err);
    }

    handle.exec('COMMIT;');
  } catch (err) {
    handle.exec('ROLLBACK;');
    throw err;
  } finally {
    handle.exec('PRAGMA foreign_keys = ON;');
  }
}

export function createBaseTables(handle = db) {
  handle.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password_must_change INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'user',
  title TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  avatar TEXT DEFAULT '',
  employee_id TEXT DEFAULT '',
  live_status TEXT NOT NULL DEFAULT 'inactive',
  last_active_at TEXT,
  status_message TEXT DEFAULT '',
   status_updated_at TEXT,
   weekend_days TEXT DEFAULT '[5]',
   duty_time TEXT DEFAULT '',
  team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
   is_active INTEGER NOT NULL DEFAULT 1,
   token_version INTEGER NOT NULL DEFAULT 0,
   last_login TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
);

CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  description TEXT DEFAULT '',
  lead_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
);

CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  description TEXT DEFAULT '',
  head_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  hotline TEXT DEFAULT '',
  ext TEXT DEFAULT '',
  hotline_ext TEXT DEFAULT '',
  manager_name TEXT DEFAULT '',
  manager_ext TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo',
  priority TEXT NOT NULL DEFAULT 'medium',
  difficulty TEXT NOT NULL DEFAULT 'medium',
  task_type TEXT DEFAULT 'task',
  flags TEXT DEFAULT '[]',
  tags TEXT DEFAULT '[]',
  budget REAL DEFAULT 0,
  estimated_hours REAL DEFAULT 0,
  due_date TEXT,
  start_date TEXT,
  created_by INTEGER REFERENCES users(id),
  reviewer_id INTEGER REFERENCES users(id),
  team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  parent_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  approval_status TEXT DEFAULT 'none',
  is_blocked INTEGER NOT NULL DEFAULT 0,
  is_recurring INTEGER NOT NULL DEFAULT 0,
  recurring_rule TEXT DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0,
  is_self_task INTEGER NOT NULL DEFAULT 0,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  task_code TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours')),
  completed_at TEXT,
  completed_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS task_assignees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  progress INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'todo',
  assigned_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours')),
  completed_at TEXT,
  UNIQUE(task_id, user_id)
);

CREATE TABLE IF NOT EXISTS task_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  mentions TEXT DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
);

CREATE TABLE IF NOT EXISTS task_checklist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
);

CREATE TABLE IF NOT EXISTS task_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  filename TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  size INTEGER DEFAULT 0,
  mime TEXT DEFAULT '',
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  priority TEXT NOT NULL DEFAULT 'medium',
  start_date TEXT,
  deadline TEXT,
  budget REAL DEFAULT 0,
  spent REAL DEFAULT 0,
  progress INTEGER NOT NULL DEFAULT 0,
  color TEXT DEFAULT '#6366f1',
  created_by INTEGER REFERENCES users(id),
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
);

CREATE TABLE IF NOT EXISTS project_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours')),
  UNIQUE(project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);
CREATE INDEX IF NOT EXISTS idx_project_members_proj ON project_members(project_id);

CREATE TABLE IF NOT EXISTS task_dependencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  UNIQUE(task_id, depends_on)
);

CREATE TABLE IF NOT EXISTS time_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  hours REAL NOT NULL DEFAULT 0,
  note TEXT DEFAULT '',
  date TEXT NOT NULL DEFAULT (date('now','+6 hours')),
  created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
);

CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  requester_id INTEGER NOT NULL REFERENCES users(id),
  approver_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending',
  comment TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  message TEXT DEFAULT '',
  link TEXT DEFAULT '',
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_name TEXT DEFAULT '',
  action TEXT NOT NULL,
  entity_type TEXT DEFAULT '',
  entity_id INTEGER,
  details TEXT DEFAULT '',
  ip TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
);

CREATE TABLE IF NOT EXISTS holidays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  UNIQUE(date)
);

CREATE TABLE IF NOT EXISTS saved_filters (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     payload TEXT NOT NULL DEFAULT '{}',
     created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
   );
 
CREATE TABLE IF NOT EXISTS task_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      field TEXT DEFAULT '',
      old_value TEXT DEFAULT '',
      new_value TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
    );

    CREATE TABLE IF NOT EXISTS kpi_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_key TEXT NOT NULL UNIQUE,
      rule_name TEXT NOT NULL,
      rule_category TEXT NOT NULL DEFAULT 'general',
      points INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      description TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
    );

    CREATE TABLE IF NOT EXISTS kpi_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_name TEXT NOT NULL DEFAULT '',
      user_email TEXT NOT NULL DEFAULT '',
      task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      task_title TEXT NOT NULL DEFAULT '',
      task_code TEXT NOT NULL DEFAULT '',
      rule_key TEXT NOT NULL,
      rule_name TEXT NOT NULL,
      points INTEGER NOT NULL,
      config_value INTEGER NOT NULL,
      config_enabled INTEGER NOT NULL DEFAULT 1,
      reason TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours')),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_by_name TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_kpi_transactions_user ON kpi_transactions(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_kpi_transactions_task ON kpi_transactions(task_id);
    CREATE INDEX IF NOT EXISTS idx_kpi_transactions_rule ON kpi_transactions(rule_key);
    CREATE INDEX IF NOT EXISTS idx_kpi_transactions_date ON kpi_transactions(created_at);

    CREATE TABLE IF NOT EXISTS priority_tasks (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     work_title TEXT NOT NULL,
     description TEXT DEFAULT '',
     priority TEXT NOT NULL DEFAULT 'medium',
     assignee_name TEXT DEFAULT '',
     assignee_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
     status TEXT NOT NULL DEFAULT 'todo',
     due_date TEXT,
     remarks TEXT DEFAULT '',
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      transferred_to_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      transferred_at TEXT,
      task_code TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
    );
 
   CREATE TABLE IF NOT EXISTS priority_task_remarks (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     priority_task_id INTEGER NOT NULL REFERENCES priority_tasks(id) ON DELETE CASCADE,
     user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
     user_name TEXT DEFAULT '',
     user_avatar TEXT DEFAULT '',
     user_role TEXT DEFAULT '',
     remark TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
   );
 
   CREATE TABLE IF NOT EXISTS chat_messages (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
     sender_id INTEGER NOT NULL REFERENCES users(id),
     recipient_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
     group_id INTEGER REFERENCES chat_groups(id) ON DELETE CASCADE,
     conversation_id TEXT DEFAULT '',
     content TEXT NOT NULL,
     mentions TEXT DEFAULT '[]',
     created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours')),
     updated_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
   );

   CREATE TABLE IF NOT EXISTS chat_reads (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     read_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours')),
     UNIQUE(message_id, user_id)
   );

   CREATE TABLE IF NOT EXISTS chat_groups (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     description TEXT DEFAULT '',
     created_by INTEGER NOT NULL REFERENCES users(id),
     avatar TEXT DEFAULT '',
     is_active INTEGER NOT NULL DEFAULT 1,
     created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours')),
     updated_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
   );

    CREATE TABLE IF NOT EXISTS chat_group_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours')),
      UNIQUE(group_id, user_id)
    );

     CREATE TABLE IF NOT EXISTS chat_attachments (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
       sender_id INTEGER NOT NULL REFERENCES users(id),
       recipient_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
       group_id INTEGER REFERENCES chat_groups(id) ON DELETE CASCADE,
       filename TEXT NOT NULL,
       stored_name TEXT NOT NULL,
       size INTEGER DEFAULT 0,
       mime TEXT DEFAULT '',
       uploaded_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
     );

    CREATE TABLE IF NOT EXISTS document_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_id INTEGER REFERENCES document_folders(id) ON DELETE SET NULL,
      "path" TEXT NOT NULL DEFAULT '',
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours')),
      UNIQUE(parent_id, name)
    );

    CREATE INDEX IF NOT EXISTS idx_doc_folders_parent ON document_folders(parent_id);
    CREATE INDEX IF NOT EXISTS idx_doc_folders_path ON document_folders("path");
    CREATE INDEX IF NOT EXISTS idx_doc_folders_created_by ON document_folders(created_by);

    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      stored_name TEXT NOT NULL UNIQUE,
      original_name TEXT NOT NULL,
      file_type TEXT NOT NULL,
      mime TEXT DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0,
      file_path TEXT NOT NULL,
      uploaded_by INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
      upload_date TEXT NOT NULL DEFAULT (datetime('now','+6 hours')),
      last_updated TEXT NOT NULL DEFAULT (datetime('now','+6 hours')),
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
      team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
      "folder_id" INTEGER REFERENCES document_folders(id) ON DELETE SET NULL,
      tags TEXT DEFAULT '[]',
      description TEXT DEFAULT '',
      vendor_name TEXT DEFAULT '',
      version TEXT DEFAULT '1.0',
      access_permission TEXT NOT NULL DEFAULT 'authenticated',
      is_active INTEGER NOT NULL DEFAULT 1,
      view_count INTEGER NOT NULL DEFAULT 0,
      download_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id);
    CREATE INDEX IF NOT EXISTS idx_documents_department ON documents(department_id);
    CREATE INDEX IF NOT EXISTS idx_documents_team ON documents(team_id);
    CREATE INDEX IF NOT EXISTS idx_documents_uploader ON documents(uploaded_by);
    CREATE INDEX IF NOT EXISTS idx_documents_access ON documents(access_permission);
    CREATE INDEX IF NOT EXISTS idx_documents_active ON documents(is_active);
    CREATE INDEX IF NOT EXISTS idx_documents_upload_date ON documents(upload_date);
    CREATE INDEX IF NOT EXISTS idx_documents_file_type ON documents(file_type);
    CREATE INDEX IF NOT EXISTS idx_documents_tags ON documents(tags);

    CREATE TABLE IF NOT EXISTS document_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
      department_id INTEGER REFERENCES departments(id) ON DELETE CASCADE,
      permission TEXT NOT NULL DEFAULT 'view',
      granted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      granted_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours')),
      UNIQUE(document_id, user_id, team_id, department_id)
    );

    CREATE INDEX IF NOT EXISTS idx_doc_perms_doc ON document_permissions(document_id);
    CREATE INDEX IF NOT EXISTS idx_doc_perms_user ON document_permissions(user_id);

    CREATE TABLE IF NOT EXISTS document_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      field TEXT DEFAULT '',
      old_value TEXT DEFAULT '',
      new_value TEXT DEFAULT '',
      ip TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
    );

    CREATE INDEX IF NOT EXISTS idx_doc_history_doc ON document_history(document_id);
  `);
}

createBaseTables();
ensureSchema();
migrate();
