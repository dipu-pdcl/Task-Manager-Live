import { db } from '../db.js';
import { dateRangeFromKey, today, BD_OFFSET_MS } from '../utils.js';

const KPI_CONFIG_CACHE = new Map();
let cacheVersion = 0;

export function invalidateKpiConfigCache() {
  cacheVersion++;
  KPI_CONFIG_CACHE.clear();
}

export function getKpiConfig() {
  if (KPI_CONFIG_CACHE.has(cacheVersion)) {
    return KPI_CONFIG_CACHE.get(cacheVersion);
  }
  const rules = db.prepare(`
    SELECT rule_key, rule_name, rule_category, points, enabled, description
    FROM kpi_config
    ORDER BY rule_category, rule_name
  `).all();
  const config = {};
  for (const r of rules) {
    config[r.rule_key] = {
      rule_key: r.rule_key,
      rule_name: r.rule_name,
      rule_category: r.rule_category,
      points: r.points,
      enabled: r.enabled === 1,
      description: r.description,
    };
  }
  KPI_CONFIG_CACHE.set(cacheVersion, config);
  return config;
}

export function getKpiRule(ruleKey) {
  const config = getKpiConfig();
  const rule = config[ruleKey];
  return rule?.enabled ? rule.points : 0;
}

function getCompletedAssignees(taskId) {
  return db.prepare(`
    SELECT ta.user_id, ta.completed_at
    FROM task_assignees ta
    WHERE ta.task_id = ? AND ta.status = 'done' AND ta.completed_at IS NOT NULL
  `).all(taskId);
}

function getTaskCreator(taskId) {
  return db.prepare('SELECT created_by FROM tasks WHERE id = ?').get(taskId)?.created_by;
}

function isSelfTask(taskId) {
  return db.prepare('SELECT is_self_task FROM tasks WHERE id = ?').get(taskId)?.is_self_task === 1;
}

