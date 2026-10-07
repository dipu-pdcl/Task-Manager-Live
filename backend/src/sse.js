// Real-time Server-Sent Events (SSE) manager
const clients = new Map(); // userId -> Set<Response>

export function addSSEClient(userId, res) {
  const uid = Number(userId);
  if (!clients.has(uid)) {
    clients.set(uid, new Set());
  }
  clients.get(uid).add(res);
}

export function removeSSEClient(userId, res) {
  const uid = Number(userId);
  if (clients.has(uid)) {
    const set = clients.get(uid);
    set.delete(res);
    if (set.size === 0) {
      clients.delete(uid);
    }
  }
}

export function broadcastToUser(userId, eventName, data) {
  const uid = Number(userId);
  const set = clients.get(uid);
  if (!set || set.size === 0) return;

  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try {
      res.write(payload);
    } catch {
      // client connection likely terminated
    }
  }
}

export function broadcastToAll(eventName, data) {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [, set] of clients) {
    for (const res of set) {
      try {
        res.write(payload);
      } catch {
        // client connection likely terminated
      }
    }
  }
}
