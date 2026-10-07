import { db, DEFAULT_BRANCHES, DEFAULT_TEAMS, DEFAULT_SUPER_ADMIN_PASSWORD } from './db.js';
import bcrypt from 'bcryptjs';
import { dateDaysAgo, addDays, today } from './utils.js';
import { generateTaskCode } from './services/taskCodeService.js';

// Deterministic, not random: this used to fall back to a random hex string, so a
// fresh install without DEFAULT_ADMIN_PASSWORD produced an unusable password.
const SEED_PASSWORD = DEFAULT_SUPER_ADMIN_PASSWORD;

export async function seed() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  const deptCount = db.prepare('SELECT COUNT(*) AS c FROM departments').get().c;
  const teamCount = db.prepare('SELECT COUNT(*) AS c FROM teams').get().c;
  const taskCount = db.prepare('SELECT COUNT(*) AS c FROM tasks').get().c;

  const leaveCount = db.prepare('SELECT COUNT(*) AS c FROM leave_applications').get().c;
  const leaveQuotaCount = db.prepare('SELECT COUNT(*) AS c FROM leave_quotas').get().c;

  // Seed leave quotas independently so they exist even if main seed early-returns
  if (leaveQuotaCount === 0 && count > 0) {
    try {
      db.exec('BEGIN');
      const year = new Date().getFullYear();
      const qStmt = db.prepare(`
        INSERT OR IGNORE INTO leave_quotas (user_id, year, el_quota, cl_quota, sl_quota, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now','+6 hours'), datetime('now','+6 hours'))
      `);
      const allUserIds = db.prepare('SELECT id FROM users').all();
      for (const u of allUserIds) {
        qStmt.run(u.id, year, 14, 10, 14, 'Initial yearly quota');
      }
      db.exec('COMMIT');
      console.log('[SEED] Seeded leave quotas for ' + allUserIds.length + ' users');
    } catch (e) {
      db.exec('ROLLBACK');
      console.error('[SEED] Error seeding leave quotas:', e?.message || e);
    }
  }

  if (count > 2 && deptCount >= 25 && teamCount >= 11 && taskCount > 0) return;

  const hash = (p) => bcrypt.hashSync(p, 12);

  if (count <= 2) {
    console.log('[SEED] Seeded users credential: ' + SEED_PASSWORD);
  }

  db.exec('BEGIN');
  try {
    const users = [];
    const addUser = (name, email, role, team, dept, title) => {
      const existing = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(email);
      if (existing) {
        // Do NOT reset the password of an existing user. A partial re-seed used
        // to overwrite everyone's password, which is why a password set through
        // the UI silently stopped working. The super admin password is owned by
        // ensureSchema in db.js, not here.
        db.prepare('UPDATE users SET role = ?, is_active = 1 WHERE id = ?')
          .run(role, existing.id);
         users.push({ id: Number(existing.id), name, email, role, team, dept });
         return users[users.length - 1];
       }
       const r = db.prepare(`
         INSERT INTO users (name, email, password_hash, role, title, weekend_days, is_active)
         VALUES (?, ?, ?, ?, ?, '[5]', 1)
       `).run(name, email, hash(SEED_PASSWORD), role, title);
      users.push({ id: Number(r.lastInsertRowid), name, email, role, team, dept });
      return users[users.length - 1];
    };

    // Delete existing old teams if needed
    db.exec('DELETE FROM teams');
    const teamIds = [];
    for (const t of DEFAULT_TEAMS) {
      db.prepare('INSERT INTO teams (id, name, description) VALUES (?, ?, ?)').run(t.id, t.name, t.description);
      teamIds.push(t.id);
    }

    // Delete existing old departments if needed
    db.exec('DELETE FROM departments');
    const deptIds = [];
    for (const b of DEFAULT_BRANCHES) {
      db.prepare('INSERT INTO departments (id, name, description, hotline_ext) VALUES (?, ?, ?, ?)').run(b.id, b.name, b.description, b.hotline_ext || '');
      deptIds.push(b.id);
    }

    const dhanmondiBranchId = 11;
    const superAdmin = addUser('Admin', 'dipu@populardiagnostic.com', 'super_admin', teamIds[0], dhanmondiBranchId, 'Administrator');

    const newStaff = [
      { name: 'Md. Kowsiq Ahmed', email: 'kowsiq@gmail.com', role: 'admin', title: 'Head of ICT' },
      { name: 'Md. Shahjahan Dipu', email: 'dipu@gmail.com', role: 'admin', title: 'Sr. Engineer ICT' },
      { name: 'Md. Abdullah Al Mamun', email: 'mamun@gmail.com', role: 'sub_admin', title: 'Sr. Executive' },
      { name: 'Md. Kamal Uddin', email: 'kamal@gmail.com', role: 'admin', title: 'Sr. Executive' },
      { name: 'Md. Maruf Ahmed', email: 'maruf@gmail.com', role: 'admin', title: 'Sr. Executive' },
      { name: 'K.M Minar Hossain', email: 'minar@gmail.com', role: 'user', title: 'Sr. Engineer ICT' },
      { name: 'Md. Mijanur Rahman', email: 'mijanur@gmail.com', role: 'user', title: 'Sr. Engineer ICT' },
      { name: 'Md. Ezazul Islam', email: 'ezazul@gmail.com', role: 'user', title: 'Sr. Engineer ICT' },
      { name: 'Kazi Md. Akramul Haque (Uzzal)', email: 'uzzal@gmail.com', role: 'user', title: 'Sr. Engineer ICT' },
      { name: 'Shahab Uddin Khan (Sumon)', email: 'sumon@gmail.com', role: 'user', title: 'Sr. Engineer ICT' },
      { name: 'Biprojit Kumar Dam', email: 'biprojit@gmail.com', role: 'user', title: 'Jr. IT Officer' },
      { name: 'Anupam Baroi', email: 'anupam@gmail.com', role: 'user', title: 'IT Officer' },
      { name: 'Shuvo Roy (Dipon)', email: 'dipon@gmail.com', role: 'user', title: 'IT Officer' },
      { name: 'Juel Rana', email: 'juel@gmail.com', role: 'user', title: 'IT Officer' },
      { name: 'Subroto Sarkar', email: 'subroto@gmail.com', role: 'user', title: 'IT Officer' },
      { name: 'Emon Bahadur', email: 'emon@gmail.com', role: 'user', title: 'IT Officer' },
      { name: 'Tomal Krishna Howlader', email: 'tomal@gmail.com', role: 'user', title: 'Jr. IT Officer' },
      { name: 'MD. Tarikur Rahman', email: 'tarikur@gmail.com', role: 'user', title: 'Sr. Software Engineer' },
      { name: 'Md. Mirza  Shihab', email: 'mirza@gmail.com', role: 'user', title: 'IT Officer' },
      { name: 'MD. SAKIB KAMAL', email: 'sakib@gmail.com', role: 'user', title: 'IT Officer' },
      { name: 'Md. Arif Hasan', email: 'arif@gmail.com', role: 'user', title: 'Graphics Designer' },
      { name: 'Ripol Khisa', email: 'ripol@gmail.com', role: 'user', title: 'Graphics Designer' },
      { name: 'Fahad Ahamed Shawon', email: 'fahad@gmail.com', role: 'user', title: 'IT Officer' },
      { name: 'MD. RAKIBUL ISLAM', email: 'rakib@gmail.com', role: 'user', title: 'IT Assistant' },
      { name: 'Shah Alam Robin', email: 'robin@gmail.com', role: 'user', title: 'IT Assistant' },
      { name: 'Md Yeamin Hossain Fuhad', email: 'yeamin@gmail.com', role: 'user', title: 'IT Assistant' },
      { name: 'MD AFFANUL HAQUE (FARISI)', email: 'farisi@gmail.com', role: 'user', title: 'IT Assistant' },
      { name: 'Aftab Uddin Wattin', email: 'wattin@gmail.com', role: 'user', title: 'Computer Operator' }
    ];

    const addedStaff = newStaff.map((s, idx) => {
      const teamId = teamIds[idx % teamIds.length];
      const roleGroupId = s.role === 'admin' ? 2 : s.role === 'sub_admin' ? 3 : 4;
      const user = addUser(s.name, s.email, s.role, teamId, dhanmondiBranchId, s.title);
      db.prepare('UPDATE users SET role_group_id = ?, department_id = ?, team_id = ? WHERE id = ?')
        .run(roleGroupId, dhanmondiBranchId, teamId, user.id);
      return user;
    });

    const allPeople = [superAdmin, ...addedStaff];
    const admins = allPeople.filter((u) => u.role === 'admin' || u.role === 'super_admin');
    const members = allPeople.filter((u) => u.role !== 'admin' && u.role !== 'super_admin');

    db.prepare('UPDATE users SET team_id = ?, department_id = ?, role_group_id = 1 WHERE id = ?')
      .run(teamIds[0], dhanmondiBranchId, superAdmin.id);

    if (addedStaff.length > 0) {
      db.prepare('UPDATE teams SET lead_id = ? WHERE id = ?').run(addedStaff[0].id, teamIds[0]);
      db.prepare('UPDATE departments SET head_id = ? WHERE id = ?').run(addedStaff[0].id, dhanmondiBranchId);
    }

    const flagSet = ['Development', 'Client', 'Bug', 'Security', 'Design', 'Testing', 'Finance', 'Urgent'];
    const tagSet = ['frontend', 'backend', 'api', 'design', 'research', 'infra', 'marketing', 'data', 'mobile', 'automation'];
    const titles = [
      'Implement OAuth2 single sign-on flow',
      'Redesign analytics dashboard home',
      'Fix intermittent 503 errors on checkout',
      'Q3 customer onboarding campaign',
      'Migrate legacy billing service to new stack',
      'Design mobile app onboarding screens',
      'Build KPI reporting module',
      'Annual security audit remediation',
      'Automate CI deployment pipeline',
      'Customer support knowledge base',
      'Optimize database query performance',
      'Plan product roadmap for next quarter',
      'Update privacy policy and terms',
      'Create developer documentation portal',
      'Set up monitoring and alerting stack',
      'Refactor notification service',
      'Run usability testing sessions',
      'Prepare investor pitch deck',
      'Improve search relevance scoring',
      'Data warehouse migration to Snowflake',
    ];

    const statuses = ['todo', 'discussion', 'in_progress', 'in_review', 'done', 'cancelled'];
    const priorities = ['low', 'medium', 'high', 'critical'];
    const difficulties = ['easy', 'medium', 'hard', 'critical'];
    const types = ['task', 'bug', 'feature', 'research', 'design', 'infra'];

    const taskIds = [];
    for (let i = 0; i < titles.length; i++) {
      const createdDaysAgo = (i * 3) % 60;
      const created = dateDaysAgo(createdDaysAgo);
      const status = i < 3 ? 'done' : statuses[i % statuses.length];
      const priority = priorities[i % priorities.length];
      const difficulty = difficulties[i % difficulties.length];
      const dueDaysFromNow = (i % 14) - 5;
      const due = addDays(today(), dueDaysFromNow);
      const assignees = [
        allPeople[i % allPeople.length],
        allPeople[(i + 3) % allPeople.length],
      ];
      const progress = status === 'done' ? 100 : (i * 17) % 90;
      const createdBy = superAdmin.id;
      const flags = JSON.stringify([flagSet[i % flagSet.length], flagSet[(i + 5) % flagSet.length]]);
      const tags = JSON.stringify([tagSet[i % tagSet.length], tagSet[(i + 2) % tagSet.length]]);

      const r = db.prepare(`
        INSERT INTO tasks (
          title, description, status, priority, difficulty, task_type, flags, tags,
          budget, estimated_hours, due_date, created_by, reviewer_id, team_id, department_id,
          progress, approval_status, task_code, created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        titles[i],
        `Detailed description for "${titles[i]}". This task was seeded for demo purposes and includes context, acceptance criteria and out-of-scope notes.`,
        status, priority, difficulty, types[i % types.length], flags, tags,
        Math.round((i * 137) % 50) * 100, (i % 8) + 2, due, createdBy,
        allPeople[(i + 1) % allPeople.length].id, teamIds[i % teamIds.length], deptIds[i % deptIds.length],
        progress, 'none', generateTaskCode('TSK'),
        `${created} ${String(9 + (i % 8)).padStart(2, '0')}:00`, dateDaysAgo(createdDaysAgo > 0 ? createdDaysAgo - 1 : 0),
        status === 'done' ? dateDaysAgo(Math.max(0, createdDaysAgo - 2)) : null,
      );
      const taskId = Number(r.lastInsertRowid);
      taskIds.push(taskId);

      const updateProgress = status === 'done' ? 100 : progress;
      for (let j = 0; j < assignees.length; j++) {
        db.prepare(`
          INSERT INTO task_assignees (task_id, user_id, progress, status, assigned_at, completed_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(taskId, assignees[j].id, updateProgress, status === 'done' ? 'done' : status,
          `${created} 09:00`, status === 'done' ? dateDaysAgo(1) : null);
      }

      if (i % 3 === 0) {
        db.prepare(`INSERT INTO task_comments (task_id, user_id, content, created_at) VALUES (?, ?, ?, ?)`)
          .run(taskId, assignees[0].id, 'Any update on this one? Looks like we are on track.', `${created} 14:30`);
      }
      if (i % 4 === 0) {
        db.prepare(`INSERT INTO task_comments (task_id, user_id, content, created_at) VALUES (?, ?, ?, ?)`)
          .run(taskId, assignees[1].id, 'Working on this today. Will push a branch shortly.', `${created} 10:15`);
      }
      if (i % 5 === 0) {
        const checklist = ['Initial research', 'Implementation', 'Code review', 'Deploy to staging'];
        checklist.forEach((c, ci) => {
          db.prepare(`INSERT INTO task_checklist (task_id, title, done, created_by) VALUES (?, ?, ?, ?)`)
            .run(taskId, c, status === 'done' ? 1 : (ci <= (i % 4) ? 1 : 0), createdBy);
        });
      }
      if (i % 7 === 0) {
        db.prepare(`INSERT INTO time_entries (task_id, user_id, hours, note, date) VALUES (?, ?, ?, ?, ?)`)
          .run(taskId, assignees[0].id, 1.5 + (i % 4), 'Focused work', created);
      }
      if (i % 9 === 0) {
        db.prepare(`INSERT INTO notifications (user_id, type, title, message, created_at) VALUES (?, 'task', ?, ?, ?)`)
          .run(assignees[0].id, 'Task assigned to you', titles[i], created);
      }
    }

    for (const u of allPeople.slice(0, 6)) {
      db.prepare(`INSERT INTO notifications (user_id, type, title, message, created_at) VALUES (?, 'system', 'Welcome to PDCL ICT', ?, ?)`)
        .run(u.id, `Your account is ready. Complete your profile to get started.`, dateDaysAgo(20));
    }

    if (members.length > 0) {
      db.prepare(`INSERT INTO notifications (user_id, type, title, message, created_at) VALUES (?, 'deadline', 'Deadline approaching', ?, ?)`)
        .run(members[0].id, 'Several of your tasks are due within the next 24 hours.', dateDaysAgo(0));
    }

    db.prepare(`INSERT INTO audit_logs (user_id, user_name, action, entity_type, details, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(superAdmin.id, superAdmin.name, 'system.seed', 'system', 'Initial database seeded with demo data', dateDaysAgo(20));

    const holiday = today();
    db.prepare(`INSERT INTO holidays (date, name) VALUES (?, ?)`).run(holiday, 'Platform launch day');

    // Seed sample priority tasks
    const priorityCount = db.prepare('SELECT COUNT(*) AS c FROM priority_tasks').get().c;
    if (priorityCount === 0) {
      const admin0 = admins[0] || superAdmin;
      const admin1 = admins[1] || admin0;
      const member0 = members[0] || allPeople[0];
      const member5 = members[5] || members[1] || member0;

      const pTasks = [
        ['Core Security Audit & Token Upgrade', 'Patch authentication endpoints and rotate cryptographic secrets across servers', 'critical', superAdmin.name, superAdmin.id, 'in_progress', addDays(today(), 3), 'Urgent requirement from security team', superAdmin.id],
        ['Q3 Financial Reconciliation & KPI', 'Compile executive balance report and compute departmental quarterly scores', 'high', admin1.name, admin1.id, 'todo', addDays(today(), 7), 'Submit to board of directors', superAdmin.id],
        ['Database Query Optimization & Indexing', 'Add composite indexes on tasks and priority_tasks tables to ensure <50ms query times', 'high', member0.name, member0.id, 'in_progress', addDays(today(), 5), 'Target 50% lower I/O latency', admin0.id],
        ['Emergency Backup Server Configuration', 'Deploy cold storage replica in disaster recovery zone', 'critical', 'External Cloud Ops Team', null, 'todo', addDays(today(), 4), 'Third-party vendor contract active', superAdmin.id],
        ['Mobile Responsive Layout Polish', 'Fix viewport scaling and touch target accessibility on priority task views', 'medium', member5.name, member5.id, 'done', addDays(today(), -1), 'QA testing passed with 100% score', admin0.id],
      ];

      const pStmt = db.prepare(`
        INSERT INTO priority_tasks (work_title, description, priority, assignee_name, assignee_user_id, status, due_date, remarks, created_by, task_code, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','+6 hours'), datetime('now','+6 hours'))
      `);

      for (const pt of pTasks) {
        pStmt.run(...pt, generateTaskCode('PTY'));
      }
    }

    // Seed sample leave applications
    if (leaveCount === 0 && members.length > 0) {
      const year = new Date().getFullYear();
      const lStmt = db.prepare(`
        INSERT INTO leave_applications (
          user_id, leave_type, duration_type, start_date, end_date, days_count,
          year, reason, reliever_user_id, emergency_contact, status, admin_remarks, approved_by, approved_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','+6 hours'))
      `);

      // 1. Approved Earned Leave (3 days) for members[0]
      lStmt.run(
        members[0].id, 'EL', 'full_day',
        addDays(today(), -10), addDays(today(), -8), 3,
        year, 'Family vacation and personal travel',
        members[1]?.id || null, '+880 1711 000001',
        'approved', 'Approved. Please hand over ongoing sprints.',
        superAdmin.id, addDays(today(), -12)
      );

      // 2. Approved Casual Leave (2 days) for members[0]
      lStmt.run(
        members[0].id, 'CL', 'full_day',
        addDays(today(), -3), addDays(today(), -2), 2,
        year, 'Urgent household maintenance work',
        members[2]?.id || null, '+880 1711 000001',
        'approved', 'Approved.',
        admins[0].id, addDays(today(), -4)
      );

      // 3. Pending Casual Leave (1 day) for members[1]
      if (members[1]) {
        lStmt.run(
          members[1].id, 'CL', 'full_day',
          addDays(today(), 2), addDays(today(), 2), 1,
          year, 'Personal bank and official documentation work',
          members[0].id, '+880 1811 000002',
          'pending', '', null, null
        );
      }

      // 4. Pending Sick Leave (2 days) for members[2]
      if (members[2]) {
        lStmt.run(
          members[2].id, 'SL', 'full_day',
          addDays(today(), 1), addDays(today(), 2), 2,
          year, 'Doctor advised rest for seasonal flu recovery',
          members[3]?.id || null, '+880 1911 000003',
          'pending', '', null, null
        );
      }

      // 5. Approved Sick Leave (1 day) for superAdmin
      lStmt.run(
        superAdmin.id, 'SL', 'full_day',
        addDays(today(), -15), addDays(today(), -15), 1,
        year, 'Medical checkup and routine diagnostics',
        admins[0].id, '+880 1611 000000',
        'approved', 'Self-approved admin leave.',
        superAdmin.id, addDays(today(), -16)
      );
     }

     db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
