import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireAdmin, isAdmin } from '../middleware.js';
import { audit, notify } from '../middleware.js';
import { deleteOldMessages } from '../chatCleanup.js';
import { checkUserAvailability, today } from '../utils.js';

const router = Router();

function getConversationId(userId1, userId2) {
  return [userId1, userId2].sort((a, b) => a - b).join('_');
}

function isGroupAdmin(userId, groupId) {
  const member = db.prepare('SELECT role FROM chat_group_members WHERE group_id = ? AND user_id = ?').get(groupId, userId);
  return member && member.role === 'admin';
}

function requireGroupAdminOrAdmin(req, res, next) {
  const groupId = Number(req.params.id || req.params.groupId);
  if (isAdmin(req.user) || isGroupAdmin(req.user.id, groupId)) return next();
  return res.status(403).json({ error: 'You are not authorized to manage this group' });
}

// Get all conversations for current user (with last message + unread count)
router.get('/conversations', requireAuth, (req, res) => {
  const userId = req.user.id;
  const isUserAdmin = isAdmin(req.user);

  // Get list of users the current user has chatted with, plus all users (for admins)
  const conversations = db.prepare(`
    SELECT DISTINCT
      CASE WHEN cm.sender_id = ? THEN cm.recipient_id ELSE cm.sender_id END AS other_user_id,
      MAX(cm.created_at) AS last_message_at
    FROM chat_messages cm
    WHERE (cm.sender_id = ? OR cm.recipient_id = ?)
      AND cm.recipient_id IS NOT NULL
    GROUP BY other_user_id
    ORDER BY last_message_at DESC
  `).all(userId, userId, userId);

  // Get user details for these conversations
  const result = conversations.map((c) => {
    const otherUser = db.prepare(`
      SELECT u.id, u.name, u.email, u.role, u.avatar, u.live_status, rg.color AS role_group_color
      FROM users u
      LEFT JOIN role_groups rg ON rg.id = u.role_group_id
      WHERE u.id = ? AND u.is_active = 1
    `).get(c.other_user_id);

    if (!otherUser) return null;

    const convId = getConversationId(userId, c.other_user_id);
    const lastMessage = db.prepare(`
      SELECT id, content, sender_id, created_at
      FROM chat_messages
      WHERE conversation_id = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(convId);

    const unreadCount = db.prepare(`
      SELECT COUNT(*) AS c
      FROM chat_messages cm
      WHERE cm.conversation_id = ?
        AND cm.sender_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM chat_reads cr
          WHERE cr.message_id = cm.id AND cr.user_id = ?
        )
    `).get(convId, c.other_user_id, userId).c;

    return {
      other_user: otherUser,
      conversation_id: convId,
      last_message: lastMessage,
      unread_count: unreadCount,
      type: 'direct',
    };
  }).filter(Boolean);

  // Get groups the current user is a member of
  const groups = db.prepare(`
    SELECT cg.id, cg.name, cg.description, cg.created_by, cg.created_at, cgm.role AS member_role
    FROM chat_groups cg
    JOIN chat_group_members cgm ON cg.id = cgm.group_id
    WHERE cgm.user_id = ? AND cg.is_active = 1
    ORDER BY cg.updated_at DESC
  `).all(userId);

  const groupConversations = groups.map((g) => {
    const memberCount = db.prepare('SELECT COUNT(*) AS c FROM chat_group_members WHERE group_id = ?').get(g.id).c;
    const lastMessage = db.prepare(`
      SELECT cm.id, cm.content, cm.sender_id, cm.created_at
      FROM chat_messages cm
      WHERE cm.group_id = ?
      ORDER BY cm.created_at DESC LIMIT 1
    `).get(g.id);

    const unreadCount = db.prepare(`
      SELECT COUNT(*) AS c
      FROM chat_messages cm
      WHERE cm.group_id = ? AND cm.sender_id != ?
        AND NOT EXISTS (
          SELECT 1 FROM chat_reads cr
          WHERE cr.message_id = cm.id AND cr.user_id = ?
        )
    `).get(g.id, userId, userId).c;

    return {
      group: {
        id: g.id,
        name: g.name,
        description: g.description,
        created_by: g.created_by,
        member_count: memberCount,
        member_role: g.member_role,
        created_at: g.created_at,
      },
      conversation_id: `group_${g.id}`,
      last_message: lastMessage,
      unread_count: unreadCount,
      type: 'group',
    };
  });

  // For admins, also include all users they haven't chatted with yet
  let additionalUsers = [];
  if (isAdmin(req.user)) {
    const existingUserIds = result.map((r) => r.other_user.id);
    const placeholders = existingUserIds.length > 0 ? existingUserIds.map(() => '?').join(',') : '0';
    additionalUsers = db.prepare(`
      SELECT u.id, u.name, u.email, u.role, u.avatar, u.live_status, rg.color AS role_group_color
      FROM users u
      LEFT JOIN role_groups rg ON rg.id = u.role_group_id
      WHERE u.is_active = 1 AND u.id != ? ${existingUserIds.length > 0 ? `AND u.id NOT IN (${placeholders})` : ''}
      ORDER BY u.name
      LIMIT 50
    `).all(userId, ...existingUserIds);
  }

  res.json({
    conversations: result,
    groups: groupConversations,
    available_users: additionalUsers,
  });
});

// Get all users (for @mention search and new chat)
router.get('/users', requireAuth, (req, res) => {
  const { q, include_unavailable } = req.query;
  const userId = req.user.id;
  let query = `
    SELECT u.id, u.name, u.email, u.role, u.avatar, u.live_status, u.weekend_days, rg.color AS role_group_color
    FROM users u
    LEFT JOIN role_groups rg ON rg.id = u.role_group_id
    WHERE u.is_active = 1 AND u.id != ?
  `;
  const params = [userId];

  if (q && typeof q === 'string' && q.trim()) {
    query += ' AND (u.name LIKE ? OR u.email LIKE ?)';
    const term = `%${q.trim()}%`;
    params.push(term, term);
  }

  query += ' ORDER BY u.live_status DESC, u.name LIMIT 200';

  const users = db.prepare(query).all(...params);
  const currentDate = today();

  // Filter users based on availability (leave/weekend)
  const filteredUsers = users.map((user) => {
    const availability = checkUserAvailability(user.id, currentDate);
    return {
      ...user,
      availability: {
        available: availability.available,
        reason: availability.reason,
        status: availability.details?.type || null,
      },
    };
  });

  // By default, exclude unavailable users unless explicitly requested
  const showUnavailable = include_unavailable === 'true';
  const finalUsers = showUnavailable ? filteredUsers : filteredUsers.filter((u) => u.availability.available);

  res.json({ users: finalUsers });
});

// Get messages between current user and another user (or group messages)
router.get('/messages', requireAuth, (req, res) => {
  const userId = req.user.id;
  const { otherUserId, taskId, groupId, limit = 100, before } = req.query;

  let query = `
    SELECT cm.id, cm.task_id, cm.sender_id, cm.recipient_id, cm.group_id, cm.conversation_id,
           cm.content, cm.mentions, cm.created_at, cm.updated_at,
           u.name AS sender_name, u.role AS sender_role, u.avatar AS sender_avatar,
           rg.color AS sender_color
    FROM chat_messages cm
    JOIN users u ON cm.sender_id = u.id
    LEFT JOIN role_groups rg ON rg.id = u.role_group_id
    WHERE 1=1
  `;
  const params = [];

  if (otherUserId) {
    // Direct conversation between current user and other user
    const convId = getConversationId(userId, Number(otherUserId));
    query += ' AND cm.conversation_id = ?';
    params.push(convId);
  } else if (groupId) {
    // Verify user is a member of the group
    const member = db.prepare('SELECT id FROM chat_group_members WHERE group_id = ? AND user_id = ?').get(groupId, userId);
    if (!member) return res.status(403).json({ error: 'You are not a member of this group' });
    query += ' AND cm.group_id = ?';
    params.push(groupId);
  } else if (taskId) {
    // Task-related chat
    query += ' AND cm.task_id = ?';
    params.push(taskId);
  } else {
    // Group chat (no recipient, no conversation_id)
    query += ' AND cm.recipient_id IS NULL AND cm.conversation_id = ""';
  }

  if (before) {
    query += ' AND cm.created_at < ?';
    params.push(before);
  }

  query += ' ORDER BY cm.created_at DESC LIMIT ?';
  params.push(Number(limit));

  const rows = db.prepare(query).all(...params);
  const messages = rows.reverse();

  // Fetch attachments for each message
  const messageIds = messages.map((m) => m.id);
  const attachmentsByMessage = {};
  if (messageIds.length > 0) {
    const placeholders = messageIds.map(() => '?').join(',');
    const attRows = db.prepare(`
      SELECT id, message_id, filename, stored_name, size, mime, uploaded_at
      FROM chat_attachments
      WHERE message_id IN (${placeholders})
      ORDER BY uploaded_at DESC
    `).all(...messageIds);
    for (const a of attRows) {
      if (!attachmentsByMessage[a.message_id]) attachmentsByMessage[a.message_id] = [];
      attachmentsByMessage[a.message_id].push({
        id: a.id,
        filename: a.filename,
        stored_name: a.stored_name,
        size: a.size,
        mime: a.mime,
        uploaded_at: a.uploaded_at,
      });
    }
  }

  for (const m of messages) {
    m.attachments = attachmentsByMessage[m.id] || [];
  }

  res.json({ messages });
});

// Send a new chat message
router.post('/messages', requireAuth, (req, res) => {
  const { taskId, recipientId, groupId, content, mentions } = req.body || {};
  const senderId = req.user.id;

  if (!content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'Message content is required' });
  }
  if (content.length > 5000) {
    return res.status(400).json({ error: 'Message content is too long (max 5000 characters)' });
  }

  // Determine conversation_id
  let conversationId = '';
  if (groupId) {
    // Verify group exists and user is a member
    const member = db.prepare('SELECT id FROM chat_group_members WHERE group_id = ? AND user_id = ?').get(groupId, senderId);
    if (!member) return res.status(403).json({ error: 'You are not a member of this group' });
    conversationId = `group_${groupId}`;
  } else if (recipientId) {
    // Verify recipient exists
    const recipient = db.prepare('SELECT id, name FROM users WHERE id = ? AND is_active = 1').get(recipientId);
    if (!recipient) return res.status(404).json({ error: 'Recipient not found' });
    conversationId = getConversationId(senderId, recipientId);
  } else if (taskId) {
    // Verify task exists
    const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId);
    if (!task) return res.status(404).json({ error: 'Task not found' });
  }

  // Parse mentions - extract @mentions from content if not provided
  let parsedMentions = [];
  if (Array.isArray(mentions)) {
    parsedMentions = mentions.filter((id) => Number.isInteger(id));
  } else if (typeof content === 'string') {
    // Extract @username patterns (we'll match by user names)
    const mentionRegex = /@([\w\s.]+?)(?=\s|$|[^a-zA-Z0-9])/g;
    const matches = [...content.matchAll(mentionRegex)];
    if (matches.length > 0) {
      const names = matches.map((m) => m[1].trim());
      const placeholders = names.map(() => '?').join(',');
      const users = db.prepare(`
        SELECT id FROM users WHERE name IN (${placeholders}) AND is_active = 1
      `).all(...names);
      parsedMentions = users.map((u) => u.id);
    }
  }

  // A user on approved leave or on their weekend must not be mentioned: a task
  // received that way cannot be worked on and would only show up as overdue.
  // The mention is stripped here and reported back so the client can warn.
  const currentDate = today();
  const blockedMentions = [];
  if (parsedMentions.length > 0) {
    const ids = [...new Set(parsedMentions)];
    const marks = ids.map(() => '?').join(',');
    const mentionedUsers = db.prepare(`SELECT id, name FROM users WHERE id IN (${marks})`).all(...ids);
    const nameById = new Map(mentionedUsers.map((u) => [u.id, u.name]));
    parsedMentions = ids.filter((id) => {
      const availability = checkUserAvailability(id, currentDate);
      if (availability.available) return true;
      blockedMentions.push({ user_id: id, name: nameById.get(id) || `#${id}`, reason: availability.reason });
      return false;
    });
  }

  const r = db.prepare(`
    INSERT INTO chat_messages (task_id, sender_id, recipient_id, group_id, conversation_id, content, mentions, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now','+6 hours'), datetime('now','+6 hours'))
  `).run(
    taskId || null,
    senderId,
    recipientId || null,
    groupId || null,
    conversationId,
    content.trim(),
    JSON.stringify(parsedMentions)
  );

  const messageId = Number(r.lastInsertRowid);

  // Send notifications to mentioned users
  for (const mentionedUserId of parsedMentions) {
    if (mentionedUserId !== senderId) {
      const link = groupId ? `/chat?groupId=${groupId}` : `/chat?userId=${senderId}`;
      notify(
        mentionedUserId,
        'chat',
        `You were mentioned by ${req.user.name}`,
        content.trim().substring(0, 200),
        link
      );
    }
  }

  // Send notification to recipient (if direct message and not already mentioned)
  if (recipientId && recipientId !== senderId && !parsedMentions.includes(recipientId)) {
    notify(
      recipientId,
      'chat',
      `New message from ${req.user.name}`,
      content.trim().substring(0, 200),
      `/chat?userId=${senderId}`
    );
  }

  // Send notification to other group members
  if (groupId) {
    const otherMembers = db.prepare(`
      SELECT user_id FROM chat_group_members
      WHERE group_id = ? AND user_id != ?
    `).all(groupId, senderId);
    const group = db.prepare('SELECT name FROM chat_groups WHERE id = ?').get(groupId);
    for (const m of otherMembers) {
      if (!parsedMentions.includes(m.user_id)) {
        notify(
          m.user_id,
          'chat',
          `${req.user.name} in ${group?.name || 'group'}`,
          content.trim().substring(0, 200),
          `/chat?groupId=${groupId}`
        );
      }
    }
  }

  const message = db.prepare(`
    SELECT cm.id, cm.task_id, cm.sender_id, cm.recipient_id, cm.group_id, cm.conversation_id,
           cm.content, cm.mentions, cm.created_at, cm.updated_at,
           u.name AS sender_name, u.role AS sender_role, u.avatar AS sender_avatar,
           rg.color AS sender_color
    FROM chat_messages cm
    JOIN users u ON cm.sender_id = u.id
    LEFT JOIN role_groups rg ON rg.id = u.role_group_id
    WHERE cm.id = ?
  `).get(messageId);

  audit(req, 'chat.send', 'chat_message', messageId, `Sent message${recipientId ? ' to user ' + recipientId : taskId ? ' on task ' + taskId : ' (group)'}`);
  res.status(201).json({
    message: { ...message, attachments: [] },
    mentioned: parsedMentions,
    blocked_mentions: blockedMentions,
  });
});

