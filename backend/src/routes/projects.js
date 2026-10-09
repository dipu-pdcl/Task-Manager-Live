import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireAdmin, isAdmin, audit } from '../middleware.js';
import { notify } from '../middleware.js';
import { generateTaskCode } from '../services/taskCodeService.js';
import { today, checkUserAvailability } from '../utils.js';
import { getKpiConfig, getKpiRule, recordKpiTransaction } from '../services/kpiEngine.js';

const router = Router();
router.use(requireAuth);

const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const STATUSES = ['active', 'on_hold', 'completed', 'cancelled'];

function recomputeProjectProgress(projectId) {
  const stats = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done_count,
      SUM(CASE WHEN status IN ('in_progress','in_review') THEN 1 ELSE 0 END) AS wip_count,
      SUM(CASE WHEN status = 'todo' THEN 1 ELSE 0 END) AS todo_count,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_count
    FROM tasks
    WHERE project_id = ? AND archived = 0
  `).get(projectId);
  const total = stats?.total || 0;
  const done = stats?.done_count || 0;
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;
  db.prepare('UPDATE projects SET progress = ?, updated_at = datetime(\'now\', \'+6 hours\') WHERE id = ?').run(progress, projectId);
  return { total, done, progress, wip: stats?.wip_count || 0, todo: stats?.todo_count || 0, cancelled: stats?.cancelled_count || 0 };
}

function getMemberIds(projectId) {
  return db.prepare('SELECT user_id FROM project_members WHERE project_id = ?').all(projectId).map((r) => r.user_id);
}

function isProjectMember(projectId, userId) {
  const r = db.prepare('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?').get(projectId, userId);
  return !!r;
}

function canViewProject(project, userId, isUserAdmin) {
  if (isUserAdmin) return true;
  if (project.created_by === userId) return true;
  return isProjectMember(project.id, userId);
}

function canManageProject(project, userId, isUserAdmin) {
  if (isUserAdmin) return true;
  if (project.created_by === userId) return true;
  const m = db.prepare("SELECT role FROM project_members WHERE project_id = ? AND user_id = ? AND role = 'lead'").get(project.id, userId);
  return !!m;
}

function enrichProject(p, userId, isUserAdmin) {
  const memberCount = db.prepare('SELECT COUNT(*) AS c FROM project_members WHERE project_id = ?').get(p.id).c;
  const taskStats = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN status IN ('in_progress','in_review') THEN 1 ELSE 0 END) AS wip,
      SUM(CASE WHEN status = 'todo' THEN 1 ELSE 0 END) AS todo,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
    FROM tasks WHERE project_id = ? AND archived = 0
  `).get(p.id);
  const creator = db.prepare('SELECT id, name, avatar, role FROM users WHERE id = ?').get(p.created_by);
  const isMember = isUserAdmin || p.created_by === userId || isProjectMember(p.id, userId);
  return {
    ...p,
    member_count: memberCount,
    task_count: taskStats?.total || 0,
    done_count: taskStats?.done || 0,
    wip_count: taskStats?.wip || 0,
    todo_count: taskStats?.todo || 0,
    cancelled_count: taskStats?.cancelled || 0,
    progress: taskStats?.total ? Math.round(((taskStats.done || 0) / taskStats.total) * 100) : 0,
    creator: creator ? { id: creator.id, name: creator.name, avatar: creator.avatar, role: creator.role } : null,
    is_member: isMember,
  };
}

