import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { db } from '../db.js';
import { requireAuth, requirePermission, requireAdmin, isAdmin, audit, logHistory, notify } from '../middleware.js';
import { generateTaskCode, formatTaskCode } from '../services/taskCodeService.js';
import { today, checkUserAvailability } from '../utils.js';

const router = Router();
router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
});

export function transferPriorityTaskToMainTask(pt, req, options = {}) {
  const includeRemarks = options.includeRemarks !== false;
  const flags = JSON.stringify([]);
  const tags = JSON.stringify(['Priority Task', 'Transferred Backup']);
  const progress = pt.status === 'done' ? 100 : (pt.status === 'in_progress' ? 50 : 0);
  const completedAt = pt.status === 'done' ? new Date().toISOString() : null;

  // Insert into main tasks table
  const insertTaskStmt = db.prepare(`
    INSERT INTO tasks (
      title, description, status, priority, difficulty, task_type, flags, tags,
      budget, estimated_hours, due_date, start_date, created_by, reviewer_id,
      team_id, department_id, parent_task_id, progress, is_blocked, is_recurring,
      recurring_rule, is_self_task, task_code, created_at, updated_at, completed_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, datetime('now','+6 hours'), datetime('now','+6 hours'), ?
    )
  `);

  // The transferred row becomes its own task, so it gets a fresh TSK code and
  // keeps its identity separate from the PTY code of the priority task.
  const result = insertTaskStmt.run(
    pt.work_title,
    pt.description || '',
    pt.status || 'todo',
    pt.priority || 'medium',
    'medium',
    'task',
    flags,
    tags,
    0,
    0,
    pt.due_date || null,
    null,
    req?.user?.id || pt.created_by || null,
    null,
    null,
    null,
    null,
    progress,
    0,
    0,
    '',
    0,
    generateTaskCode('TSK'),
    completedAt
  );

  const newTaskId = Number(result.lastInsertRowid);

  // If assignee is a matched system user, link to task_assignees
  if (pt.assignee_user_id) {
    try {
      // Check if user is available (not on leave or weekend)
      const availability = checkUserAvailability(pt.assignee_user_id, today());
      if (!availability.available) {
        console.warn(`Skipping assignee ${pt.assignee_user_id} during transfer: ${availability.reason}`);
      } else {
        db.prepare(`
          INSERT OR IGNORE INTO task_assignees (task_id, user_id, progress, status, assigned_at)
          VALUES (?, ?, ?, ?, datetime('now','+6 hours'))
        `).run(newTaskId, pt.assignee_user_id, progress, pt.status || 'todo');

        if (req?.user?.id !== pt.assignee_user_id) {
          notify(
            pt.assignee_user_id,
            'task',
            'Priority Task transferred to main queue',
            `"${pt.work_title}" has been transferred to the main task board.`,
            `/tasks/${newTaskId}`
          );
        }
        logHistory(newTaskId, req?.user?.id || null, 'assignee.add', 'assignee', '', pt.assignee_user_name || pt.assignee_name || '');
      }
    } catch (e) {
      console.warn('Failed to link assignee during transfer:', e);
    }
  }

  // Transfer remarks to task_comments
  if (includeRemarks) {
    try {
      const remarks = db.prepare(`
        SELECT * FROM priority_task_remarks
        WHERE priority_task_id = ?
        ORDER BY created_at ASC, id ASC
      `).all(pt.id);

      const addComment = db.prepare(`
        INSERT INTO task_comments (task_id, user_id, content, mentions, created_at)
        VALUES (?, ?, ?, '[]', ?)
      `);

      if (remarks.length > 0) {
        for (const r of remarks) {
          const userLabel = r.user_name ? `${r.user_name} (${r.user_role || 'user'})` : 'User';
          const content = `[Priority Task Remark by ${userLabel}]:\n${r.remark}`;
          addComment.run(newTaskId, r.user_id || req?.user?.id || 1, content, r.created_at || new Date().toISOString());
        }
      } else if (pt.remarks && String(pt.remarks).trim()) {
        const content = `[Priority Task Note]:\n${pt.remarks.trim()}`;
        addComment.run(newTaskId, req?.user?.id || pt.created_by || 1, content, pt.created_at || new Date().toISOString());
      }
    } catch (e) {
      console.warn('Failed to copy remarks to comments during transfer:', e);
    }
  }

  // Update priority task record with transferred status
  db.prepare(`
    UPDATE priority_tasks
    SET transferred_to_task_id = ?, transferred_at = datetime('now','+6 hours'), updated_at = datetime('now','+6 hours')
    WHERE id = ?
  `).run(newTaskId, pt.id);

  if (req?.user) {
    audit(req, 'priority_task.transfer', 'priority_task', pt.id, `Transferred priority task "${pt.work_title}" to main tasks table as Task #${newTaskId}`);
    logHistory(newTaskId, req.user.id, 'task.create', 'title', 'Transferred from Priority Task #' + pt.id, pt.work_title);
  }

  return {
    priorityTaskId: pt.id,
    taskId: newTaskId,
    workTitle: pt.work_title,
    transferredAt: new Date().toISOString(),
  };
}

function normalizePriority(val) {
  const s = String(val || '').trim().toLowerCase();
  if (s.includes('crit')) return 'critical';
  if (s.includes('high') || s.includes('urg')) return 'high';
  if (s.includes('low')) return 'low';
  return 'medium';
}

function normalizeStatus(val) {
  const s = String(val || '').trim().toLowerCase();
  if (s.includes('done') || s.includes('comp') || s.includes('finish')) return 'done';
  if (s.includes('prog') || s.includes('work') || s.includes('ongo')) return 'in_progress';
  if (s.includes('rev')) return 'in_review';
  if (s.includes('canc') || s.includes('close') || s.includes('reject')) return 'cancelled';
  return 'todo';
}

