// Netlify Function: proxies Stackby REST calls server-side.
//
// The browser never talks to stackby.com directly (Stackby's API does not
// send back CORS headers, so a fetch() straight from the page fails with a
// CORS error, not a real auth/network error). Instead the frontend posts
// {action, sessionKey, value, ...optional credential overrides} to this
// function, which does the actual HTTPS call to Stackby from Netlify's
// servers and relays the result back.
//
// Credentials: this function prefers Netlify environment variables
// (set in the Netlify UI under Site configuration -> Environment variables,
// or in a local .env file read by `netlify dev`) so the API key never has
// to live in the browser at all:
//   STACKBY_API_KEY
//   STACKBY_STACK_ID
//   STACKBY_TABLE_NAME   (optional, defaults to "AppSessions")
//
// If those aren't set, it falls back to apiKey/stackId/tableName sent in
// the request body — i.e. whatever the user typed into the app's setup
// panel (which the frontend keeps in localStorage). Either way works; env
// vars are just the more secure option since the key isn't exposed to
// client-side code or localStorage.

const STACKBY_BASE = 'https://stackby.com/api/betav1';
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

function resolveCredentials(payload) {
  return {
    apiKey: process.env.STACKBY_API_KEY || payload.apiKey,
    stackId: process.env.STACKBY_STACK_ID || payload.stackId,
    tableName: process.env.STACKBY_TABLE_NAME || payload.tableName || DEFAULT_TABLE,
    usingEnv: Boolean(process.env.STACKBY_API_KEY && process.env.STACKBY_STACK_ID),
  };
}

async function findRowIdByKey({ apiKey, stackId, tableName, sessionKey }) {
  const url = `${STACKBY_BASE}/rowlist/${encodeURIComponent(stackId)}/${encodeURIComponent(tableName)}`;
  const res = await fetch(url, { method: 'GET', headers: authHeaders(apiKey) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Stackby rowlist failed (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const rows = Array.isArray(data) ? data : (data.records || data.rows || []);
  const match = rows.find((r) => r.field && r.field.SessionKey === sessionKey);
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
  const { apiKey, stackId, tableName, usingEnv } = resolveCredentials(payload);

  if (!apiKey || !stackId || !tableName || !sessionKey) {
    return jsonResponse(400, {
      error: 'Missing apiKey, stackId, tableName, or sessionKey (set STACKBY_API_KEY / STACKBY_STACK_ID as env vars, or fill in the setup panel).',
    });
  }

  try {
    if (action === 'get') {
      const url = `${STACKBY_BASE}/rowlist/${encodeURIComponent(stackId)}/${encodeURIComponent(tableName)}`;
      const res = await fetch(url, { method: 'GET', headers: authHeaders(apiKey) });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return jsonResponse(res.status, { error: `Stackby fetch failed (HTTP ${res.status}): ${text.slice(0, 300)}` });
      }
      const data = await res.json();
      const rows = Array.isArray(data) ? data : (data.records || data.rows || []);
      const match = rows.find((r) => r.field && r.field.SessionKey === sessionKey);
      return jsonResponse(200, { value: match ? match.field.Payload : null, usingEnv });
    }

    if (action === 'set') {
      if (typeof value !== 'string') return jsonResponse(400, { error: 'Missing value to store.' });
      const existingId = await findRowIdByKey({ apiKey, stackId, tableName, sessionKey });
      const fieldPayload = { field: { SessionKey: sessionKey, Payload: value } };

      if (existingId) {
        const res = await fetch(`${STACKBY_BASE}/rowupdate/${encodeURIComponent(stackId)}/${encodeURIComponent(tableName)}`, {
          method: 'PATCH',
          headers: authHeaders(apiKey),
          body: JSON.stringify({ records: [{ id: existingId, ...fieldPayload }] }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          return jsonResponse(res.status, { error: `Stackby update failed (HTTP ${res.status}): ${text.slice(0, 300)}` });
        }
        return jsonResponse(200, { ok: true, mode: 'updated', usingEnv });
      } else {
        const res = await fetch(`${STACKBY_BASE}/rowcreate/${encodeURIComponent(stackId)}/${encodeURIComponent(tableName)}`, {
          method: 'POST',
          headers: authHeaders(apiKey),
          body: JSON.stringify({ records: [fieldPayload] }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          return jsonResponse(res.status, { error: `Stackby create failed (HTTP ${res.status}): ${text.slice(0, 300)}` });
        }
        return jsonResponse(200, { ok: true, mode: 'created', usingEnv });
      }
    }

    if (action === 'delete') {
      const existingId = await findRowIdByKey({ apiKey, stackId, tableName, sessionKey });
      if (!existingId) return jsonResponse(200, { deleted: false, usingEnv });
      const res = await fetch(`${STACKBY_BASE}/rowdelete/${encodeURIComponent(stackId)}/${encodeURIComponent(tableName)}`, {
        method: 'DELETE',
        headers: authHeaders(apiKey),
        body: JSON.stringify({ records: [{ id: existingId }] }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return jsonResponse(res.status, { error: `Stackby delete failed (HTTP ${res.status}): ${text.slice(0, 300)}` });
      }
      return jsonResponse(200, { deleted: true, usingEnv });
    }

    return jsonResponse(400, { error: `Unknown action "${action}".` });
  } catch (e) {
    return jsonResponse(500, { error: e.message || 'Unexpected server error.' });
  }
};
