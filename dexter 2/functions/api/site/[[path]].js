/* ==========================================================================
   NextLayer — API (Cloudflare Pages Function, catch-all at /api/site/*)
   Public : GET  /content          — published landing content (JSON blob)
            POST /messages         — contact-form inbox (honeypot + rate limit)
            POST /auth/setup       — first-time admin (SETUP_SECRET, one shared
                                     secret that can create OR reset an admin)
            POST /auth/login|logout, GET /auth/me
   Admin  : GET|PUT /admin/content, GET|PUT|DELETE /admin/messages[/id],
            POST /admin/password, GET /admin/stats, CRUD /admin/admins[/id]
   Bindings: D1 database as DB. Secret: SETUP_SECRET (dashboard only).
   ========================================================================== */

const COOKIE = 'nextlayer_session';
const SESSION_DAYS = 7;
const PBKDF2_ITERS = 100000;

/* ---------------- tiny helpers ---------------- */
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
const ok = (data = {}, headers = {}) => json({ ok: true, ...data }, 200, headers);
const err = (message, status = 400) => json({ ok: false, error: message }, status);
const clean = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const nowIso = () => new Date().toISOString();
const te = new TextEncoder();

function b64encode(bytes) {
  let s = '';
  bytes.forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s);
}
function b64decode(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
async function sha256hex(text) {
  const d = await crypto.subtle.digest('SHA-256', te.encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERS, hash: 'SHA-256' }, key, 256);
  return 'pbkdf2$' + PBKDF2_ITERS + '$' + b64encode(salt) + '$' + b64encode(new Uint8Array(bits));
}
async function verifyPassword(password, stored) {
  try {
    const parts = String(stored).split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
    const key = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: b64decode(parts[2]), iterations: parseInt(parts[1], 10), hash: 'SHA-256' },
      key, 256);
    const a = b64encode(new Uint8Array(bits));
    const b = parts[3];
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  } catch (e) { return false; }
}
function getCookies(req) {
  const out = {};
  const h = req.headers.get('Cookie') || '';
  h.split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) {
      const k = p.slice(0, i).trim();
      const rawV = p.slice(i + 1).trim();
      try { out[k] = decodeURIComponent(rawV); }
      catch (e) { out[k] = rawV; } // malformed cookie value — keep raw, don't 500
    }
  });
  return out;
}
function sessionCookie(token, opts = {}) {
  const parts = [COOKIE + '=' + token, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (opts.maxAge != null) parts.push('Max-Age=' + opts.maxAge);
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}
const clearCookie = (secure) =>
  COOKIE + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' + (secure ? '; Secure' : '');
function isHttps(req) {
  try {
    if (new URL(req.url).protocol === 'https:') return true;
  } catch (e) { /* ignore */ }
  const fwd = req.headers.get('X-Forwarded-Proto') || '';
  return fwd.split(',')[0].trim() === 'https';
}
function clientIp(req) {
  return req.headers.get('CF-Connecting-IP') ||
    (req.headers.get('X-Forwarded-For') || '').split(',')[0].trim() || 'unknown';
}
function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || '')); }
async function getBody(req) {
  try { return await req.json(); } catch (e) { return {}; }
}
async function rateLimit(db, key, limit, windowSec) {
  const now = Date.now();
  let row = null;
  try { row = await db.prepare('SELECT count, reset_at FROM rate_limits WHERE key = ?').bind(key).first(); }
  catch (e) { return true; } // fail open if table missing; schema ensure runs on write paths
  const resetMs = row ? Date.parse(row.reset_at) : NaN;
  if (!row || isNaN(resetMs) || now >= resetMs) {
    try {
      await db.prepare(
        'INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET count = 1, reset_at = excluded.reset_at'
      ).bind(key, new Date(now + windowSec * 1000).toISOString()).run();
    } catch (e) { /* ignore */ }
    return true;
  }
  if (row.count >= limit) return false;
  try { await db.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?').bind(key).run(); }
  catch (e) { /* ignore */ }
  return true;
}
/* Self-heal: create tables if a deploy skipped the migration step. Only runs
   on write paths (contact / setup / content save), single batched round-trip. */
async function ensureSchema(db) {
  const stmts = [
    db.prepare("CREATE TABLE IF NOT EXISTS site_content (id INTEGER PRIMARY KEY CHECK (id = 1), content TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))"),
    db.prepare("CREATE TABLE IF NOT EXISTS contact_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL, company TEXT NOT NULL DEFAULT '', message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))"),
    db.prepare("CREATE TABLE IF NOT EXISTS admin_users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))"),
    db.prepare("CREATE TABLE IF NOT EXISTS admin_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))"),
    db.prepare('CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0, reset_at TEXT NOT NULL)'),
    db.prepare("INSERT OR IGNORE INTO site_content (id, content) VALUES (1, '{}')"),
  ];
  await db.batch(stmts);
}
async function currentUser(req, db) {
  const raw = getCookies(req)[COOKIE];
  if (!raw) return null;
  let row = null;
  try {
    row = await db.prepare(
      'SELECT u.id, u.email, u.active, s.expires_at FROM admin_sessions s ' +
      'JOIN admin_users u ON u.id = s.admin_id WHERE s.token_hash = ?'
    ).bind(await sha256hex(raw)).first();
  } catch (e) { return null; }
  if (!row || row.active !== 1) return null;
  if (Date.parse(row.expires_at) <= Date.now()) {
    try { await db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').bind(await sha256hex(raw)).run(); }
    catch (e) { /* ignore */ }
    return null;
  }
  return { id: row.id, email: row.email };
}

/* ---------------- router ---------------- */
export async function onRequest(context) {
  try {
    return await handleRequest(context);
  } catch (e) {
    return err('Something went wrong. Please try again.', 500);
  }
}
async function handleRequest({ request, env, params }) {
  const db = env.DB;
  if (!db) return err('Database not configured.', 500);
  const method = request.method.toUpperCase();
  const path = ((params && params.path) || []).join('/');

  /* ----- public: published content ----- */
  if (path === 'content' && method === 'GET') {
    let content = {};
    try {
      const row = await db.prepare('SELECT content FROM site_content WHERE id = 1').first();
      if (row && row.content) content = JSON.parse(row.content);
    } catch (e) { /* landing falls back to built-in defaults */ }
    return ok({ content });
  }

  /* ----- public: contact form ----- */
  if (path === 'messages' && method === 'POST') {
    try { await ensureSchema(db); } catch (e) { /* ignore */ }
    const ip = clientIp(request);
    if (!(await rateLimit(db, 'contact:' + ip, 5, 600)))
      return err('Too many messages — please try again later.', 429);
    const b = await getBody(request);
    if (b.website) return ok({ received: true }); // honeypot: pretend success
    const name = clean(b.name, 120);
    const email = clean(b.email, 160);
    const company = clean(b.company, 160);
    const message = clean(b.message, 5000);
    if (!name || !email || !message) return err('Name, email and message are required.');
    if (!validEmail(email)) return err('Please enter a valid email address.');
    await db.prepare(
      'INSERT INTO contact_messages (name, email, company, message) VALUES (?, ?, ?, ?)'
    ).bind(name, email, company, message).run();
    return ok({ received: true });
  }

  /* ----- auth: first-time setup (create OR reset an admin) ----- */
  if (path === 'auth/setup' && method === 'POST') {
    const secret = env.SETUP_SECRET;
    if (!secret) return err('Setup is disabled — no SETUP_SECRET configured.', 404);
    try { await ensureSchema(db); } catch (e) { /* ignore */ }
    const ip = clientIp(request);
    if (!(await rateLimit(db, 'setup:' + ip, 10, 900)))
      return err('Too many attempts — try again later.', 429);
    const b = await getBody(request);
    const given = String(b.setup_key ?? '');
    let diff = given.length === secret.length ? 0 : 1;
    const n = Math.max(given.length, secret.length);
    for (let i = 0; i < n; i++) diff |= (given.charCodeAt(i) || 0) ^ (secret.charCodeAt(i) || 0);
    if (diff !== 0) return err('Incorrect setup secret.', 403);
    const email = clean(b.email, 160).toLowerCase();
    const password = String(b.password ?? '');
    if (!validEmail(email)) return err('Please enter a valid email address.');
    if (password.length < 10) return err('Password must be at least 10 characters.');
    const hash = await hashPassword(password);
    const existing = await db.prepare('SELECT id FROM admin_users WHERE email = ?').bind(email).first();
    if (existing) {
      await db.prepare('UPDATE admin_users SET password_hash = ?, active = 1 WHERE id = ?')
        .bind(hash, existing.id).run();
      await db.prepare('DELETE FROM admin_sessions WHERE admin_id = ?').bind(existing.id).run();
    } else {
      await db.prepare('INSERT INTO admin_users (email, password_hash) VALUES (?, ?)')
        .bind(email, hash).run();
    }
    return ok({ setup: true });
  }

  /* ----- auth: login ----- */
  if (path === 'auth/login' && method === 'POST') {
    const ip = clientIp(request);
    if (!(await rateLimit(db, 'login:' + ip, 8, 900)))
      return err('Too many attempts — try again later.', 429);
    const b = await getBody(request);
    const email = clean(b.email, 160).toLowerCase();
    const password = String(b.password ?? '');
    let user = null;
    try {
      user = await db.prepare('SELECT id, email, password_hash, active FROM admin_users WHERE email = ?')
        .bind(email).first();
    } catch (e) { /* table missing -> fall through to generic error */ }
    if (!user || user.active !== 1 || !(await verifyPassword(password, user.password_hash))) {
      await hashPassword('dummy:' + Math.random()); // burn time, avoid user enumeration
      return err('Invalid email or password.', 401);
    }
    const token = [...crypto.getRandomValues(new Uint8Array(32))]
      .map((x) => x.toString(16).padStart(2, '0')).join('');
    const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
    await db.prepare('INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES (?, ?, ?)')
      .bind(user.id, await sha256hex(token), expires).run();
    try { await db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').bind(nowIso()).run(); }
    catch (e) { /* ignore */ }
    return ok(
      { user: { id: user.id, email: user.email } },
      { 'Set-Cookie': sessionCookie(token, { maxAge: SESSION_DAYS * 86400, secure: isHttps(request) }) }
    );
  }

  /* ----- auth: logout ----- */
  if (path === 'auth/logout' && method === 'POST') {
    const raw = getCookies(request)[COOKIE];
    if (raw) {
      try { await db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').bind(await sha256hex(raw)).run(); }
      catch (e) { /* ignore */ }
    }
    return ok({}, { 'Set-Cookie': clearCookie(isHttps(request)) });
  }

  /* ----- auth: me ----- */
  if (path === 'auth/me' && method === 'GET') {
    const user = await currentUser(request, db);
    if (!user) return err('Not signed in.', 401);
    return ok({ user });
  }

  /* ----- admin (session required) ----- */
  if (path === 'admin' || path.startsWith('admin/')) {
    const user = await currentUser(request, db);
    if (!user) return err('Unauthorized.', 401);

    if (path === 'admin/content' && method === 'GET') {
      let content = {};
      try {
        const row = await db.prepare('SELECT content FROM site_content WHERE id = 1').first();
        if (row && row.content) content = JSON.parse(row.content);
      } catch (e) { /* ignore */ }
      return ok({ content });
    }
    if (path === 'admin/content' && method === 'PUT') {
      try { await ensureSchema(db); } catch (e) { /* ignore */ }
      const len = parseInt(request.headers.get('Content-Length') || '0', 10);
      if (len > 600000) return err('Content too large (500 KB max).');
      const b = await getBody(request);
      if (!b.content || typeof b.content !== 'object' || Array.isArray(b.content))
        return err('Missing content object.');
      const s = JSON.stringify(b.content);
      if (s.length > 500000) return err('Content too large (500 KB max).');
      await db.prepare(
        'INSERT INTO site_content (id, content, updated_at) VALUES (1, ?, ?) ' +
        'ON CONFLICT(id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at'
      ).bind(s, nowIso()).run();
      return ok({ saved: true });
    }
    if (path === 'admin/messages' && method === 'GET') {
      const url = new URL(request.url);
      const status = url.searchParams.get('status') || 'all';
      let rows;
      if (status === 'all') {
        rows = await db.prepare('SELECT * FROM contact_messages ORDER BY id DESC LIMIT 200').all();
      } else {
        rows = await db.prepare('SELECT * FROM contact_messages WHERE status = ? ORDER BY id DESC LIMIT 200')
          .bind(status).all();
      }
      return ok({ messages: (rows && rows.results) || [] });
    }
    const msgMatch = path.match(/^admin\/messages\/(\d+)$/);
    if (msgMatch && (method === 'PUT' || method === 'DELETE')) {
      const id = parseInt(msgMatch[1], 10);
      if (method === 'DELETE') {
        await db.prepare('DELETE FROM contact_messages WHERE id = ?').bind(id).run();
        return ok({ deleted: true });
      }
      const b = await getBody(request);
      const status = String(b.status || '');
      if (status !== 'new' && status !== 'read' && status !== 'archived')
        return err('Invalid status.');
      await db.prepare('UPDATE contact_messages SET status = ? WHERE id = ?').bind(status, id).run();
      return ok({ updated: true });
    }
    if (path === 'admin/password' && method === 'POST') {
      const b = await getBody(request);
      const row = await db.prepare('SELECT password_hash FROM admin_users WHERE id = ?').bind(user.id).first();
      if (!row || !(await verifyPassword(String(b.current_password ?? ''), row.password_hash)))
        return err('Current password is incorrect.', 403);
      const next = String(b.new_password ?? '');
      if (next.length < 10) return err('New password must be at least 10 characters.');
      await db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?')
        .bind(await hashPassword(next), user.id).run();
      // revoke every other session, keep this one signed in
      const raw = getCookies(request)[COOKIE];
      const keep = raw ? await sha256hex(raw) : '';
      await db.prepare('DELETE FROM admin_sessions WHERE admin_id = ? AND token_hash != ?')
        .bind(user.id, keep).run();
      return ok({ updated: true });
    }
    if (path === 'admin/stats' && method === 'GET') {
      let m = null;
      let a = null;
      try {
        m = await db.prepare("SELECT COUNT(*) AS c FROM contact_messages WHERE status = 'new'").first();
        a = await db.prepare('SELECT COUNT(*) AS c FROM admin_users WHERE active = 1').first();
      } catch (e) { /* tables missing — counts stay zero */ }
      let content = {};
      let updated = null;
      try {
        const row = await db.prepare('SELECT content, updated_at FROM site_content WHERE id = 1').first();
        if (row) {
          updated = row.updated_at || null;
          try { content = JSON.parse(row.content); } catch (e) { /* ignore */ }
        }
      } catch (e) { /* ignore */ }
      const n = (v) => (Array.isArray(v) ? v.length : 0);
      return ok({
        new_messages: (m && m.c) || 0,
        admins: (a && a.c) || 0,
        projects: n(content.work && content.work.items),
        services: n(content.services && content.services.items),
        faqs: n(content.faq && content.faq.items),
        content_updated_at: updated,
      });
    }
    if (path === 'admin/admins' && method === 'GET') {
      const rows = await db.prepare(
        'SELECT id, email, active, created_at FROM admin_users ORDER BY id ASC').all();
      return ok({ admins: (rows && rows.results) || [] });
    }
    if (path === 'admin/admins' && method === 'POST') {
      const b = await getBody(request);
      const email = clean(b.email, 160).toLowerCase();
      const password = String(b.password ?? '');
      if (!validEmail(email)) return err('Please enter a valid email address.');
      if (password.length < 10) return err('Password must be at least 10 characters.');
      try {
        await db.prepare('INSERT INTO admin_users (email, password_hash) VALUES (?, ?)')
          .bind(email, await hashPassword(password)).run();
      } catch (e) { return err('That email is already an admin.'); }
      return ok({ created: true });
    }
    const admMatch = path.match(/^admin\/admins\/(\d+)$/);
    if (admMatch && (method === 'PUT' || method === 'DELETE')) {
      const id = parseInt(admMatch[1], 10);
      if (method === 'DELETE') {
        if (id === user.id) return err('You cannot delete your own account.');
        await db.prepare('DELETE FROM admin_sessions WHERE admin_id = ?').bind(id).run();
        await db.prepare('DELETE FROM admin_users WHERE id = ?').bind(id).run();
        return ok({ deleted: true });
      }
      const b = await getBody(request);
      const patch = [];
      const args = [];
      if (b.email !== undefined) {
        const email = clean(b.email, 160).toLowerCase();
        if (!validEmail(email)) return err('Please enter a valid email address.');
        patch.push('email = ?');
        args.push(email);
      }
      if (b.password) {
        if (String(b.password).length < 10) return err('Password must be at least 10 characters.');
        patch.push('password_hash = ?');
        args.push(await hashPassword(String(b.password)));
      }
      if (b.active !== undefined) {
        if (id === user.id && !b.active) return err('You cannot deactivate your own account.');
        patch.push('active = ?');
        args.push(b.active ? 1 : 0);
      }
      if (!patch.length) return err('Nothing to update.');
      args.push(id);
      try {
        await db.prepare('UPDATE admin_users SET ' + patch.join(', ') + ' WHERE id = ?')
          .bind(...args).run();
      } catch (e) { return err('That email is already an admin.'); }
      return ok({ updated: true });
    }
    return err('Not found.', 404);
  }

  return err('Not found.', 404);
}