function parseDate(val) {
  if (!val) return null;
  if (val instanceof Date && !isNaN(val.getTime())) {
    return val.toISOString().slice(0, 10);
  }
  if (typeof val === 'number') {
    // Excel date serial number
    const date = new Date(Math.round((val - 25569) * 86400 * 1000));
    if (!isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  const s = String(val).trim();
  if (!s) return null;
  // Match YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Match DD-MM-YYYY or DD/MM/YYYY
  const dm = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dm) {
    const [, d, m, y] = dm;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // Try standard Date.parse
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return s.slice(0, 20);
}

function findMatchingUser(rawName, users) {
  if (!rawName || typeof rawName !== 'string') return null;
  const clean = rawName.trim().toLowerCase();
  if (!clean) return null;

  // 1. Exact match on full name or email
  let match = users.find((u) => u.name.toLowerCase() === clean || u.email.toLowerCase() === clean);
  if (match) return match;

  // 2. Exact match ignoring punctuation/extra spaces
  const cleanAlpha = clean.replace(/[^a-z0-9]/g, '');
  match = users.find((u) => u.name.toLowerCase().replace(/[^a-z0-9]/g, '') === cleanAlpha);
  if (match) return match;

  // 3. User name contains raw name or vice versa (if length >= 3)
  if (clean.length >= 3) {
    match = users.find((u) => {
      const uName = u.name.toLowerCase();
      return uName.includes(clean) || clean.includes(uName);
    });
    if (match) return match;
  }

  // 4. Match on first or last name words
  const parts = clean.split(/\s+/).filter((p) => p.length >= 2);
  if (parts.length > 0) {
    match = users.find((u) => {
      const uParts = u.name.toLowerCase().split(/\s+/);
      return parts.some((p) => uParts.includes(p));
    });
    if (match) return match;
  }

  return null;
}

function getRemarksForTasks(taskIds) {
  if (!taskIds || taskIds.length === 0) return {};
  const placeholders = taskIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT
      r.id,
      r.priority_task_id,
      r.user_id,
      COALESCE(u.name, r.user_name, 'User') AS user_name,
      COALESCE(u.avatar, r.user_avatar, '') AS user_avatar,
      COALESCE(u.role, r.user_role, 'user') AS user_role,
      r.remark,
      r.created_at
    FROM priority_task_remarks r
    LEFT JOIN users u ON u.id = r.user_id
    WHERE r.priority_task_id IN (${placeholders})
    ORDER BY r.created_at ASC, r.id ASC
  `).all(...taskIds);

  const grouped = {};
  for (const r of rows) {
    if (!grouped[r.priority_task_id]) grouped[r.priority_task_id] = [];
    grouped[r.priority_task_id].push(r);
  }
  return grouped;
}

function attachRemarksToTask(task) {
  if (!task) return null;
  const grouped = getRemarksForTasks([task.id]);
  const list = grouped[task.id] || [];
  if (list.length === 0 && task.remarks && String(task.remarks).trim()) {
    return {
      ...task,
      remarks_list: [
        {
          id: 0,
          priority_task_id: task.id,
          user_id: task.created_by || null,
          user_name: task.creator_name || 'Initial Note',
          user_avatar: '',
          user_role: 'system',
          remark: task.remarks,
          created_at: task.created_at || new Date().toISOString(),
        }
      ]
    };
  }
  return { ...task, remarks_list: list };
}

function attachRemarksToTasks(tasks) {
  if (!tasks || tasks.length === 0) return [];
  const ids = tasks.map((t) => t.id);
  const grouped = getRemarksForTasks(ids);
  return tasks.map((task) => {
    const list = grouped[task.id] || [];
    if (list.length === 0 && task.remarks && String(task.remarks).trim()) {
      return {
        ...task,
        remarks_list: [
          {
            id: 0,
            priority_task_id: task.id,
            user_id: task.created_by || null,
            user_name: task.creator_name || 'Initial Note',
            user_avatar: '',
            user_role: 'system',
            remark: task.remarks,
            created_at: task.created_at || new Date().toISOString(),
          }
        ]
      };
    }
    return { ...task, remarks_list: list };
  });
}

function getCellRawValue(cell) {
  if (!cell || cell.value === null || cell.value === undefined) return '';
  const v = cell.value;
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (v.text !== undefined) return String(v.text).trim();
    if (v.result !== undefined && v.result !== null) return v.result;
    if (Array.isArray(v.richText)) {
      return v.richText.map((rt) => rt.text || '').join('').trim();
    }
  }
  return String(v).trim();
}

function getCellRawText(cell) {
  const v = getCellRawValue(cell);
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

function cleanHeader(val) {
  return String(val || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function matchHeaderColumn(clean) {
  if (!clean) return null;

  // 1. Serial Number / SL (Must be checked first)
  if (
    clean === 'sl' || clean === 'slno' || clean === 'sno' || clean === 'serial' ||
    clean === 'serialno' || clean === 'si' || clean === 'sino' || clean === 'no' ||
    clean === 'num' || clean === 'number' || clean === 'sn' || clean === 'id' ||
    clean === 'slnum' || clean === 'sr' || clean === 'srno'
  ) {
    return 'serial_no';
  }

  // 2. Description (Must check before work_title so 'workdescription' / 'taskdescription' becomes description)
  if (
    clean.includes('description') || clean.includes('desc') || clean.includes('detail') ||
    clean === 'summary' || clean === 'scope' || clean === 'specification' || clean === 'specs'
  ) {
    return 'description';
  }

  // 3. Priority
  if (
    clean.includes('prior') || clean.includes('urgenc') || clean.includes('severit') ||
    clean === 'prio' || clean === 'level' || clean === 'prioritylevel'
  ) {
    return 'priority';
  }

  // 4. Assignee / Responsible Person
  if (
    clean.includes('assign') || clean.includes('responsib') || clean === 'owner' ||
    clean === 'person' || clean === 'handler' || clean === 'lead' || clean === 'incharge' ||
    clean === 'assignedperson' || clean === 'responsibleperson' || clean === 'assigneename'
  ) {
    return 'assignee_name';
  }

  // 5. Status
  if (
    clean.includes('status') || clean === 'state' || clean === 'progress' ||
    clean === 'stage' || clean === 'completion' || clean === 'completionstatus' || clean === 'taskstatus'
  ) {
    return 'status';
  }

  // 6. Due Date
  if (
    clean.includes('due') || clean.includes('deadlin') || clean === 'targetdate' ||
    clean === 'enddate' || clean === 'completiondate' || clean === 'date' ||
    clean === 'target' || clean === 'deliverydate'
  ) {
    return 'due_date';
  }

  // 7. Remarks
  if (
    clean.includes('remark') || clean.includes('note') || clean.includes('comment') ||
    clean === 'feedback' || clean === 'observation' || clean === 'instruction' || clean === 'instructions'
  ) {
    return 'remarks';
  }

  // 8. Work Title
  if (
    clean.includes('worktitle') || clean.includes('tasktitle') || clean === 'title' ||
    clean === 'taskname' || clean === 'workname' || clean === 'itemname' ||
    clean === 'work' || clean === 'task' || clean === 'item' || clean === 'subject' ||
    clean === 'actionitem' || clean === 'particulars' || clean === 'activity' || clean === 'job'
  ) {
    return 'work_title';
  }

  return null;
}

// =============================================================================
// ROOT & NON-PARAMETERIZED ROUTES (MUST BE DEFINED BEFORE /:id ROUTES)
// =============================================================================

// POST batch transfer / backup priority tasks to main task table
router.post('/transfer', (req, res) => {
  const { ids, id, includeRemarks } = req.body || {};
  const targetIds = Array.isArray(ids)
    ? ids.map(Number).filter((n) => Number.isFinite(n) && n > 0)
    : (id ? [Number(id)] : []);

  if (targetIds.length === 0) {
    return res.status(400).json({ error: 'Please specify at least one priority task ID to transfer' });
  }

  const placeholders = targetIds.map(() => '?').join(',');
  const query = `
    SELECT
      pt.*,
      u.name AS assignee_user_name,
      u.email AS assignee_user_email,
      u.avatar AS assignee_user_avatar,
      c.name AS creator_name
    FROM priority_tasks pt
    LEFT JOIN users u ON u.id = pt.assignee_user_id
    LEFT JOIN users c ON c.id = pt.created_by
    WHERE pt.id IN (${placeholders})
  `;

  const tasksToTransfer = db.prepare(query).all(...targetIds);
  if (tasksToTransfer.length === 0) {
    return res.status(404).json({ error: 'No matching priority tasks found' });
  }

  const results = [];
  db.exec('BEGIN');
  try {
    for (const pt of tasksToTransfer) {
      const resData = transferPriorityTaskToMainTask(pt, req, { includeRemarks });
      results.push(resData);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    console.error('Transfer priority tasks error:', err);
    return res.status(500).json({ error: 'Failed to transfer priority tasks: ' });
  }

  audit(req, 'priority_task.batch_transfer', 'priority_task', null, `Transferred ${results.length} priority tasks to main tasks table`);

  res.json({
    ok: true,
    count: results.length,
    results,
  });
});

// GET all priority tasks
router.get('/', (req, res) => {
  const { search, priority, status, assignee, sort, order } = req.query;
  const where = [];
  const params = [];

  if (search && String(search).trim()) {
    const q = `%${String(search).trim()}%`;
    where.push('(pt.work_title LIKE ? OR pt.description LIKE ? OR pt.assignee_name LIKE ? OR pt.remarks LIKE ? OR u.name LIKE ?)');
    params.push(q, q, q, q, q);
  }

  if (priority && priority !== 'all') {
    where.push('pt.priority = ?');
    params.push(priority);
  }

  if (status && status !== 'all') {
    where.push('pt.status = ?');
    params.push(status);
  }

  if (assignee && assignee !== 'all') {
    if (assignee === 'unassigned') {
      where.push('(pt.assignee_user_id IS NULL AND (pt.assignee_name IS NULL OR pt.assignee_name = \'\'))');
    } else if (assignee === 'unmatched') {
      where.push('(pt.assignee_user_id IS NULL AND pt.assignee_name IS NOT NULL AND pt.assignee_name != \'\')');
    } else if (!isNaN(Number(assignee))) {
      where.push('pt.assignee_user_id = ?');
      params.push(Number(assignee));
    } else {
      where.push('(pt.assignee_name LIKE ? OR u.name LIKE ?)');
      params.push(`%${assignee}%`, `%${assignee}%`);
    }
  }

  let orderBy = 'CASE pt.priority WHEN \'critical\' THEN 1 WHEN \'high\' THEN 2 WHEN \'medium\' THEN 3 WHEN \'low\' THEN 4 ELSE 5 END, pt.created_at DESC';
  if (sort === 'due_date') {
    orderBy = `pt.due_date ${order === 'desc' ? 'DESC' : 'ASC'} NULLS LAST`;
  } else if (sort === 'priority') {
    orderBy = `CASE pt.priority WHEN \'critical\' THEN 1 WHEN \'high\' THEN 2 WHEN \'medium\' THEN 3 WHEN \'low\' THEN 4 ELSE 5 END ${order === 'desc' ? 'DESC' : 'ASC'}`;
  } else if (sort === 'status') {
    orderBy = `pt.status ${order === 'desc' ? 'DESC' : 'ASC'}`;
  } else if (sort === 'work_title') {
    orderBy = `pt.work_title ${order === 'desc' ? 'DESC' : 'ASC'}`;
  } else if (sort === 'created_at') {
    orderBy = `pt.created_at ${order === 'asc' ? 'ASC' : 'DESC'}`;
  }

  const query = `
    SELECT
      pt.*,
      u.name AS assignee_user_name,
      u.email AS assignee_user_email,
      u.avatar AS assignee_user_avatar,
      u.title AS assignee_user_title,
      u.role AS assignee_user_role,
      c.name AS creator_name
    FROM priority_tasks pt
    LEFT JOIN users u ON u.id = pt.assignee_user_id
    LEFT JOIN users c ON c.id = pt.created_by
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ${orderBy}
  `;

  try {
    const tasks = db.prepare(query).all(...params);
    res.json(attachRemarksToTasks(tasks));
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch priority tasks: ' });
  }
});