// Mark messages as read
router.post('/messages/read', requireAuth, (req, res) => {
  const { messageIds, conversationId, otherUserId, groupId } = req.body || {};
  const userId = req.user.id;
  const ids = [];

  if (Array.isArray(messageIds) && messageIds.length > 0) {
    ids.push(...messageIds.filter((id) => Number.isInteger(id)));
  } else if (otherUserId) {
    const convId = getConversationId(userId, Number(otherUserId));
    const rows = db.prepare(`
      SELECT cm.id FROM chat_messages cm
      WHERE cm.conversation_id = ? AND cm.sender_id != ?
        AND NOT EXISTS (
          SELECT 1 FROM chat_reads cr
          WHERE cr.message_id = cm.id AND cr.user_id = ?
        )
    `).all(convId, userId, userId);
    ids.push(...rows.map((r) => r.id));
  } else if (groupId) {
    const rows = db.prepare(`
      SELECT cm.id FROM chat_messages cm
      WHERE cm.group_id = ? AND cm.sender_id != ?
        AND NOT EXISTS (
          SELECT 1 FROM chat_reads cr
          WHERE cr.message_id = cm.id AND cr.user_id = ?
        )
    `).all(groupId, userId, userId);
    ids.push(...rows.map((r) => r.id));
  } else if (conversationId) {
    const rows = db.prepare(`
      SELECT cm.id FROM chat_messages cm
      WHERE cm.conversation_id = ? AND cm.sender_id != ?
        AND NOT EXISTS (
          SELECT 1 FROM chat_reads cr
          WHERE cr.message_id = cm.id AND cr.user_id = ?
        )
    `).all(conversationId, userId, userId);
    ids.push(...rows.map((r) => r.id));
  } else {
    // Mark all unread group messages (no recipient) as read
    const rows = db.prepare(`
      SELECT cm.id FROM chat_messages cm
      WHERE cm.recipient_id IS NULL AND cm.conversation_id = '' AND cm.sender_id != ?
        AND NOT EXISTS (
          SELECT 1 FROM chat_reads cr
          WHERE cr.message_id = cm.id AND cr.user_id = ?
        )
    `).all(userId, userId);
    ids.push(...rows.map((r) => r.id));
  }

  if (ids.length === 0) {
    return res.json({ ok: true, marked: 0 });
  }

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO chat_reads (message_id, user_id, read_at)
    VALUES (?, ?, datetime('now','+6 hours'))
  `);

  db.exec('BEGIN');
  try {
    for (const id of ids) stmt.run(id, userId);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  res.json({ ok: true, marked: ids.length });
});

// Get list of chat attachments for a conversation
router.get('/chatAttachments', requireAuth, (req, res) => {
  const userId = req.user.id;
  const { otherUserId, groupId, taskId } = req.query;

  let rows;
  if (groupId) {
    const member = db.prepare('SELECT id FROM chat_group_members WHERE group_id = ? AND user_id = ?').get(Number(groupId), userId);
    if (!member && !isAdmin(req.user)) return res.status(403).json({ error: 'Not a group member' });
    rows = db.prepare(`
      SELECT ca.id, ca.filename, ca.stored_name, ca.size, ca.mime, ca.uploaded_at, u.name AS sender_name
      FROM chat_attachments ca
      JOIN chat_messages cm ON ca.message_id = cm.id
      JOIN users u ON ca.sender_id = u.id
      WHERE cm.group_id = ?
      ORDER BY ca.uploaded_at DESC
    `).all(Number(groupId));
  } else if (otherUserId) {
    const convId = getConversationId(userId, Number(otherUserId));
    rows = db.prepare(`
      SELECT ca.id, ca.filename, ca.stored_name, ca.size, ca.mime, ca.uploaded_at, u.name AS sender_name
      FROM chat_attachments ca
      JOIN chat_messages cm ON ca.message_id = cm.id
      JOIN users u ON ca.sender_id = u.id
      WHERE cm.conversation_id = ?
      ORDER BY ca.uploaded_at DESC
    `).all(convId);
  } else if (taskId) {
    const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(Number(taskId));
    if (!task) return res.status(404).json({ error: 'Task not found' });
    rows = db.prepare(`
      SELECT ca.id, ca.filename, ca.stored_name, ca.size, ca.mime, ca.uploaded_at, u.name AS sender_name
      FROM chat_attachments ca
      JOIN chat_messages cm ON ca.message_id = cm.id
      JOIN users u ON ca.sender_id = u.id
      WHERE cm.task_id = ?
      ORDER BY ca.uploaded_at DESC
    `).all(Number(taskId));
  } else {
    return res.status(400).json({ error: 'Specify otherUserId, groupId, or taskId' });
  }

  res.json({ attachments: rows });
});

// Get unread message count for current user
router.get('/unread', requireAuth, (req, res) => {
  const userId = req.user.id;
  // Direct + group messages
  const total = db.prepare(`
    SELECT COUNT(*) AS c
    FROM chat_messages cm
    WHERE (cm.recipient_id = ?
           OR (cm.recipient_id IS NULL AND cm.conversation_id = '' AND cm.sender_id != ?)
           OR (cm.group_id IS NOT NULL AND cm.group_id IN (
             SELECT group_id FROM chat_group_members WHERE user_id = ?
           ) AND cm.sender_id != ?))
      AND NOT EXISTS (
        SELECT 1 FROM chat_reads cr
        WHERE cr.message_id = cm.id AND cr.user_id = ?
      )
  `).get(userId, userId, userId, userId, userId).c;

  // Count by conversation/group
  const byConversation = db.prepare(`
    SELECT cm.conversation_id, cm.sender_id, COUNT(*) AS c
    FROM chat_messages cm
    WHERE (cm.recipient_id = ?)
      AND cm.sender_id != ?
      AND NOT EXISTS (
        SELECT 1 FROM chat_reads cr
        WHERE cr.message_id = cm.id AND cr.user_id = ?
      )
    GROUP BY cm.conversation_id, cm.sender_id
  `).all(userId, userId, userId);

  // Count by group
  const byGroup = db.prepare(`
    SELECT cm.group_id, COUNT(*) AS c
    FROM chat_messages cm
    WHERE cm.group_id IS NOT NULL
      AND cm.group_id IN (SELECT group_id FROM chat_group_members WHERE user_id = ?)
      AND cm.sender_id != ?
      AND NOT EXISTS (
        SELECT 1 FROM chat_reads cr
        WHERE cr.message_id = cm.id AND cr.user_id = ?
      )
    GROUP BY cm.group_id
  `).all(userId, userId, userId);

  res.json({ total, by_conversation: byConversation, by_group: byGroup });
});

// Update a chat message (only by sender or admin)
router.put('/messages/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const { content } = req.body || {};

  if (!content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'Message content is required' });
  }
  if (content.length > 5000) {
    return res.status(400).json({ error: 'Message content is too long (max 5000 characters)' });
  }

  const existing = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Message not found' });

  if (existing.sender_id !== req.user.id && !isAdmin(req.user)) {
    return res.status(403).json({ error: 'You can only edit your own messages' });
  }

  db.prepare(`
    UPDATE chat_messages SET content = ?, updated_at = datetime('now','+6 hours') WHERE id = ?
  `).run(content.trim(), id);

  const message = db.prepare(`
    SELECT cm.id, cm.task_id, cm.sender_id, cm.recipient_id, cm.conversation_id,
           cm.content, cm.mentions, cm.created_at, cm.updated_at,
           u.name AS sender_name, u.role AS sender_role, u.avatar AS sender_avatar
    FROM chat_messages cm
    JOIN users u ON cm.sender_id = u.id
    WHERE cm.id = ?
  `).get(id);

  audit(req, 'chat.update', 'chat_message', Number(id), 'Message edited');
  res.json({ message: { ...message, attachments: [] } });
});

// Delete a chat message - DISABLED: Messages cannot be deleted by any user
router.delete('/messages/:id', requireAuth, (req, res) => {
  return res.status(403).json({ error: 'Message deletion is not allowed. All messages are retained for 30 days as per system policy.' });
});

// Admin/Super Admin: View chat backup (all messages with filters)
router.get('/backup', requireAuth, requireAdmin, (req, res) => {
  const { startDate, endDate, senderId, recipientId, search, limit = 500 } = req.query;

  let query = `
    SELECT cm.id, cm.task_id, cm.sender_id, cm.recipient_id, cm.conversation_id,
           cm.content, cm.mentions, cm.created_at, cm.updated_at,
           u.name AS sender_name, u.role AS sender_role, u.email AS sender_email,
           u.avatar AS sender_avatar,
           r.name AS recipient_name, r.email AS recipient_email,
           t.title AS task_title
    FROM chat_messages cm
    JOIN users u ON cm.sender_id = u.id
    LEFT JOIN users r ON cm.recipient_id = r.id
    LEFT JOIN tasks t ON cm.task_id = t.id
    WHERE 1=1
  `;
  const params = [];

  if (startDate) {
    query += ' AND cm.created_at >= ?';
    params.push(startDate);
  }
  if (endDate) {
    query += ' AND cm.created_at <= ?';
    params.push(endDate);
  }
  if (senderId) {
    query += ' AND cm.sender_id = ?';
    params.push(senderId);
  }
  if (recipientId) {
    query += ' AND cm.recipient_id = ?';
    params.push(recipientId);
  }
  if (search && typeof search === 'string' && search.trim()) {
    query += ' AND (cm.content LIKE ? OR u.name LIKE ? OR r.name LIKE ?)';
    const term = `%${search.trim()}%`;
    params.push(term, term, term);
  }

  query += ' ORDER BY cm.created_at DESC LIMIT ?';
  params.push(Number(limit));

  const rows = db.prepare(query).all(...params);
  res.json({ messages: rows, total: rows.length });
});

// Admin/Super Admin: Force delete a message from backup - DISABLED: Messages cannot be deleted
router.delete('/backup/:id', requireAuth, requireAdmin, (req, res) => {
  return res.status(403).json({ error: 'Message deletion is not allowed. All messages are retained for 30 days as per system policy.' });
});

// Admin/Super Admin: Manually trigger cleanup of old messages
router.post('/backup/cleanup', requireAuth, requireAdmin, (req, res) => {
  const { daysOld = 30 } = req.body || {};
  const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
  const cutoffStr = cutoff.toISOString().replace('T', ' ').substring(0, 19);

  const result = db.prepare('DELETE FROM chat_messages WHERE updated_at < ?').run(cutoffStr);
  audit(req, 'chat.backup_cleanup', 'chat_messages', null, `Manually cleaned up ${result.changes} messages older than ${daysOld} days`);
  res.json({ ok: true, deleted: result.changes });
});

// Admin/Super Admin: Get chat statistics
router.get('/backup/stats', requireAuth, requireAdmin, (req, res) => {
  const total = db.prepare('SELECT COUNT(*) AS c FROM chat_messages').get().c;
  const today = db.prepare("SELECT COUNT(*) AS c FROM chat_messages WHERE date(created_at) = date('now','+6 hours')").get().c;
  const last7Days = db.prepare("SELECT COUNT(*) AS c FROM chat_messages WHERE created_at >= datetime('now','-7 days','+6 hours')").get().c;
  const last30Days = db.prepare("SELECT COUNT(*) AS c FROM chat_messages WHERE created_at >= datetime('now','-30 days','+6 hours')").get().c;
  const direct = db.prepare("SELECT COUNT(*) AS c FROM chat_messages WHERE recipient_id IS NOT NULL").get().c;
  const group = db.prepare("SELECT COUNT(*) AS c FROM chat_messages WHERE recipient_id IS NULL").get().c;
  const byUser = db.prepare(`
    SELECT u.id, u.name, u.role, COUNT(cm.id) AS message_count
    FROM users u
    LEFT JOIN chat_messages cm ON u.id = cm.sender_id
    GROUP BY u.id
    ORDER BY message_count DESC
    LIMIT 20
  `).all();

  res.json({
    total,
    today,
    last7Days,
    last30Days,
    direct,
    group,
    topSenders: byUser,
  });
});

// ============================================================
// CHAT GROUP MANAGEMENT
// ============================================================

// Get all groups (admin sees all, user sees their own)
router.get('/groups', requireAuth, (req, res) => {
  const userId = req.user.id;
  const isUserAdmin = isAdmin(req.user);

  let query = `
    SELECT cg.id, cg.name, cg.description, cg.created_by, cg.created_at, cg.updated_at, cgm.role AS member_role,
           (SELECT COUNT(*) FROM chat_group_members WHERE group_id = cg.id) AS member_count,
           (SELECT COUNT(*) FROM chat_messages WHERE group_id = cg.id) AS message_count
    FROM chat_groups cg
    LEFT JOIN chat_group_members cgm ON cg.id = cgm.group_id AND cgm.user_id = ?
    WHERE cg.is_active = 1
  `;
  const params = [userId];

  if (!isUserAdmin) {
    // Regular users can only see groups they're a member of
    query += ' AND cgm.user_id IS NOT NULL';
  }

  query += ' ORDER BY cg.updated_at DESC';

  const groups = db.prepare(query).all(...params);
  res.json({ groups });
});

// Create a new chat group (admin/super admin only)
router.post('/groups', requireAuth, requireAdmin, (req, res) => {
  const { name, description = '', memberIds = [] } = req.body || {};
  const userId = req.user.id;

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Group name is required' });
  }
  if (name.length > 100) {
    return res.status(400).json({ error: 'Group name is too long (max 100 characters)' });
  }
  if (!Array.isArray(memberIds) || memberIds.length === 0) {
    return res.status(400).json({ error: 'At least one member is required' });
  }

  // Create group
  const r = db.prepare(`
    INSERT INTO chat_groups (name, description, created_by, created_at, updated_at)
    VALUES (?, ?, ?, datetime('now','+6 hours'), datetime('now','+6 hours'))
  `).run(name.trim(), description.trim(), userId);

  const groupId = Number(r.lastInsertRowid);

  // Add creator as admin
  db.prepare(`
    INSERT INTO chat_group_members (group_id, user_id, role, joined_at)
    VALUES (?, ?, 'admin', datetime('now','+6 hours'))
  `).run(groupId, userId);

  // Add other members
  const memberStmt = db.prepare(`
    INSERT OR IGNORE INTO chat_group_members (group_id, user_id, role, joined_at)
    VALUES (?, ?, 'member', datetime('now','+6 hours'))
  `);
  const validMembers = memberIds.filter((id) => Number.isInteger(id) && id !== userId);
  for (const memberId of validMembers) {
    const user = db.prepare('SELECT id FROM users WHERE id = ? AND is_active = 1').get(memberId);
    if (user) memberStmt.run(groupId, memberId);
  }

  audit(req, 'chat.group_create', 'chat_group', groupId, `Created group "${name}" with ${validMembers.length + 1} members`);

  const group = db.prepare(`
    SELECT cg.id, cg.name, cg.description, cg.created_by, cg.created_at, cgm.role AS member_role
    FROM chat_groups cg
    LEFT JOIN chat_group_members cgm ON cg.id = cgm.group_id AND cgm.user_id = ?
    WHERE cg.id = ?
  `).get(userId, groupId);

  res.status(201).json({ group });
});

// Get group details with members
router.get('/groups/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const isUserAdmin = isAdmin(req.user);

  const group = db.prepare('SELECT * FROM chat_groups WHERE id = ? AND is_active = 1').get(id);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  // Check membership (admins can view all groups)
  const membership = db.prepare('SELECT * FROM chat_group_members WHERE group_id = ? AND user_id = ?').get(id, userId);
  if (!membership && !isUserAdmin) {
    return res.status(403).json({ error: 'You are not a member of this group' });
  }

  const currentDate = today();
  const members = db.prepare(`
    SELECT cgm.id, cgm.role, cgm.joined_at,
           u.id AS user_id, u.name, u.email, u.role AS user_role, u.avatar, u.live_status,
           rg.color AS role_group_color
    FROM chat_group_members cgm
    JOIN users u ON cgm.user_id = u.id
    LEFT JOIN role_groups rg ON rg.id = u.role_group_id
    WHERE cgm.group_id = ?
    ORDER BY cgm.role DESC, u.name
  `).all(id).map((m) => {
    const availability = checkUserAvailability(m.user_id, currentDate);
    return {
      ...m,
      availability: {
        available: availability.available,
        reason: availability.reason,
        status: availability.details?.type || null,
      },
    };
  });

  res.json({ group, members, is_admin: isUserAdmin, is_member: !!membership, my_role: membership?.role || null });
});

// Update group (admin/super admin only)
router.put('/groups/:id', requireAuth, requireGroupAdminOrAdmin, (req, res) => {
  const { id } = req.params;
  const { name, description } = req.body || {};

  const group = db.prepare('SELECT * FROM chat_groups WHERE id = ? AND is_active = 1').get(id);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const updates = [];
  const params = [];
  if (name && typeof name === 'string' && name.trim()) {
    if (name.length > 100) return res.status(400).json({ error: 'Group name is too long' });
    updates.push('name = ?');
    params.push(name.trim());
  }
  if (typeof description === 'string') {
    updates.push('description = ?');
    params.push(description.trim());
  }

  if (updates.length > 0) {
    updates.push("updated_at = datetime('now','+6 hours')");
    params.push(Number(id));
    db.prepare(`UPDATE chat_groups SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }

  audit(req, 'chat.group_update', 'chat_group', Number(id), `Updated group`);
  const updated = db.prepare('SELECT * FROM chat_groups WHERE id = ?').get(id);
  res.json({ group: updated });
});