export function calculateUserKpi(userId, fromDate, toDate) {
  const config = getKpiConfig();
  
  const tasks = db.prepare(`
    SELECT t.*, 
      CASE WHEN ta.user_id IS NOT NULL THEN 1 ELSE 0 END as is_assignee,
      ta.completed_at as assignee_completed_at,
      ta.status as assignee_status,
      t.due_date
    FROM tasks t
    LEFT JOIN task_assignees ta ON ta.task_id = t.id AND ta.user_id = ?
    WHERE t.status = 'done' 
    AND t.completed_at IS NOT NULL
    AND date(t.completed_at) >= date(?)
    AND date(t.completed_at) <= date(?)
    AND t.archived = 0
  `).all(userId, fromDate, toDate);

  const breakdown = {};
  let totalPoints = 0;
  let completed = 0;
  let onTime = 0;
  let overdueCount = 0;
  let totalCompletionHours = 0;

  for (const task of tasks) {
    const creatorId = task.created_by;
    const isCreator = creatorId === userId;
    const isAssignee = task.is_assignee === 1;
    const assigneeCompleted = isAssignee && task.assignee_completed_at && task.assignee_status === 'done';
    const isSelf = isSelfTask(task.id);

    if (assigneeCompleted || (isCreator && assigneeCompleted)) {
      completed++;
      
      // Check if completed on time
      const dueDate = task.due_date;
      const completedAt = task.completed_at;
      if (dueDate && completedAt && new Date(completedAt) <= new Date(dueDate)) {
        onTime++;
      } else if (dueDate) {
        overdueCount++;
      }

      // Calculate completion hours
      if (task.created_at && completedAt) {
        const hours = (new Date(completedAt) - new Date(task.created_at)) / (1000 * 60 * 60);
        totalCompletionHours += hours;
      }
    }

    if (isSelf && isCreator && assigneeCompleted) {
      const points = getKpiRule('self_task');
      if (points !== 0) {
        breakdown['self_task'] = (breakdown['self_task'] || 0) + points;
        totalPoints += points;
      }
    } else {
      if (isCreator && assigneeCompleted) {
        const points = getKpiRule('create_task');
        if (points !== 0) {
          breakdown['create_task'] = (breakdown['create_task'] || 0) + points;
          totalPoints += points;
        }
      }
      if (assigneeCompleted) {
        const points = getKpiRule('assignee_task');
        if (points !== 0) {
          breakdown['assignee_task'] = (breakdown['assignee_task'] || 0) + points;
          totalPoints += points;
        }
      }
    }

    if (assigneeCompleted || (isCreator && assigneeCompleted)) {
      const bonus = getKpiRule('task_bonus');
      if (bonus !== 0) {
        breakdown['task_bonus'] = (breakdown['task_bonus'] || 0) + bonus;
        totalPoints += bonus;
      }
    }

    if (isCreator && !isSelf) {
      const createBonus = getKpiRule('create_task_bonus');
      if (createBonus !== 0) {
        breakdown['create_task_bonus'] = (breakdown['create_task_bonus'] || 0) + createBonus;
        totalPoints += createBonus;
      }
    }
  }

  const overdueTasks = db.prepare(`
    SELECT t.id
    FROM tasks t
    LEFT JOIN task_assignees ta ON ta.task_id = t.id AND ta.user_id = ?
    WHERE t.status = 'done'
    AND t.due_date IS NOT NULL
    AND date(t.completed_at) > date(t.due_date)
    AND date(t.completed_at) >= date(?)
    AND date(t.completed_at) <= date(?)
    AND t.archived = 0
    AND (ta.user_id = ? OR t.created_by = ?)
  `).all(userId, fromDate, toDate, userId, userId);

  if (overdueTasks.length > 0) {
    const penalty = getKpiRule('overdue_task');
    if (penalty !== 0) {
      breakdown['overdue_task'] = (breakdown['overdue_task'] || 0) + (penalty * overdueTasks.length);
      totalPoints += penalty * overdueTasks.length;
    }
  }

  const completionRate = completed > 0 ? Math.round((onTime / completed) * 100) : 0;
  const avgCompletionHours = completed > 0 ? Math.round(totalCompletionHours / completed * 10) / 10 : 0;

  return { 
    breakdown, 
    totalPoints,
    points: totalPoints, // alias for backward compatibility
    score: totalPoints,
    completionRate,
    avgCompletionHours,
    completed,
    onTime,
    overdueCount,
  };
}

export function calculateAllUsersKpi(fromDate, toDate) {
  const users = db.prepare(`
    SELECT u.id, u.name, u.role, u.avatar, u.email,
      t.name AS team_name, d.name AS department_name
    FROM users u 
    LEFT JOIN teams t ON t.id = u.team_id 
    LEFT JOIN departments d ON d.id = u.department_id
    WHERE u.is_active = 1 AND u.role != 'super_admin'
    ORDER BY u.name
  `).all();

  return users.map((u) => {
    const { breakdown, totalPoints, score, completionRate, avgCompletionHours, completed, onTime, overdueCount } = calculateUserKpi(u.id, fromDate, toDate);
    return { 
      ...u, 
      kpiBreakdown: breakdown, 
      kpiTotal: totalPoints,
      score,
      completionRate,
      avgCompletionHours,
      completed,
      onTime,
      overdueCount,
      kpiRank: 0 
    };
  }).sort((a, b) => b.kpiTotal - a.kpiTotal).map((u, i) => ({ ...u, kpiRank: i + 1 }));
}

export function calculateUserKpiForPeriod(userId, period = 'month') {
  const range = dateRangeFromKey(period);
  return calculateUserKpi(userId, range.start, range.end);
}

export function calculateAllUsersKpiForPeriod(period = 'month') {
  const range = dateRangeFromKey(period);
  return calculateAllUsersKpi(range.start, range.end);
}