// GET download Excel or CSV template
router.get('/template', async (req, res) => {
  const format = String(req.query.format || 'xlsx').toLowerCase();
  const isBlank = req.query.blank === 'true' || req.query.blank === '1';

  const sampleData = isBlank ? [] : [
    {
      sl: 1,
      work_title: 'Core System Security Upgrade',
      description: 'Patch critical CVEs and upgrade authentication tokens',
      priority: 'Critical',
      assignee_name: 'Sarah Chen',
      status: 'In Progress',
      due_date: '2026-08-25',
      remarks: 'Requires immediate DevOps approval',
    },
    {
      sl: 2,
      work_title: 'Database Performance Optimization',
      description: 'Analyze slow query logs and add composite indexes',
      priority: 'High',
      assignee_name: 'Emily Watson',
      status: 'To Do',
      due_date: '2026-08-28',
      remarks: 'Target 50% query time reduction',
    },
    {
      sl: 3,
      work_title: 'Q3 Financial Audit Compliance',
      description: 'Prepare reconciliation reports for internal review',
      priority: 'High',
      assignee_name: 'David Park',
      status: 'In Review',
      due_date: '2026-08-30',
      remarks: 'Draft submitted to leadership',
    },
    {
      sl: 4,
      work_title: 'Client Portal UI Polish',
      description: 'Refine responsive layouts and contrast ratios',
      priority: 'Medium',
      assignee_name: 'Ava Wilson',
      status: 'Done',
      due_date: '2026-08-20',
      remarks: 'Completed and deployed to staging',
    },
  ];

  if (format === 'csv') {
    try {
      const headers = ['SL', 'Work Title', 'Description', 'Priority', 'Assignee', 'Status', 'Due Date', 'Remarks'];
      const rows = sampleData.map((d) => [
        d.sl,
        `"${String(d.work_title).replace(/"/g, '""')}"`,
        `"${String(d.description).replace(/"/g, '""')}"`,
        `"${d.priority}"`,
        `"${String(d.assignee_name).replace(/"/g, '""')}"`,
        `"${d.status}"`,
        `"${d.due_date}"`,
        `"${String(d.remarks).replace(/"/g, '""')}"`,
      ]);

      const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
      const filename = isBlank ? 'Priority_Tasks_Blank_Template.csv' : 'Priority_Tasks_Template.csv';
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
      return res.send(csvContent);
    } catch (e) {
      return res.status(500).json({ error: 'Failed to generate CSV template: ' });
    }
  }

  try {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'PDCL ICT Priority System';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Priority Tasks', {
      views: [{ state: 'frozen', ySplit: 1 }]
    });

    worksheet.columns = [
      { header: 'SL', key: 'sl', width: 8 },
      { header: 'Work Title', key: 'work_title', width: 36 },
      { header: 'Description', key: 'description', width: 42 },
      { header: 'Priority', key: 'priority', width: 16 },
      { header: 'Assignee', key: 'assignee_name', width: 26 },
      { header: 'Status', key: 'status', width: 18 },
      { header: 'Due Date', key: 'due_date', width: 16 },
      { header: 'Remarks', key: 'remarks', width: 34 },
    ];

    // Style header row
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Calibri' };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4338CA' }, // Indigo brand color
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    headerRow.height = 28;

    // Add border to header cells
    headerRow.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF312E81' } },
        left: { style: 'thin', color: { argb: 'FF312E81' } },
        bottom: { style: 'medium', color: { argb: 'FF312E81' } },
        right: { style: 'thin', color: { argb: 'FF312E81' } },
      };
    });

    // Add sample rows (or blank guide rows if blank template)
    if (sampleData.length > 0) {
      for (const row of sampleData) {
        const addedRow = worksheet.addRow(row);
        addedRow.alignment = { vertical: 'middle', horizontal: 'left' };
        addedRow.height = 22;
        addedRow.font = { size: 10, name: 'Calibri' };
        addedRow.eachCell((cell) => {
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          };
        });
      }
    } else {
      // Add empty pre-formatted rows so user can start typing immediately
      for (let i = 1; i <= 10; i++) {
        const addedRow = worksheet.addRow({ sl: i, work_title: '', description: '', priority: 'Medium', assignee_name: '', status: 'To Do', due_date: '', remarks: '' });
        addedRow.alignment = { vertical: 'middle', horizontal: 'left' };
        addedRow.height = 20;
        addedRow.font = { size: 10, name: 'Calibri' };
        addedRow.eachCell((cell) => {
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          };
        });
      }
    }

    // Add data validations for Priority and Status columns (rows 2 to 500)
    for (let r = 2; r <= 200; r++) {
      worksheet.getCell(`D${r}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"Critical,High,Medium,Low"'],
      };
      worksheet.getCell(`F${r}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"To Do,In Progress,In Review,Done,Cancelled"'],
      };
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = isBlank ? 'Priority_Tasks_Blank_Template.xlsx' : 'Priority_Tasks_Template.xlsx';

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.setHeader('Content-Length', buffer.byteLength);

    return res.send(Buffer.from(buffer));
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: 'Failed to generate template: ' });
  }
});