router.get('/', (req, res) => {
  const userId = req.user.id;
  const isUserAdmin = isAdmin(req.user);
  const { archived = '0' } = req.query;
  const includeArchived = archived === '1' || archived === 'true';

  let projects;
  if (isUserAdmin) {
    projects = db.prepare(`
      SELECT * FROM projects
      WHERE archived = ?
      ORDER BY (CASE WHEN status = 'active' THEN 0 WHEN status = 'on_hold' THEN 1 ELSE 2 END), updated_at DESC
    `).all(includeArchived ? 1 : 0);
  } else {
    projects = db.prepare(`
      SELECT p.* FROM projects p
      WHERE p.archived = ?
        AND (p.created_by = ? OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = ?))
      ORDER BY (CASE WHEN p.status = 'active' THEN 0 WHEN p.status = 'on_hold' THEN 1 ELSE 2 END), p.updated_at DESC
    `).all(includeArchived ? 1 : 0, userId, userId);
  }

  const enriched = projects.map((p) => enrichProject(p, userId, isUserAdmin));
  res.json({ projects: enriched });
});

router.get('/:id', (req, res) => {
  const userId = req.user.id;
  const isUserAdmin = isAdmin(req.user);
  const { id } = req.params;

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(id));
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!canViewProject(project, userId, isUserAdmin)) return res.status(403).json({ error: 'Not authorized to view this project' });

  const members = db.prepare(`
    SELECT pm.id, pm.role, pm.joined_at,
           u.id AS user_id, u.name, u.email, u.role AS user_role, u.avatar, u.live_status,
           rg.color AS role_group_color
    FROM project_members pm
    JOIN users u ON u.id = pm.user_id
    LEFT JOIN role_groups rg ON rg.id = u.role_group_id
    WHERE pm.project_id = ?
    ORDER BY pm.role DESC, u.name
  `).all(project.id);

  const taskStats = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN status IN ('in_progress','in_review') THEN 1 ELSE 0 END) AS wip,
      SUM(CASE WHEN status = 'todo' THEN 1 ELSE 0 END) AS todo,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
    FROM tasks WHERE project_id = ? AND archived = 0
  `).get(project.id);

  const tasks = db.prepare(`
    SELECT t.id, t.title, t.status, t.priority, t.due_date, t.start_date, t.progress, t.completed_at, t.updated_at
    FROM tasks t
    WHERE t.project_id = ? AND t.archived = 0
    ORDER BY (CASE WHEN t.status = 'in_progress' THEN 0 WHEN t.status = 'in_review' THEN 1 WHEN t.status = 'todo' THEN 2 WHEN t.status = 'done' THEN 3 ELSE 4 END), t.due_date
  `).all(project.id);

  const assigneesByTask = db.prepare(`
    SELECT ta.task_id, u.id, u.name, u.avatar
    FROM task_assignees ta JOIN users u ON u.id = ta.user_id
    WHERE ta.task_id IN (SELECT id FROM tasks WHERE project_id = ?)
  `).all(project.id);
  const byTask = {};
  for (const a of assigneesByTask) {
    (byTask[a.task_id] = byTask[a.task_id] || []).push({ id: a.id, name: a.name, avatar: a.avatar });
  }
  const tasksWithAssignees = tasks.map((t) => ({ ...t, assignees: byTask[t.id] || [] }));

  const creator = db.prepare('SELECT id, name, avatar, role FROM users WHERE id = ?').get(project.created_by);

  res.json({
    project: {
      ...project,
      task_count: taskStats?.total || 0,
      done_count: taskStats?.done || 0,
      wip_count: taskStats?.wip || 0,
      todo_count: taskStats?.todo || 0,
      cancelled_count: taskStats?.cancelled || 0,
      progress: taskStats?.total ? Math.round(((taskStats.done || 0) / taskStats.total) * 100) : 0,
      creator: creator || null,
      can_manage: canManageProject(project, userId, isUserAdmin),
    },
    members,
    tasks: tasksWithAssignees,
    is_admin: isUserAdmin,
  });
});

router.post('/', requireAdmin, (req, res) => {
  const { name, description = '', priority = 'medium', start_date = null, deadline = null, budget = 0, color = '#6366f1', memberIds = [] } = req.body || {};
  const userId = req.user.id;

  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Project name is required' });
  if (!PRIORITIES.includes(priority)) return res.status(400).json({ error: 'Invalid priority' });

  const r = db.prepare(`
    INSERT INTO projects (name, description, status, priority, start_date, deadline, budget, color, created_by, created_at, updated_at)
    VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, datetime('now','+6 hours'), datetime('now','+6 hours'))
  `).run(String(name).trim(), String(description || '').trim(), priority, start_date || null, deadline || null, Number(budget) || 0, color, userId);

  const projectId = Number(r.lastInsertRowid);

  db.prepare(`INSERT INTO project_members (project_id, user_id, role, joined_at) VALUES (?, ?, 'lead', datetime('now','+6 hours'))`).run(projectId, userId);

  if (Array.isArray(memberIds)) {
    const ins = db.prepare(`INSERT OR IGNORE INTO project_members (project_id, user_id, role, joined_at) VALUES (?, ?, 'member', datetime('now','+6 hours'))`);
    for (const mid of memberIds) {
      if (Number.isInteger(mid) && mid !== userId) {
        const u = db.prepare('SELECT id FROM users WHERE id = ? AND is_active = 1').get(mid);
        if (u) ins.run(projectId, mid);
      }
    }
  }

  audit(req, 'project.create', 'project', projectId, `Created project "${name}"`);

  // Record KPI for project creation. The creator earns the create_project
  // rule's points; calculateUserKpi derives those from the projects table
  // directly, so this transaction is an audit trail, not the scorekeeper.
  try {
    const projectPoints = getKpiRule('create_project');
    if (projectPoints !== 0) {
      const config = getKpiConfig();
      recordKpiTransaction({
        userId,
        userName: req.user.name || '',
        userEmail: req.user.email || '',
        projectId,
        projectName: name,
        ruleKey: 'create_project',
        ruleName: config.create_project?.rule_name || 'Project Creation',
        points: projectPoints,
        configValue: projectPoints,
        configEnabled: config.create_project?.enabled ?? true,
        reason: 'Project creation',
        createdBy: userId,
        createdByName: req.user.name || '',
      });
    }
  } catch (err) {
    console.error('[KPI] Failed to record project creation KPI:', err);
  }

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  res.status(201).json({ project: enrichProject(project, userId, true) });
});

router.put('/:id', (req, res) => {
  const userId = req.user.id;
  const isUserAdmin = isAdmin(req.user);
  const { id } = req.params;
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(id));
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!canManageProject(project, userId, isUserAdmin)) return res.status(403).json({ error: 'Not authorized to edit this project' });

  const { name, description, priority, start_date, deadline, budget, spent, color, status } = req.body || {};
  const updates = [];
  const params = [];
  if (typeof name === 'string' && name.trim()) { updates.push('name = ?'); params.push(name.trim()); }
  if (typeof description === 'string') { updates.push('description = ?'); params.push(description.trim()); }
  if (typeof priority === 'string' && PRIORITIES.includes(priority)) { updates.push('priority = ?'); params.push(priority); }
  if (start_date !== undefined) { updates.push('start_date = ?'); params.push(start_date || null); }
  if (deadline !== undefined) { updates.push('deadline = ?'); params.push(deadline || null); }
  if (budget !== undefined) { updates.push('budget = ?'); params.push(Number(budget) || 0); }
  if (spent !== undefined) { updates.push('spent = ?'); params.push(Number(spent) || 0); }
  if (typeof color === 'string') { updates.push('color = ?'); params.push(color); }
  if (typeof status === 'string' && STATUSES.includes(status)) { updates.push('status = ?'); params.push(status); }

  if (updates.length === 0) return res.json({ project: enrichProject(project, userId, isUserAdmin) });
  updates.push("updated_at = datetime('now','+6 hours')");
  params.push(project.id);
  db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  audit(req, 'project.update', 'project', project.id, `Updated project "${project.name}"`);
  const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(project.id);
  res.json({ project: enrichProject(updated, userId, isUserAdmin) });
});

router.delete('/:id', requireAdmin, (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });
  db.prepare("UPDATE projects SET archived = 1, status = 'cancelled', updated_at = datetime('now','+6 hours') WHERE id = ?").run(project.id);
  audit(req, 'project.archive', 'project', project.id, `Archived project "${project.name}"`);
  res.json({ ok: true });
});

router.post('/:id/members', (req, res) => {
  const userId = req.user.id;
  const isUserAdmin = isAdmin(req.user);
  const { id } = req.params;
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(id));
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!canManageProject(project, userId, isUserAdmin)) return res.status(403).json({ error: 'Not authorized' });
  const { userIds, role = 'member' } = req.body || {};
  if (!Array.isArray(userIds) || userIds.length === 0) return res.status(400).json({ error: 'userIds array required' });
  const ins = db.prepare("INSERT OR IGNORE INTO project_members (project_id, user_id, role, joined_at) VALUES (?, ?, ?, datetime('now','+6 hours'))");
  let added = 0;
  for (const uid of userIds) {
    if (!Number.isInteger(uid)) continue;
    const u = db.prepare('SELECT id FROM users WHERE id = ? AND is_active = 1').get(uid);
    if (u) {
      const r = ins.run(project.id, uid, role);
      if (r.changes > 0) {
        added++;
        try {
          notify(uid, 'project.added', 'Added to project', `You were added to project "${project.name}"`, `/projects/${project.id}`);
        } catch {}
      }
    }
  }
  db.prepare("UPDATE projects SET updated_at = datetime('now','+6 hours') WHERE id = ?").run(project.id);
  audit(req, 'project.add_members', 'project', project.id, `Added ${added} members`);
  res.json({ ok: true, added });
});

router.delete('/:id/members/:userId', (req, res) => {
  const callerId = req.user.id;
  const isUserAdmin = isAdmin(req.user);
  const { id, userId } = req.params;
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(id));
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const targetId = Number(userId);
  const selfLeave = targetId === callerId;
  if (!selfLeave && !canManageProject(project, callerId, isUserAdmin)) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  if (project.created_by === targetId) {
    return res.status(400).json({ error: 'Cannot remove the project creator' });
  }
  const r = db.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').run(project.id, targetId);
  if (r.changes === 0) return res.status(404).json({ error: 'Member not found' });
  audit(req, 'project.remove_member', 'project', project.id, `Removed member ${targetId}`);
  res.json({ ok: true });
});

router.put('/:id/members/:userId', (req, res) => {
  const callerId = req.user.id;
  const isUserAdmin = isAdmin(req.user);
  const { id, userId } = req.params;
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(id));
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!canManageProject(project, callerId, isUserAdmin)) return res.status(403).json({ error: 'Not authorized' });
  const { role } = req.body || {};
  if (!['lead', 'member', 'viewer'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  db.prepare('UPDATE project_members SET role = ? WHERE project_id = ? AND user_id = ?').run(role, project.id, Number(userId));
  audit(req, 'project.update_member', 'project', project.id, `Set ${userId} role to ${role}`);
  res.json({ ok: true });
});

router.get('/:id/tasks', (req, res) => {
  const userId = req.user.id;
  const isUserAdmin = isAdmin(req.user);
  const { id } = req.params;
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(id));
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!canViewProject(project, userId, isUserAdmin)) return res.status(403).json({ error: 'Not authorized' });
  const tasks = db.prepare(`
    SELECT t.*,
      (SELECT GROUP_CONCAT(ta.user_id) FROM task_assignees ta WHERE ta.task_id = t.id) AS assignee_ids,
      (SELECT GROUP_CONCAT(u.name, '||') FROM task_assignees ta JOIN users u ON u.id = ta.user_id WHERE ta.task_id = t.id) AS assignee_names
    FROM tasks t
    WHERE t.project_id = ? AND t.archived = 0
    ORDER BY t.created_at DESC
  `).all(project.id);
  res.json({ tasks: tasks.map((t) => ({ ...t, assignee_ids: t.assignee_ids ? t.assignee_ids.split(',').map(Number) : [], assignee_names: t.assignee_names ? t.assignee_names.split('||') : [] })) });
});

router.post('/:id/tasks', (req, res) => {
  const userId = req.user.id;
  const isUserAdmin = isAdmin(req.user);
  const { id } = req.params;
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(id));
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!canManageProject(project, userId, isUserAdmin) && !isProjectMember(project.id, userId)) {
    return res.status(403).json({ error: 'Not authorized to add tasks to this project' });
  }
  const { title, description = '', priority = 'medium', status = 'todo', due_date = null, start_date = null, difficulty = 'medium', assigneeIds = [] } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Task title is required' });

  const r = db.prepare(`
    INSERT INTO tasks (title, description, status, priority, difficulty, due_date, start_date, project_id, created_by, task_code, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','+6 hours'), datetime('now','+6 hours'))
  `).run(String(title).trim(), String(description || '').trim(), status, priority, difficulty, due_date || null, start_date || null, project.id, userId, generateTaskCode('TSK'));

  const taskId = Number(r.lastInsertRowid);
  if (Array.isArray(assigneeIds) && assigneeIds.length > 0) {
    const ins = db.prepare("INSERT OR IGNORE INTO task_assignees (task_id, user_id, status, assigned_at) VALUES (?, ?, 'todo', datetime('now','+6 hours'))");
    for (const uid of assigneeIds) {
      if (!Number.isInteger(uid)) continue;
      const u = db.prepare('SELECT id FROM users WHERE id = ? AND is_active = 1').get(uid);
      if (u) {
        // Check if user is available (not on leave or weekend)
        const availability = checkUserAvailability(uid, today());
        if (!availability.available) {
          return res.status(400).json({ error: availability.reason });
        }
        ins.run(taskId, uid);
        try { notify(uid, 'task.assigned', 'Project task assigned', `You were assigned "${title}" in project "${project.name}"`, `/tasks/${taskId}`); } catch {}
      }
    }
  }
  recomputeProjectProgress(project.id);
  audit(req, 'project.add_task', 'project', project.id, `Added task "${title}"`);
  res.status(201).json({ ok: true, taskId });
});

router.get('/:id/stats', (req, res) => {
  const userId = req.user.id;
  const isUserAdmin = isAdmin(req.user);
  const { id } = req.params;
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(id));
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!canViewProject(project, userId, isUserAdmin)) return res.status(403).json({ error: 'Not authorized' });

  const statusBreakdown = db.prepare(`
    SELECT status, COUNT(*) AS c FROM tasks WHERE project_id = ? AND archived = 0 GROUP BY status
  `).all(project.id);
  const priorityBreakdown = db.prepare(`
    SELECT priority, COUNT(*) AS c FROM tasks WHERE project_id = ? AND archived = 0 GROUP BY priority
  `).all(project.id);
  const memberContrib = db.prepare(`
    SELECT u.id, u.name, u.avatar,
           SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done,
           COUNT(t.id) AS total
    FROM project_members pm
    JOIN users u ON u.id = pm.user_id
    LEFT JOIN task_assignees ta ON ta.user_id = u.id
    LEFT JOIN tasks t ON t.id = ta.task_id AND t.project_id = ? AND t.archived = 0
    WHERE pm.project_id = ?
    GROUP BY u.id
    ORDER BY done DESC
  `).all(project.id, project.id);

  res.json({
    status_breakdown: statusBreakdown,
    priority_breakdown: priorityBreakdown,
    member_contribution: memberContrib,
  });
});

export function updateProjectProgressForTask(taskId) {
  const r = db.prepare('SELECT project_id FROM tasks WHERE id = ?').get(taskId);
  if (r && r.project_id) recomputeProjectProgress(r.project_id);
}

export default router;
