// Netlify Function: proxies Stackby REST calls server-side.
const STACKBY_BASE = 'https://api.stackby.com/api/v1';
const DEFAULT_TABLE = 'AppSessions';

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function authHeaders(apiKey) {
  return { 'api-key': apiKey, 'Content-Type': 'application/json' };
}

async function findRowIdByKey({ apiKey, stackId, tableName, sessionKey }) {
  const url = `${STACKBY_BASE}/rowlist/${encodeURIComponent(stackId)}/${encodeURIComponent(tableName)}`;
  const res = await fetch(url, { method: 'GET', headers: authHeaders(apiKey) });
  
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Stackby rowlist failed (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  
  const rows = await res.json();
  if (!Array.isArray(rows)) return null;
  
  // Stackby returns columns as flat top-level properties alongside the 'id'
  const match = rows.find((r) => r && r.SessionKey === sessionKey);
  return match ? match.id : null;
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed, use POST.' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return jsonResponse(400, { error: 'Invalid JSON body.' });
  }

  const { action, sessionKey, value } = payload;

  const apiKey = process.env.STACKBY_API_KEY;
  const stackId = process.env.STACKBY_STACK_ID;
  const tableName = process.env.STACKBY_TABLE_NAME || DEFAULT_TABLE;

  if (!apiKey || !stackId) {
    return jsonResponse(200, { configured: false });
  }

  if (!sessionKey) {
    return jsonResponse(400, { error: 'Missing sessionKey.' });
  }

  try {
    // --- GET ACTION ---
    if (action === 'get') {
      const url = `${STACKBY_BASE}/rowlist/${encodeURIComponent(stackId)}/${encodeURIComponent(tableName)}`;
      const res = await fetch(url, { method: 'GET', headers: authHeaders(apiKey) });
      
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return jsonResponse(res.status, { error: `Stackby fetch failed (HTTP ${res.status}): ${text.slice(0, 300)}` });
      }
      
      const rows = await res.json();
      const match = Array.isArray(rows) ? rows.find((r) => r && r.SessionKey === sessionKey) : null;
      
      return jsonResponse(200, { configured: true, value: match ? match.Payload : null });
    }

    // --- SET ACTION ---
    if (action === 'set') {
      if (typeof value !== 'string') return jsonResponse(400, { error: 'Missing value to store.' });
      
      const existingId = await findRowIdByKey({ apiKey, stackId, tableName, sessionKey });

      if (existingId) {
        // Update expects a flat array of objects containing the target id
        const res = await fetch(`${STACKBY_BASE}/rowupdate/${encodeURIComponent(stackId)}/${encodeURIComponent(tableName)}`, {
          method: 'POST',
          headers: authHeaders(apiKey),
          body: JSON.stringify([{ id: existingId, SessionKey: sessionKey, Payload: value }]),
        });
        
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          return jsonResponse(res.status, { error: `Stackby update failed (HTTP ${res.status}): ${text.slice(0, 300)}` });
        }
        return jsonResponse(200, { configured: true, ok: true, mode: 'updated' });
      } else {
        // Create expects a flat array of objects with column values
        const res = await fetch(`${STACKBY_BASE}/rowcreate/${encodeURIComponent(stackId)}/${encodeURIComponent(tableName)}`, {
          method: 'POST',
          headers: authHeaders(apiKey),
          body: JSON.stringify([{ SessionKey: sessionKey, Payload: value }]),
        });
        
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          return jsonResponse(res.status, { error: `Stackby create failed (HTTP ${res.status}): ${text.slice(0, 300)}` });
        }
        return jsonResponse(200, { configured: true, ok: true, mode: 'created' });
      }
    }

    // --- DELETE ACTION ---
    if (action === 'delete') {
      const existingId = await findRowIdByKey({ apiKey, stackId, tableName, sessionKey });
      if (!existingId) return jsonResponse(200, { configured: true, deleted: false });
      
      // Delete expects a flat array of row IDs directly
      const res = await fetch(`${STACKBY_BASE}/rowdelete/${encodeURIComponent(stackId)}/${encodeURIComponent(tableName)}`, {
        method: 'POST',
        headers: authHeaders(apiKey),
        body: JSON.stringify([existingId]),
      });
      
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return jsonResponse(res.status, { error: `Stackby delete failed (HTTP ${res.status}): ${text.slice(0, 300)}` });
      }
      return jsonResponse(200, { configured: true, deleted: true });
    }

    return jsonResponse(400, { error: `Unknown action "${action}".` });
  } catch (e) {
    return jsonResponse(500, { error: e.message || 'Unexpected server error.' });
  }
};