// GET export current priority tasks to Excel or CSV
router.get('/export/file', async (req, res) => {
  const format = String(req.query.format || 'xlsx').toLowerCase();

  try {
    const tasks = db.prepare(`
      SELECT
        pt.*,
        u.name AS assignee_user_name,
        u.email AS assignee_user_email
      FROM priority_tasks pt
      LEFT JOIN users u ON u.id = pt.assignee_user_id
      ORDER BY CASE pt.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END, pt.created_at DESC
    `).all();

    const taskIds = tasks.map((t) => t.id);
    const remarksGrouped = getRemarksForTasks(taskIds);

    if (format === 'csv') {
      const headers = ['SL', 'Work Title', 'Description', 'Priority', 'Assignee', 'Status', 'Due Date', 'Remarks', 'Created At', 'Updated At'];
      let index = 1;
      const rows = tasks.map((t) => {
        const taskRemarks = remarksGrouped[t.id] || [];
        let formattedRemarks = t.remarks || '';
        if (taskRemarks.length > 0) {
          formattedRemarks = taskRemarks
            .map((r, i) => {
              const timeStr = r.created_at ? r.created_at.slice(0, 16).replace('T', ' ') : '';
              return `${i + 1}. [${timeStr}] ${r.user_name || 'User'}: ${r.remark}`;
            })
            .join('; ');
        }
        return [
          index++,
          `"${String(t.work_title || '').replace(/"/g, '""')}"`,
          `"${String(t.description || '').replace(/"/g, '""')}"`,
          `"${t.priority || ''}"`,
          `"${String(t.assignee_user_name || t.assignee_name || 'Unassigned').replace(/"/g, '""')}"`,
          `"${t.status || ''}"`,
          `"${t.due_date || ''}"`,
          `"${String(formattedRemarks).replace(/"/g, '""')}"`,
          `"${t.created_at || ''}"`,
          `"${t.updated_at || ''}"`,
        ];
      });

      const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="Priority_Tasks_${new Date().toISOString().slice(0, 10)}.csv"`);
      return res.send(csvContent);
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'PDCL ICT';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Priority Tasks');

    worksheet.columns = [
      { header: 'SL', key: 'sl', width: 8 },
      { header: 'Task ID', key: 'task_code', width: 18 },
      { header: 'Work Title', key: 'work_title', width: 34 },
      { header: 'Description', key: 'description', width: 38 },
      { header: 'Priority', key: 'priority', width: 14 },
      { header: 'Assignee', key: 'assignee', width: 24 },
      { header: 'Status', key: 'status', width: 16 },
      { header: 'Due Date', key: 'due_date', width: 16 },
      { header: 'Remarks', key: 'remarks', width: 32 },
      { header: 'Created At', key: 'created_at', width: 20 },
      { header: 'Updated At', key: 'updated_at', width: 20 },
    ];

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E293B' },
    };
    headerRow.height = 26;

    let index = 1;
    for (const t of tasks) {
      const taskRemarks = remarksGrouped[t.id] || [];
      let formattedRemarks = t.remarks || '';
      if (taskRemarks.length > 0) {
        formattedRemarks = taskRemarks
          .map((r, i) => {
            const timeStr = r.created_at ? r.created_at.slice(0, 16).replace('T', ' ') : '';
            return `${i + 1}. [${timeStr}] ${r.user_name || 'User'}: ${r.remark}`;
          })
          .join('\n');
      }

      worksheet.addRow({
        sl: index++,
        task_code: formatTaskCode(t.task_code, t.id),
        work_title: t.work_title,
        description: t.description || '',
        priority: t.priority ? t.priority.charAt(0).toUpperCase() + t.priority.slice(1) : '',
        assignee: t.assignee_user_name || t.assignee_name || 'Unassigned',
        status: t.status ? t.status.replace('_', ' ').toUpperCase() : '',
        due_date: t.due_date || '',
        remarks: formattedRemarks,
        created_at: t.created_at || '',
        updated_at: t.updated_at || '',
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Priority_Tasks_${new Date().toISOString().slice(0, 10)}.xlsx"`);
    res.setHeader('Content-Length', buffer.byteLength);

    return res.send(Buffer.from(buffer));
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: 'Failed to export priority tasks: ' });
  }
});