export function getKpiConfigRules() {
  return getKpiConfig();
}

// Stub for recording KPI transactions - logs to console
export function recordKpiTransaction(data) {
  console.log('[KPI] Transaction:', data);
  return { ok: true };
}

// Cache for getCompletedTasksWithKpi
const TASK_KPI_CACHE = new Map();
let taskKpiCacheVersion = 0;

export function invalidateTaskKpiCache() {
  taskKpiCacheVersion++;
  TASK_KPI_CACHE.clear();
}

export function calculateTaskKpi(task, userId, assigneeIds) {
  const config = getKpiConfig();
  const isCreator = task.created_by === userId;
  const isAssignee = assigneeIds.includes(userId);
  const isSelf = task.is_self_task === 1;
  
  const transactions = [];
  
  if (isSelf && isCreator && isAssignee) {
    const points = getKpiRule('self_task');
    if (points !== 0) {
      transactions.push({
        userId,
        ruleKey: 'self_task',
        ruleName: config.self_task?.rule_name || 'Self Task Completion',
        points,
        configValue: points,
        configEnabled: config.self_task?.enabled ?? true,
        reason: 'Self task completion'
      });
    }
  } else {
    if (isCreator && isAssignee) {
      const points = getKpiRule('create_task');
      if (points !== 0) {
        transactions.push({
          userId,
          ruleKey: 'create_task',
          ruleName: config.create_task?.rule_name || 'Task Completion (Creator)',
          points,
          configValue: points,
          configEnabled: config.create_task?.enabled ?? true,
          reason: 'Task completion as creator'
        });
      }
    }
    if (isAssignee) {
      const points = getKpiRule('assignee_task');
      if (points !== 0) {
        transactions.push({
          userId,
          ruleKey: 'assignee_task',
          ruleName: config.assignee_task?.rule_name || 'Task Completion (Assignee)',
          points,
          configValue: points,
          configEnabled: config.assignee_task?.enabled ?? true,
          reason: 'Task completion as assignee'
        });
      }
    }
  }
  
  if (isAssignee || (isCreator && isAssignee)) {
    const bonus = getKpiRule('task_bonus');
    if (bonus !== 0) {
      transactions.push({
        userId,
        ruleKey: 'task_bonus',
        ruleName: config.task_bonus?.rule_name || 'Task Completion Bonus',
        points: bonus,
        configValue: bonus,
        configEnabled: config.task_bonus?.enabled ?? true,
        reason: 'Task completion bonus'
      });
    }
  }
  
  if (isCreator && !isSelf) {
    const createBonus = getKpiRule('create_task_bonus');
    if (createBonus !== 0) {
      transactions.push({
        userId,
        ruleKey: 'create_task_bonus',
        ruleName: config.create_task_bonus?.rule_name || 'Task Creation',
        points: createBonus,
        configValue: createBonus,
        configEnabled: config.create_task_bonus?.enabled ?? true,
        reason: 'Task creation bonus'
      });
    }
  }
  
  const dueDate = task.due_date;
  const completedAt = task.completed_at;
  if (dueDate && completedAt && new Date(completedAt) > new Date(dueDate)) {
    const penalty = getKpiRule('overdue_task');
    if (penalty !== 0) {
      transactions.push({
        userId,
        ruleKey: 'overdue_task',
        ruleName: config.overdue_task?.rule_name || 'Overdue Task Penalty',
        points: penalty,
        configValue: penalty,
        configEnabled: config.overdue_task?.enabled ?? true,
        reason: 'Overdue task penalty'
      });
    }
  }
  
  return { transactions };
}

