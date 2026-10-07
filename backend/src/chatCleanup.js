import { db } from './db.js';
import path from 'node:path';
import fs from 'node:fs';
import { ATTACHMENT_DIR } from './db.js';

function getAttachmentDir() {
  return ATTACHMENT_DIR;
}

export function deleteOldMessages(days = 30) {
  try {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const cutoffStr = cutoff.toISOString().replace('T', ' ').substring(0, 19);

    const attachmentsToDelete = db.prepare(`
      SELECT ca.stored_name FROM chat_attachments ca
      JOIN chat_messages cm ON ca.message_id = cm.id
      WHERE cm.updated_at < ?
    `).all(cutoffStr);

    const result = db.prepare('DELETE FROM chat_messages WHERE updated_at < ?').run(cutoffStr);

    if (attachmentsToDelete.length > 0) {
      const dir = getAttachmentDir();
      let filesDeleted = 0;
      for (const a of attachmentsToDelete) {
        try {
          const fp = path.join(dir, a.stored_name);
          if (fs.existsSync(fp)) {
            fs.unlinkSync(fp);
            filesDeleted++;
          }
        } catch { /* noop */ }
      }
      if (filesDeleted > 0) {
        console.log(`[ChatCleanup] Deleted ${filesDeleted} orphaned chat attachment files`);
      }
    }

    if (result.changes > 0) {
      console.log(`[ChatCleanup] Deleted ${result.changes} chat messages older than ${days} days`);
    }

    return result.changes;
  } catch (err) {
    console.error('[ChatCleanup] Error cleaning up old chat messages:', err);
    return 0;
  }
}