// POST upload Excel file
router.post('/upload', requirePermission('priority_tasks.manage'), upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Please upload an Excel file (.xlsx, .xls, or .csv)' });
  }

  const replace = req.body.replace === 'true' || req.body.replace === '1' || req.body.replace === true;
  const backupToMain = req.body.backup_to_main === 'true' || req.body.backup_to_main === '1' || req.body.backup_to_main === true;

  try {
    const workbook = new ExcelJS.Workbook();
    const isCsv = (req.file.originalname || '').toLowerCase().endsWith('.csv');

    if (isCsv) {
      const { Readable } = await import('node:stream');
      const stream = Readable.from(req.file.buffer);
      await workbook.csv.read(stream);
    } else {
      await workbook.xlsx.load(req.file.buffer);
    }

    const worksheet = workbook.worksheets[0];
    if (!worksheet || worksheet.rowCount === 0) {
      return res.status(400).json({ error: 'The uploaded file is empty' });
    }

    // Identify header row by scoring rows 1 to 15
    let headerRowIndex = 1;
    let colMap = {};
    let bestScore = -1;

    for (let r = 1; r <= Math.min(15, worksheet.rowCount); r++) {
      const row = worksheet.getRow(r);
      const rowMap = {};
      let recognizedCount = 0;
      let hasSerial = false;
      let hasTitle = false;
      let hasDesc = false;

      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const text = getCellRawText(cell);
        const clean = cleanHeader(text);
        const matched = matchHeaderColumn(clean);
        if (matched && !rowMap[matched]) {
          rowMap[matched] = colNumber;
          recognizedCount++;
          if (matched === 'serial_no') hasSerial = true;
          if (matched === 'work_title') hasTitle = true;
          if (matched === 'description') hasDesc = true;
        }
      });

      let score = recognizedCount;
      if (hasTitle && (hasDesc || recognizedCount >= 2)) score += 5;
      if (hasSerial && (hasTitle || recognizedCount >= 2)) score += 3;

      if (score > bestScore && recognizedCount >= 2) {
        bestScore = score;
        headerRowIndex = r;
        colMap = rowMap;
      }
    }

    // If headers were not recognized with sufficient confidence (score < 2)
    if (bestScore < 2 || !colMap.work_title) {
      // Check if Row 1 or 2 has a serial number column at Col 1
      const sampleRow = worksheet.getRow(headerRowIndex <= worksheet.rowCount ? headerRowIndex : 1);
      const cell1Text = getCellRawText(sampleRow.getCell(1));
      const cell1Clean = cleanHeader(cell1Text);
      const cell1IsSerial =
        cell1Clean === 'sl' ||
        cell1Clean === 'slno' ||
        cell1Clean === 'serial' ||
        cell1Clean === 'no' ||
        cell1Clean === 'id' ||
        !isNaN(Number(cell1Text));

      if (cell1IsSerial) {
        // Col 1 is Serial No, so Work Title starts at Col 2
        colMap = {
          serial_no: 1,
          work_title: colMap.work_title || 2,
          description: colMap.description || 3,
          priority: colMap.priority || 4,
          assignee_name: colMap.assignee_name || 5,
          status: colMap.status || 6,
          due_date: colMap.due_date || 7,
          remarks: colMap.remarks || 8,
        };
      } else {
        // Col 1 is Work Title directly
        colMap = {
          work_title: 1,
          description: colMap.description || 2,
          priority: colMap.priority || 3,
          assignee_name: colMap.assignee_name || 4,
          status: colMap.status || 5,
          due_date: colMap.due_date || 6,
          remarks: colMap.remarks || 7,
        };
      }
    } else {
      // If work_title was mapped, but we also found serial_no:
      // Make sure work_title is NOT mapped to the serial_no column!
      if (colMap.serial_no && colMap.work_title === colMap.serial_no) {
        colMap.work_title = colMap.serial_no + 1;
      }
    }

    // =========================================================================
    // POST-HEADER VALIDATION GUARD: Check first few data rows for Serial No shift
    // =========================================================================
    let numericTitleCount = 0;
    let nextColHasTextCount = 0;
    let sampledRowCount = 0;

    for (let r = headerRowIndex + 1; r <= Math.min(headerRowIndex + 8, worksheet.rowCount); r++) {
      const row = worksheet.getRow(r);
      const titleColVal = colMap.work_title ? getCellRawValue(row.getCell(colMap.work_title)) : '';
      const titleColText = getCellRawText(row.getCell(colMap.work_title));
      if (!titleColText) continue;

      sampledRowCount++;
      // Is title column a pure sequential number (1, 2, 3...) or small digit?
      if (typeof titleColVal === 'number' || /^\d{1,4}$/.test(titleColText.trim())) {
        numericTitleCount++;
      }

      // Does the next column contain meaningful text?
      const nextColText = colMap.work_title ? getCellRawText(row.getCell(colMap.work_title + 1)) : '';
      if (nextColText && nextColText.length > 2 && isNaN(Number(nextColText))) {
        nextColHasTextCount++;
      }
    }

    // If title column contains numbers and next column contains text -> 100% column shift detected!
    if (sampledRowCount >= 1 && numericTitleCount >= Math.ceil(sampledRowCount / 2) && nextColHasTextCount >= 1) {
      colMap.serial_no = colMap.work_title;
      colMap.work_title = colMap.serial_no + 1;
      colMap.description = colMap.work_title + 1;
      colMap.priority = colMap.description + 1;
      colMap.assignee_name = colMap.priority + 1;
      colMap.status = colMap.assignee_name + 1;
      colMap.due_date = colMap.status + 1;
      colMap.remarks = colMap.due_date + 1;
    }

    const allUsers = db.prepare('SELECT id, name, email FROM users WHERE is_active = 1').all();
    const rowsToInsert = [];
    let matchedCount = 0;
    let unmatchedCount = 0;
    const matchedUsersMap = new Set();
    const unmatchedNamesMap = new Set();

    for (let r = headerRowIndex + 1; r <= worksheet.rowCount; r++) {
      const row = worksheet.getRow(r);
      const titleText = colMap.work_title ? getCellRawText(row.getCell(colMap.work_title)) : '';
      if (!titleText) continue; // skip empty rows

      // Skip if this row is a duplicate header row
      if (
        cleanHeader(titleText) === 'worktitle' ||
        cleanHeader(titleText) === 'title' ||
        (cleanHeader(titleText) === 'work' && cleanHeader(getCellRawText(row.getCell(colMap.description || 0))) === 'description')
      ) {
        continue;
      }

      const descText = colMap.description ? getCellRawText(row.getCell(colMap.description)) : '';
      const rawPriority = colMap.priority ? getCellRawValue(row.getCell(colMap.priority)) : '';
      const priorityText = normalizePriority(rawPriority);

      const rawAssignee = colMap.assignee_name ? getCellRawText(row.getCell(colMap.assignee_name)) : '';
      const assigneeText = rawAssignee ? rawAssignee.trim() : '';

      const rawStatus = colMap.status ? getCellRawValue(row.getCell(colMap.status)) : '';
      const statusText = normalizeStatus(rawStatus);

      const rawDue = colMap.due_date ? getCellRawValue(row.getCell(colMap.due_date)) : null;
      const dueDate = parseDate(rawDue);

      const rawRemarks = colMap.remarks ? getCellRawText(row.getCell(colMap.remarks)) : '';
      const remarksText = rawRemarks ? rawRemarks.trim() : '';

      let matchedUser = null;
      if (assigneeText) {
        matchedUser = findMatchingUser(assigneeText, allUsers);
        if (matchedUser) {
          matchedCount++;
          matchedUsersMap.add(matchedUser.name);
        } else {
          unmatchedCount++;
          unmatchedNamesMap.add(assigneeText);
        }
      }

      rowsToInsert.push({
        work_title: titleText,
        description: descText,
        priority: priorityText,
        assignee_name: matchedUser ? matchedUser.name : assigneeText,
        assignee_user_id: matchedUser ? matchedUser.id : null,
        status: statusText,
        due_date: dueDate,
        remarks: remarksText,
      });
    }

    if (rowsToInsert.length === 0) {
      return res.status(400).json({ error: 'No valid data rows found in the Excel file' });
    }

    // Execute in transaction
    db.exec('BEGIN');
    try {
      if (replace) {
        db.prepare('DELETE FROM priority_tasks').run();
      }

      const insertStmt = db.prepare(`
        INSERT INTO priority_tasks (
          work_title, description, priority, assignee_name, assignee_user_id,
          status, due_date, remarks, created_by, task_code, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','+6 hours'), datetime('now','+6 hours'))
      `);

      for (const row of rowsToInsert) {
        const result = insertStmt.run(
          row.work_title,
          row.description,
          row.priority,
          row.assignee_name,
          row.assignee_user_id,
          row.status,
          row.due_date,
          row.remarks,
          req.user.id,
          generateTaskCode('PTY'),
        );

        const newTaskId = Number(result.lastInsertRowid);
        if (row.remarks && String(row.remarks).trim()) {
          db.prepare(`
            INSERT INTO priority_task_remarks (
              priority_task_id, user_id, user_name, user_avatar, user_role, remark, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, datetime('now','+6 hours'))
          `).run(newTaskId, req.user.id, req.user.name || 'Excel Import', '', req.user.role || 'admin', row.remarks.trim());
        }

        if (backupToMain) {
          transferPriorityTaskToMainTask(
            {
              id: newTaskId,
              work_title: row.work_title,
              description: row.description,
              priority: row.priority,
              assignee_name: row.assignee_name,
              assignee_user_id: row.assignee_user_id,
              status: row.status,
              due_date: row.due_date,
              remarks: row.remarks,
              created_by: req.user.id,
            },
            req,
            { includeRemarks: true }
          );
        }
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    audit(req, 'priority_task.excel_upload', 'priority_task', null, `Uploaded ${rowsToInsert.length} items (replace=${replace})`);

    res.json({
      success: true,
      count: rowsToInsert.length,
      matchedCount,
      unmatchedCount,
      matchedUsers: Array.from(matchedUsersMap),
      unmatchedNames: Array.from(unmatchedNamesMap),
      replaced: replace,
    });
  } catch (e) {
    console.error('Excel upload error:', e);
    res.status(500).json({ error: 'Failed to process Excel file: ' });
  }
});