// Get all completed tasks with KPI points in a date range (for efficient monthly/yearly aggregation)
export function getCompletedTasksWithKpi(fromDate, toDate) {
  const cacheKey = `${fromDate}:${toDate}:${taskKpiCacheVersion}`;
  if (TASK_KPI_CACHE.has(cacheKey)) {
    return TASK_KPI_CACHE.get(cacheKey);
  }
  
  const config = getKpiConfig();
  
  const tasks = db.prepare(`
    SELECT t.id, t.completed_at, t.due_date, t.created_by, t.created_at,
      u.id as user_id, u.name as user_name, u.role, u.email,
      tm.name as team_name, d.name as department_name,
      CASE WHEN ta.user_id IS NOT NULL THEN 1 ELSE 0 END as is_assignee,
      ta.completed_at as assignee_completed_at,
      ta.status as assignee_status,
      t.is_self_task
    FROM tasks t
    LEFT JOIN task_assignees ta ON ta.task_id = t.id
    LEFT JOIN users u ON u.id = COALESCE(ta.user_id, t.created_by)
    LEFT JOIN teams tm ON tm.id = u.team_id
    LEFT JOIN departments d ON d.id = u.department_id
    WHERE t.status = 'done' 
    AND t.completed_at IS NOT NULL
    AND date(t.completed_at) >= date(?)
    AND date(t.completed_at) <= date(?)
    AND t.archived = 0
    AND u.is_active = 1
    AND u.role != 'super_admin'
  `).all(fromDate, toDate);
  
  const taskKpiMap = new Map();
  
  for (const task of tasks) {
    const userId = task.user_id;
    const isCreator = task.created_by === userId;
    const isAssignee = task.is_assignee === 1;
    const assigneeCompleted = isAssignee && task.assignee_completed_at && task.assignee_status === 'done';
    const isSelf = task.is_self_task === 1;
    
    if (!assigneeCompleted && !(isCreator && assigneeCompleted)) continue;
    
    let points = 0;
    const breakdown = {};
    
    if (isSelf && isCreator && assigneeCompleted) {
      const p = getKpiRule('self_task');
      if (p !== 0) { breakdown['self_task'] = p; points += p; }
    } else {
      if (isCreator && assigneeCompleted) {
        const p = getKpiRule('create_task');
        if (p !== 0) { breakdown['create_task'] = p; points += p; }
      }
      if (assigneeCompleted) {
        const p = getKpiRule('assignee_task');
        if (p !== 0) { breakdown['assignee_task'] = p; points += p; }
      }
    }
    
    if (assigneeCompleted || (isCreator && assigneeCompleted)) {
      const bonus = getKpiRule('task_bonus');
      if (bonus !== 0) { breakdown['task_bonus'] = bonus; points += bonus; }
    }
    
    if (isCreator && !isSelf) {
      const createBonus = getKpiRule('create_task_bonus');
      if (createBonus !== 0) { breakdown['create_task_bonus'] = createBonus; points += createBonus; }
    }
    
    // Overdue penalty
    const dueDate = task.due_date;
    const completedAt = task.completed_at;
    if (dueDate && completedAt && new Date(completedAt) > new Date(dueDate)) {
      const penalty = getKpiRule('overdue_task');
      if (penalty !== 0) { breakdown['overdue_task'] = penalty; points += penalty; }
    }
    
    const key = `${userId}-${task.id}`;
    taskKpiMap.set(key, {
      userId,
      userName: task.user_name,
      role: task.role,
      email: task.email,
      team: task.team_name || '—',
      branch: task.department_name || '—',
      completedAt: task.completed_at,
      createdAt: task.created_at,
      points,
      breakdown,
      completed: 1,
      onTime: dueDate && completedAt && new Date(completedAt) <= new Date(dueDate) ? 1 : 0,
      overdue: dueDate && completedAt && new Date(completedAt) > new Date(dueDate) ? 1 : 0,
      hours: task.created_at && completedAt ? (new Date(completedAt) - new Date(task.created_at)) / (1000 * 60 * 60) : 0,
    });
  }
  
  const result = Array.from(taskKpiMap.values());
  TASK_KPI_CACHE.set(cacheKey, result);
  return result;
}