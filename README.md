# json/extract

A React + Vite port of the JSON extract/trim tool, deployable to Netlify.
Cloud sync now uses **Stackby** instead of Upstash.

## Run locally

Cloud sync goes through a Netlify Function (`netlify/functions/stackby.js`),
which plain `vite dev` does not serve. Use the Netlify CLI for local dev so
functions work too:

```bash
npm install -g netlify-cli   # once
npm install
netlify dev
```

`vite dev` on its own still works for everything except cloud sync (it'll
fall back to localStorage and the footer will say the function couldn't be
reached).

## Build

```bash
npm run build
```

Outputs to `dist/`.

## Deploy to Netlify

Two options:

1. **Netlify CLI**
   ```bash
   npm install -g netlify-cli
   netlify deploy --prod
   ```
2. **Git-based deploy** — push this folder to a GitHub repo and connect it in
   the Netlify dashboard. `netlify.toml` already sets the build command
   (`npm run build`) and publish directory (`dist`).

No environment variables are required at build time — the Stackby
credentials are entered by the user at runtime in the app's own "Stackby
Cloud Storage Setup" panel and stored only in that browser's `localStorage`.
They're sent to Netlify's own `/.netlify/functions/stackby` endpoint, which
then talks to Stackby server-side (see "Why a function?" below).

### Why a function?

A direct browser `fetch()` to `stackby.com` fails with a CORS error before
the request result (auth, data, anything) is even visible to the page —
Stackby's API isn't set up to be called from arbitrary websites' JavaScript.
Routing the call through a Netlify Function sidesteps that: the browser
talks to your own domain (which Netlify always allows), and the function
does the real HTTPS call to Stackby from the server side, where CORS
doesn't apply.

## Setting up Stackby as the database

The app emulates a simple key/value store on top of a normal Stackby table
(Stackby itself is a spreadsheet-style database, so this is the closest
analog to Upstash's `SET`/`GET`).

1. Create a Stack in Stackby (or use an existing one) and note its **Stack
   ID** — it's the string in the Stackby URL right after `/`, e.g.
   `stackby.com/{stackId}/...`.
2. Inside that stack, create a table (default name expected: `AppSessions`,
   but you can call it anything and enter it in the app) with exactly two
   columns:
   - `SessionKey` — single line text
   - `Payload` — long text
3. Generate a Stackby **API key** from your account settings.
4. In the app's "Stackby Cloud Storage Setup" panel, paste in:
   - API Key
   - Stack ID
   - Table name (matching what you created)
5. The app autosaves your workspace tabs to that table ~700ms after you stop
   typing, using one row keyed by a fixed session key. "Force Fetch from
   Cloud" pulls the latest saved row back down (handy for syncing across
   devices/browsers). If Stackby isn't configured, the app transparently
   falls back to `localStorage` in the current browser.

## What changed from the original single-file version

- Split into a proper Vite/React project (`src/App.jsx`, `src/lib/*.js`)
  instead of one big HTML file with inline `<script>`.
- `netlify/functions/stackby.js` is a Netlify Function that does the actual
  Stackby REST calls (row lookup by `SessionKey`, then
  `rowupdate`/`rowcreate`/`rowdelete`) — added after direct browser calls to
  Stackby failed on CORS.
- `src/lib/stackby.js` now just posts `{action, apiKey, stackId, tableName,
  sessionKey, value}` to that function and relays the response; it no
  longer talks to `stackby.com` itself.
- Removed the placeholder hardcoded credential constants from the original
  file — credentials are only ever the ones you type into the setup panel.
- All the JSON-wrangling logic (span detection, nested array discovery,
  keyword search, positional/keyword trimming, date-based sort) is ported
  as-is into `src/lib/jsonTools.js`.