// DELETE all priority tasks
router.delete('/', requirePermission('priority_tasks.manage'), (req, res) => {
  const count = db.prepare('SELECT COUNT(*) AS c FROM priority_tasks').get().c;
  db.prepare('DELETE FROM priority_tasks').run();
  audit(req, 'priority_task.delete_all', 'priority_task', null, `Deleted all ${count} priority tasks`);
  res.json({ ok: true, deleted: count });
});

// POST create single priority task
router.post('/', requirePermission('priority_tasks.manage'), (req, res) => {
  const { work_title, description, priority, assignee_name, assignee_user_id, status, due_date, remarks, backup_to_main, transfer_to_main } = req.body;
  if (!work_title || !String(work_title).trim()) {
    return res.status(400).json({ error: 'Work Title is required' });
  }

  let finalUserId = assignee_user_id ? Number(assignee_user_id) : null;
  let finalAssigneeName = String(assignee_name || '').trim();

  const allUsers = db.prepare('SELECT id, name, email FROM users WHERE is_active = 1').all();
  if (!finalUserId && finalAssigneeName) {
    const matched = findMatchingUser(finalAssigneeName, allUsers);
    if (matched) {
      finalUserId = matched.id;
      finalAssigneeName = matched.name;
    }
  } else if (finalUserId) {
    const matched = allUsers.find((u) => u.id === finalUserId);
    if (matched) finalAssigneeName = matched.name;
  }

  // Check if assignee is available (not on leave or weekend)
  if (finalUserId) {
    const availability = checkUserAvailability(finalUserId, today());
    if (!availability.available) {
      return res.status(400).json({ error: availability.reason });
    }
  }

  const stmt = db.prepare(`
    INSERT INTO priority_tasks (
      work_title, description, priority, assignee_name, assignee_user_id,
      status, due_date, remarks, created_by, task_code, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','+6 hours'), datetime('now','+6 hours'))
  `);

  try {
    const cleanRemarks = String(remarks || '').trim();
    const result = stmt.run(
      String(work_title).trim(),
      String(description || '').trim(),
      normalizePriority(priority),
      finalAssigneeName,
      finalUserId,
      normalizeStatus(status),
      parseDate(due_date),
      cleanRemarks,
      req.user.id,
      generateTaskCode('PTY'),
    );

    const newId = Number(result.lastInsertRowid);

    if (cleanRemarks) {
      db.prepare(`
        INSERT INTO priority_task_remarks (priority_task_id, user_id, user_name, user_avatar, user_role, remark, created_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now','+6 hours'))
      `).run(newId, req.user.id, req.user.name || 'Admin', req.user.avatar || '', req.user.role || 'admin', cleanRemarks);
    }

    let inserted = db.prepare(`
      SELECT
        pt.*,
        u.name AS assignee_user_name,
        u.email AS assignee_user_email,
        u.avatar AS assignee_user_avatar,
        u.title AS assignee_user_title,
        c.name AS creator_name
      FROM priority_tasks pt
      LEFT JOIN users u ON u.id = pt.assignee_user_id
      LEFT JOIN users c ON c.id = pt.created_by
      WHERE pt.id = ?
    `).get(newId);

    if (backup_to_main || transfer_to_main) {
      transferPriorityTaskToMainTask(inserted, req, { includeRemarks: true });
      inserted = db.prepare(`
        SELECT
          pt.*,
          u.name AS assignee_user_name,
          u.email AS assignee_user_email,
          u.avatar AS assignee_user_avatar,
          u.title AS assignee_user_title,
          c.name AS creator_name
        FROM priority_tasks pt
        LEFT JOIN users u ON u.id = pt.assignee_user_id
        LEFT JOIN users c ON c.id = pt.created_by
        WHERE pt.id = ?
      `).get(newId);
    }

    audit(req, 'priority_task.create', 'priority_task', inserted.id, `Created priority task: ${inserted.work_title}`);
    res.status(201).json(attachRemarksToTask(inserted));
  } catch (e) {
    res.status(500).json({ error: 'Failed to create priority task: ' });
  }
});

// =============================================================================
// PARAMETERIZED ROUTES (/:id)
// =============================================================================

// GET single priority task
router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!id || isNaN(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid priority task ID' });
  }

  const task = db.prepare(`
    SELECT
      pt.*,
      u.name AS assignee_user_name,
      u.email AS assignee_user_email,
      u.avatar AS assignee_user_avatar,
      u.title AS assignee_user_title,
      u.role AS assignee_user_role,
      c.name AS creator_name
    FROM priority_tasks pt
    LEFT JOIN users u ON u.id = pt.assignee_user_id
    LEFT JOIN users c ON c.id = pt.created_by
    WHERE pt.id = ?
  `).get(id);

  if (!task) return res.status(404).json({ error: 'Priority task not found' });
  res.json(attachRemarksToTask(task));
});