// Add members to group (admin/super admin only)
router.post('/groups/:id/members', requireAuth, requireGroupAdminOrAdmin, (req, res) => {
  const { id } = req.params;
  const { userIds } = req.body || {};

  const group = db.prepare('SELECT * FROM chat_groups WHERE id = ? AND is_active = 1').get(id);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  if (!Array.isArray(userIds) || userIds.length === 0) {
    return res.status(400).json({ error: 'userIds array is required' });
  }

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO chat_group_members (group_id, user_id, role, joined_at)
    VALUES (?, ?, 'member', datetime('now','+6 hours'))
  `);

  let added = 0;
  for (const userId of userIds) {
    if (!Number.isInteger(userId)) continue;
    const user = db.prepare('SELECT id FROM users WHERE id = ? AND is_active = 1').get(userId);
    if (user) {
      const r = stmt.run(Number(id), userId);
      if (r.changes > 0) added++;
    }
  }

  db.prepare("UPDATE chat_groups SET updated_at = datetime('now','+6 hours') WHERE id = ?").run(Number(id));

  audit(req, 'chat.group_add_members', 'chat_group', Number(id), `Added ${added} members to group`);
  res.json({ ok: true, added });
});

// Remove member from group (admin/super admin only)
router.delete('/groups/:id/members/:userId', requireAuth, requireGroupAdminOrAdmin, (req, res) => {
  const { id, userId } = req.params;

  const group = db.prepare('SELECT * FROM chat_groups WHERE id = ? AND is_active = 1').get(id);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  // Don't allow removing the creator
  if (group.created_by === Number(userId)) {
    return res.status(400).json({ error: 'Cannot remove the group creator' });
  }

  const r = db.prepare('DELETE FROM chat_group_members WHERE group_id = ? AND user_id = ?').run(Number(id), Number(userId));
  if (r.changes === 0) {
    return res.status(404).json({ error: 'Member not found in group' });
  }

  db.prepare("UPDATE chat_groups SET updated_at = datetime('now','+6 hours') WHERE id = ?").run(Number(id));

  audit(req, 'chat.group_remove_member', 'chat_group', Number(id), `Removed member ${userId} from group`);
  res.json({ ok: true });
});

// Deactivate group (admin/super admin only) - groups are never deleted, just deactivated
router.post('/groups/:id/deactivate', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;

  const group = db.prepare('SELECT * FROM chat_groups WHERE id = ? AND is_active = 1').get(id);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  db.prepare("UPDATE chat_groups SET is_active = 0, updated_at = datetime('now','+6 hours') WHERE id = ?").run(Number(id));
  audit(req, 'chat.group_deactivate', 'chat_group', Number(id), `Deactivated group`);
  res.json({ ok: true });
});

// Leave group (for regular members)
router.post('/groups/:id/leave', requireAuth, (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const group = db.prepare('SELECT * FROM chat_groups WHERE id = ? AND is_active = 1').get(id);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  // Don't allow creator to leave
  if (group.created_by === userId) {
    return res.status(400).json({ error: 'Group creator cannot leave. Deactivate the group instead.' });
  }

  const r = db.prepare('DELETE FROM chat_group_members WHERE group_id = ? AND user_id = ?').run(Number(id), userId);
  if (r.changes === 0) {
    return res.status(404).json({ error: 'You are not a member of this group' });
  }

  res.json({ ok: true });
});

router.post('/admin/cleanup-old-messages', requireAuth, requireAdmin, (req, res) => {
  const days = Math.max(1, parseInt(req.body?.days) || 30);
  try {
    const deleted = deleteOldMessages(days);
    res.json({ ok: true, deleted, days });
  } catch (err) {
    console.error('[ChatCleanup] API error:', err);
    res.status(500).json({ error: 'Failed to clean up chat messages' });
  }
});

export default router;
