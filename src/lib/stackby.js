// Client-side helper for the Stackby-backed cloud sync.
//
// This does NOT call stackby.com directly — Stackby's API doesn't return
// CORS headers, so a browser fetch() to it fails before it even gets to
// check the API key. Instead every call goes to our own Netlify Function
// (netlify/functions/stackby.js), which makes the real request to Stackby
// server-side and hands the result back.

const FUNCTION_URL = '/.netlify/functions/stackby';

async function callFunction(body) {
  let res;
  try {
    res = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(
      'Could not reach the Netlify function. If you are running "vite dev" locally, use "netlify dev" instead so functions are served — plain Vite does not run them.'
    );
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error(`Function returned a non-JSON response (HTTP ${res.status}).`);
  }

  if (!res.ok) {
    throw new Error(data.error || `Request failed (HTTP ${res.status}).`);
  }
  return data;
}

export async function stackbySet({ apiKey, stackId, tableName, sessionKey, value }) {
  return callFunction({ action: 'set', apiKey, stackId, tableName, sessionKey, value });
}

export async function stackbyGet({ apiKey, stackId, tableName, sessionKey }) {
  const data = await callFunction({ action: 'get', apiKey, stackId, tableName, sessionKey });
  return data.value ?? null;
}

export async function stackbyDelete({ apiKey, stackId, tableName, sessionKey }) {
  return callFunction({ action: 'delete', apiKey, stackId, tableName, sessionKey });
}