// GET all remarks for a priority task
router.get('/:id/remarks', (req, res) => {
  const id = Number(req.params.id);
  if (!id || isNaN(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid priority task ID' });
  }

  const task = db.prepare('SELECT id, remarks, created_at, created_by FROM priority_tasks WHERE id = ?').get(id);
  if (!task) return res.status(404).json({ error: 'Priority task not found' });

  const remarks = db.prepare(`
    SELECT
      r.id,
      r.priority_task_id,
      r.user_id,
      COALESCE(u.name, r.user_name, 'User') AS user_name,
      COALESCE(u.avatar, r.user_avatar, '') AS user_avatar,
      COALESCE(u.role, r.user_role, 'user') AS user_role,
      r.remark,
      r.created_at
    FROM priority_task_remarks r
    LEFT JOIN users u ON u.id = r.user_id
    WHERE r.priority_task_id = ?
    ORDER BY r.created_at ASC, r.id ASC
  `).all(id);

  if (remarks.length === 0 && task.remarks && String(task.remarks).trim()) {
    return res.json([
      {
        id: 0,
        priority_task_id: task.id,
        user_id: task.created_by || null,
        user_name: 'Initial Note',
        user_avatar: '',
        user_role: 'system',
        remark: task.remarks,
        created_at: task.created_at || new Date().toISOString(),
      }
    ]);
  }

  res.json(remarks);
});

// POST add a new remark to a priority task
router.post('/:id/remarks', (req, res) => {
  const id = Number(req.params.id);
  if (!id || isNaN(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid priority task ID' });
  }

  const { remark, status } = req.body;
  if (!remark || !String(remark).trim()) {
    return res.status(400).json({ error: 'Remark text cannot be empty' });
  }

  const existing = db.prepare('SELECT * FROM priority_tasks WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Priority task not found' });

  const cleanRemark = String(remark).trim();
  const userName = req.user.name || 'User';
  const userAvatar = req.user.avatar || '';
  const userRole = req.user.role || 'user';

  db.prepare(`
    INSERT INTO priority_task_remarks (
      priority_task_id, user_id, user_name, user_avatar, user_role, remark, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, datetime('now','+6 hours'))
  `).run(id, req.user.id, userName, userAvatar, userRole, cleanRemark);

  let finalStatus = existing.status;
  if (status) {
    finalStatus = normalizeStatus(status);
  }

  db.prepare(`
    UPDATE priority_tasks
    SET status = ?, remarks = ?, updated_at = datetime('now','+6 hours')
    WHERE id = ?
  `).run(finalStatus, cleanRemark, id);

  const updatedTask = db.prepare(`
    SELECT
      pt.*,
      u.name AS assignee_user_name,
      u.email AS assignee_user_email,
      u.avatar AS assignee_user_avatar,
      u.title AS assignee_user_title,
      u.role AS assignee_user_role,
      c.name AS creator_name
    FROM priority_tasks pt
    LEFT JOIN users u ON u.id = pt.assignee_user_id
    LEFT JOIN users c ON c.id = pt.created_by
    WHERE pt.id = ?
  `).get(id);

  audit(req, 'priority_task.remark', 'priority_task', id, `Added remark: "${cleanRemark.slice(0, 40)}"`);
  res.json(attachRemarksToTask(updatedTask));
});

// DELETE single remark from a priority task
router.delete('/:id/remarks/:remarkId', (req, res) => {
  const taskId = Number(req.params.id);
  const remarkId = Number(req.params.remarkId);
  if (!taskId || isNaN(taskId) || !remarkId || isNaN(remarkId)) {
    return res.status(400).json({ error: 'Invalid ID' });
  }

  const admin = isAdmin(req.user);
  const remark = db.prepare('SELECT * FROM priority_task_remarks WHERE id = ? AND priority_task_id = ?').get(remarkId, taskId);
  if (!remark) return res.status(404).json({ error: 'Remark not found' });

  if (!admin && remark.user_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only delete your own remarks' });
  }

  db.prepare('DELETE FROM priority_task_remarks WHERE id = ?').run(remarkId);

  const latest = db.prepare('SELECT remark FROM priority_task_remarks WHERE priority_task_id = ? ORDER BY created_at DESC, id DESC LIMIT 1').get(taskId);
  db.prepare('UPDATE priority_tasks SET remarks = ? WHERE id = ?').run(latest ? latest.remark : '', taskId);

  const updatedTask = db.prepare(`
    SELECT
      pt.*,
      u.name AS assignee_user_name,
      u.email AS assignee_user_email,
      u.avatar AS assignee_user_avatar,
      u.title AS assignee_user_title,
      u.role AS assignee_user_role,
      c.name AS creator_name
    FROM priority_tasks pt
    LEFT JOIN users u ON u.id = pt.assignee_user_id
    LEFT JOIN users c ON c.id = pt.created_by
    WHERE pt.id = ?
  `).get(taskId);

  res.json(attachRemarksToTask(updatedTask));
});

// PATCH update status and/or remarks (All logged-in users for tracking)
router.patch('/:id/status', (req, res) => {
  const id = Number(req.params.id);
  if (!id || isNaN(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid priority task ID' });
  }

  const { status, remarks } = req.body;
  if (!status && remarks === undefined) return res.status(400).json({ error: 'Status or Remarks is required' });

  const existing = db.prepare('SELECT * FROM priority_tasks WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Priority task not found' });

  const normalized = status ? normalizeStatus(status) : existing.status;
  
  if (remarks !== undefined && String(remarks).trim()) {
    const cleanRemarks = String(remarks).trim();
    db.prepare(`
      INSERT INTO priority_task_remarks (
        priority_task_id, user_id, user_name, user_avatar, user_role, remark, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, datetime('now','+6 hours'))
    `).run(id, req.user.id, req.user.name || 'User', req.user.avatar || '', req.user.role || 'user', cleanRemarks);

    db.prepare(`
      UPDATE priority_tasks
      SET status = ?, remarks = ?, updated_at = datetime('now','+6 hours')
      WHERE id = ?
    `).run(normalized, cleanRemarks, id);
  } else {
    db.prepare(`
      UPDATE priority_tasks
      SET status = ?, updated_at = datetime('now','+6 hours')
      WHERE id = ?
    `).run(normalized, id);
  }

  const updated = db.prepare(`
    SELECT
      pt.*,
      u.name AS assignee_user_name,
      u.email AS assignee_user_email,
      u.avatar AS assignee_user_avatar,
      u.title AS assignee_user_title,
      u.role AS assignee_user_role,
      c.name AS creator_name
    FROM priority_tasks pt
    LEFT JOIN users u ON u.id = pt.assignee_user_id
    LEFT JOIN users c ON c.id = pt.created_by
    WHERE pt.id = ?
  `).get(id);

  audit(req, 'priority_task.status_update', 'priority_task', id, `Updated tracking: status=${normalized}${remarks ? ', new remark added' : ''}`);
  res.json(attachRemarksToTask(updated));
});

// PATCH update remarks only (All logged-in users for tracking/notes)
router.patch('/:id/remarks', (req, res) => {
  const id = Number(req.params.id);
  if (!id || isNaN(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid priority task ID' });
  }

  const { remarks } = req.body;
  if (remarks === undefined) return res.status(400).json({ error: 'Remarks is required' });

  const existing = db.prepare('SELECT * FROM priority_tasks WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Priority task not found' });

  const cleanRemarks = String(remarks || '').trim();
  if (cleanRemarks) {
    db.prepare(`
      INSERT INTO priority_task_remarks (
        priority_task_id, user_id, user_name, user_avatar, user_role, remark, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, datetime('now','+6 hours'))
    `).run(id, req.user.id, req.user.name || 'User', req.user.avatar || '', req.user.role || 'user', cleanRemarks);

    db.prepare(`
      UPDATE priority_tasks
      SET remarks = ?, updated_at = datetime('now','+6 hours')
      WHERE id = ?
    `).run(cleanRemarks, id);
  }

  const updated = db.prepare(`
    SELECT
      pt.*,
      u.name AS assignee_user_name,
      u.email AS assignee_user_email,
      u.avatar AS assignee_user_avatar,
      u.title AS assignee_user_title,
      u.role AS assignee_user_role,
      c.name AS creator_name
    FROM priority_tasks pt
    LEFT JOIN users u ON u.id = pt.assignee_user_id
    LEFT JOIN users c ON c.id = pt.created_by
    WHERE pt.id = ?
  `).get(id);

  audit(req, 'priority_task.remarks_update', 'priority_task', id, `Added remark for priority task: ${updated.work_title}`);
  res.json(attachRemarksToTask(updated));
});

// PUT update full priority task (Admin for all fields, regular users restricted to status and remarks)
router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!id || isNaN(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid priority task ID' });
  }

  const existing = db.prepare('SELECT * FROM priority_tasks WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Priority task not found' });

  const admin = isAdmin(req.user);

  if (!admin) {
    // Regular users can update status and remarks (optional)
    const status = req.body.status ? normalizeStatus(req.body.status) : existing.status;
    const remarks = req.body.remarks !== undefined ? String(req.body.remarks || '').trim() : '';
    
    if (remarks) {
      db.prepare(`
        INSERT INTO priority_task_remarks (
          priority_task_id, user_id, user_name, user_avatar, user_role, remark, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, datetime('now','+6 hours'))
      `).run(id, req.user.id, req.user.name || 'User', req.user.avatar || '', req.user.role || 'user', remarks);

      db.prepare(`
        UPDATE priority_tasks
        SET status = ?, remarks = ?, updated_at = datetime('now','+6 hours')
        WHERE id = ?
      `).run(status, remarks, id);
    } else {
      db.prepare(`
        UPDATE priority_tasks
        SET status = ?, updated_at = datetime('now','+6 hours')
        WHERE id = ?
      `).run(status, id);
    }

    const updated = db.prepare(`
      SELECT
        pt.*,
        u.name AS assignee_user_name,
        u.email AS assignee_user_email,
        u.avatar AS assignee_user_avatar,
        u.title AS assignee_user_title,
        c.name AS creator_name
      FROM priority_tasks pt
      LEFT JOIN users u ON u.id = pt.assignee_user_id
      LEFT JOIN users c ON c.id = pt.created_by
      WHERE pt.id = ?
    `).get(id);

    audit(req, 'priority_task.status_update', 'priority_task', id, `Status updated to ${status}`);
    return res.json(attachRemarksToTask(updated));
  }

  // Admin update
  const { work_title, description, priority, assignee_name, assignee_user_id, status, due_date, remarks } = req.body;
  if (!work_title || !String(work_title).trim()) {
    return res.status(400).json({ error: 'Work Title is required' });
  }

  let finalUserId = assignee_user_id !== undefined ? (assignee_user_id ? Number(assignee_user_id) : null) : existing.assignee_user_id;
  let finalAssigneeName = assignee_name !== undefined ? String(assignee_name || '').trim() : existing.assignee_name;

  const allUsers = db.prepare('SELECT id, name, email FROM users WHERE is_active = 1').all();
  if (assignee_name !== undefined && !assignee_user_id && finalAssigneeName) {
    const matched = findMatchingUser(finalAssigneeName, allUsers);
    if (matched) {
      finalUserId = matched.id;
      finalAssigneeName = matched.name;
    }
  } else if (finalUserId) {
    const matched = allUsers.find((u) => u.id === finalUserId);
    if (matched) finalAssigneeName = matched.name;
  }

  // Check if assignee is available (not on leave or weekend)
  if (finalUserId) {
    const availability = checkUserAvailability(finalUserId, today());
    if (!availability.available) {
      return res.status(400).json({ error: availability.reason });
    }
  }

  const cleanRemarks = remarks !== undefined ? String(remarks || '').trim() : existing.remarks;

  db.prepare(`
    UPDATE priority_tasks
    SET
      work_title = ?,
      description = ?,
      priority = ?,
      assignee_name = ?,
      assignee_user_id = ?,
      status = ?,
      due_date = ?,
      remarks = ?,
      updated_at = datetime('now','+6 hours')
    WHERE id = ?
  `).run(
    String(work_title).trim(),
    description !== undefined ? String(description || '').trim() : existing.description,
    priority ? normalizePriority(priority) : existing.priority,
    finalAssigneeName,
    finalUserId,
    status ? normalizeStatus(status) : existing.status,
    due_date !== undefined ? parseDate(due_date) : existing.due_date,
    cleanRemarks,
    id,
  );

  // If a new remark was passed in edit form and it differs from existing latest, insert it
  if (remarks !== undefined && cleanRemarks && cleanRemarks !== existing.remarks) {
    db.prepare(`
      INSERT INTO priority_task_remarks (
        priority_task_id, user_id, user_name, user_avatar, user_role, remark, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, datetime('now','+6 hours'))
    `).run(id, req.user.id, req.user.name || 'Admin', req.user.avatar || '', req.user.role || 'admin', cleanRemarks);
  }

  const updated = db.prepare(`
    SELECT
      pt.*,
      u.name AS assignee_user_name,
      u.email AS assignee_user_email,
      u.avatar AS assignee_user_avatar,
      u.title AS assignee_user_title,
      c.name AS creator_name
    FROM priority_tasks pt
    LEFT JOIN users u ON u.id = pt.assignee_user_id
    LEFT JOIN users c ON c.id = pt.created_by
    WHERE pt.id = ?
  `).get(id);

  audit(req, 'priority_task.update', 'priority_task', id, `Updated priority task: ${updated.work_title}`);
  res.json(attachRemarksToTask(updated));
});

// DELETE single priority task
router.delete('/:id', requirePermission('priority_tasks.manage'), (req, res) => {
  const id = Number(req.params.id);
  if (!id || isNaN(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid priority task ID' });
  }

  const existing = db.prepare('SELECT * FROM priority_tasks WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Priority task not found' });

  db.prepare('DELETE FROM priority_task_remarks WHERE priority_task_id = ?').run(id);
  db.prepare('DELETE FROM priority_tasks WHERE id = ?').run(id);
  audit(req, 'priority_task.delete', 'priority_task', id, `Deleted priority task: ${existing.work_title}`);
  res.json({ ok: true });
});

// POST transfer single priority task to main tasks table
router.post('/:id/transfer', (req, res) => {
  const id = Number(req.params.id);
  if (!id || isNaN(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid priority task ID' });
  }

  const pt = db.prepare(`
    SELECT
      pt.*,
      u.name AS assignee_user_name,
      u.email AS assignee_user_email,
      u.avatar AS assignee_user_avatar,
      c.name AS creator_name
    FROM priority_tasks pt
    LEFT JOIN users u ON u.id = pt.assignee_user_id
    LEFT JOIN users c ON c.id = pt.created_by
    WHERE pt.id = ?
  `).get(id);

  if (!pt) return res.status(404).json({ error: 'Priority task not found' });

  const includeRemarks = req.body?.includeRemarks !== false;

  db.exec('BEGIN');
  let resultData;
  try {
    resultData = transferPriorityTaskToMainTask(pt, req, { includeRemarks });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    console.error('Transfer single priority task error:', err);
    return res.status(500).json({ error: 'Failed to transfer priority task: ' });
  }

  const updatedTask = db.prepare(`
    SELECT
      pt.*,
      u.name AS assignee_user_name,
      u.email AS assignee_user_email,
      u.avatar AS assignee_user_avatar,
      u.title AS assignee_user_title,
      u.role AS assignee_user_role,
      c.name AS creator_name
    FROM priority_tasks pt
    LEFT JOIN users u ON u.id = pt.assignee_user_id
    LEFT JOIN users c ON c.id = pt.created_by
    WHERE pt.id = ?
  `).get(id);

  res.json({
    ok: true,
    taskId: resultData.taskId,
    priorityTask: attachRemarksToTask(updatedTask),
  });
});

export default router;
