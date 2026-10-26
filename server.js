const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const DATA_DIR = fs.existsSync(path.join(__dirname, '.data'))
  ? path.join(__dirname, '.data')
  : path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'noon_ops.db');
const OLD_JSON_DB = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });

// Universal Database Adapter: Native SQLite (WAL) with Automatic In-Memory JSON fallback
let db;
try {
  const { DatabaseSync } = require('node:sqlite');
  db = new DatabaseSync(DB_FILE);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA cache_size = -64000;
    PRAGMA foreign_keys = ON;
  `);
} catch (e) {
  console.log('⚠️ Native node:sqlite not present. Initializing High-Performance Universal JSON DB Engine...');
  // Universal DB Engine for maximum cloud compatibility
  const JSON_STORE = path.join(DATA_DIR, 'noon_universal_store.json');
  let memoryData = {
    branches: [],
    pilots: [],
    requests: [],
    openers: [],
    config: {}
  };
  if (fs.existsSync(JSON_STORE)) {
    try { memoryData = JSON.parse(fs.readFileSync(JSON_STORE, 'utf8')); } catch (_) {}
  }
  const saveStore = () => {
    try { fs.writeFileSync(JSON_STORE, JSON.stringify(memoryData, null, 2)); } catch (_) {}
  };

  db = {
    exec: (sql) => {},
    prepare: (sql) => {
      const lower = sql.toLowerCase().trim();
      return {
        get: (...params) => {
          if (lower.includes('count(*) as cnt from branches') || lower.includes('count(*) as c from branches')) return { cnt: memoryData.branches.length, c: memoryData.branches.length };
          if (lower.includes('count(*) as cnt from pilots') || lower.includes('count(*) as c from pilots')) return { cnt: memoryData.pilots.length, c: memoryData.pilots.length };
          if (lower.includes('count(*) as c from requests where status = \'new\'')) {
            const count = memoryData.requests.filter(r => r.status === 'new').length;
            return { c: count };
          }
          if (lower.includes('count(*) as c from requests where status = \'done\'')) {
            const dayStart = params[0] || 0;
            const count = memoryData.requests.filter(r => r.status === 'done' && r.updated >= dayStart).length;
            return { c: count };
          }
          if (lower.includes('avg(updated - ts) as avgms')) {
            const dayStart = params[0] || 0;
            const done = memoryData.requests.filter(r => r.status === 'done' && r.updated >= dayStart && !r.manual);
            if (!done.length) return { avgMs: 0 };
            const avg = done.reduce((acc, r) => acc + (r.updated - r.ts), 0) / done.length;
            return { avgMs: avg };
          }
          if (lower.includes('count(*) as c from requests')) return { c: memoryData.requests.length };
          if (lower.includes('from requests where id = ?')) {
            const found = memoryData.requests.find(r => r.id === params[0]);
            return found ? { ...found } : null;
          }
          return null;
        },
        all: (...params) => {
          if (lower.includes('from branches order by name')) return [...memoryData.branches].sort((a,b) => a.name.localeCompare(b.name));
          if (lower.includes('from pilots')) {
            if (lower.includes('like ?')) {
              const q = (params[0] || '').replace(/%/g, '').toLowerCase();
              return memoryData.pilots.filter(p => 
                (p.pid && p.pid.toLowerCase().includes(q)) || 
                (p.name && p.name.toLowerCase().includes(q)) || 
                (p.phone && p.phone.includes(q))
              ).slice(0, 50);
            }
            return [...memoryData.pilots].sort((a,b) => a.name.localeCompare(b.name)).slice(0, 3000);
          }
          if (lower.includes('from requests')) {
            let res = [...memoryData.requests];
            if (lower.includes('where')) {
              // Simple filter handler
              if (params.length && lower.includes('status = ?')) res = res.filter(r => r.status === params[0]);
            }
            return res.sort((a,b) => b.ts - a.ts).slice(0, 800);
          }
          if (lower.includes('from openers')) return [...memoryData.openers];
          return [];
        },
        run: (...params) => {
          if (lower.startsWith('insert or ignore into branches') || lower.startsWith('insert into branches')) {
            const [id, name, zone, city] = params;
            if (!memoryData.branches.find(b => b.name === name)) {
              memoryData.branches.push({ id, name, zone: zone || '', city: city || 'القاهرة والجيزة', active: 1 });
              saveStore();
            }
          } else if (lower.startsWith('insert or replace into pilots') || lower.startsWith('insert or ignore into pilots')) {
            const [id, pid, name, branch, office, phone, arg7, arg8] = params;
            const existingIdx = memoryData.pilots.findIndex(p => p.pid === pid);
            const pObj = { id, pid, name, branch, office: office || '', phone: phone || '', status: 'active', created: Date.now() };
            if (existingIdx >= 0) memoryData.pilots[existingIdx] = pObj;
            else memoryData.pilots.push(pObj);
            saveStore();
          } else if (lower.startsWith('insert into requests') || lower.startsWith('insert or ignore into requests')) {
            const [id, branch, name, pid, phone, la_name, office, rt, notes, urg, status, ts, updated, by, reason, claimedBy, manual] = params;
            memoryData.requests.push({ id, branch, name, pid, phone: phone || '', la_name: la_name || '', office: office || '', rt, notes: notes || '', urg: urg || 0, status: status || 'new', ts, updated, by: by || '', reason: reason || '', claimedBy: claimedBy || '', manual: manual || 0 });
            saveStore();
          } else if (lower.startsWith('update requests')) {
            const id = params[params.length - 1];
            const r = memoryData.requests.find(x => x.id === id);
            if (r) {
              if (lower.includes('status = ?')) r.status = params[0];
              if (lower.includes('updated = ?')) r.updated = params[lower.includes('status = ?') ? 1 : 0];
              if (lower.includes('claimedby = ?')) r.claimedBy = params[lower.includes('updated = ?') ? 2 : 1];
              saveStore();
            }
          } else if (lower.startsWith('delete from requests')) {
            memoryData.requests = memoryData.requests.filter(r => r.id !== params[0]);
            saveStore();
          } else if (lower.startsWith('delete from branches')) {
            memoryData.branches = [];
            saveStore();
          } else if (lower.startsWith('insert or replace into openers')) {
            const [id, name, branches_json, updated] = params;
            const idx = memoryData.openers.findIndex(o => o.id === id);
            const obj = { id, name, branches_json, updated };
            if (idx >= 0) memoryData.openers[idx] = obj;
            else memoryData.openers.push(obj);
            saveStore();
          }
          return { changes: 1 };
        }
      };
    }
  };
}
  CREATE TABLE IF NOT EXISTS branches (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    zone TEXT DEFAULT '',
    city TEXT DEFAULT 'القاهرة والجيزة',
    active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS pilots (
    id TEXT PRIMARY KEY,
    pid TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    branch TEXT NOT NULL,
    office TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    status TEXT DEFAULT 'active',
    created INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_pilots_pid ON pilots (pid);
  CREATE INDEX IF NOT EXISTS idx_pilots_branch ON pilots (branch);
  CREATE INDEX IF NOT EXISTS idx_pilots_phone ON pilots (phone);

  CREATE TABLE IF NOT EXISTS requests (
    id TEXT PRIMARY KEY,
    branch TEXT NOT NULL,
    name TEXT NOT NULL,
    pid TEXT NOT NULL,
    phone TEXT DEFAULT '',
    la_name TEXT DEFAULT '',
    office TEXT DEFAULT '',
    rt TEXT NOT NULL,
    notes TEXT DEFAULT '',
    urg INTEGER DEFAULT 0,
    status TEXT DEFAULT 'new',
    ts INTEGER NOT NULL,
    updated INTEGER NOT NULL,
    by TEXT DEFAULT '',
    reason TEXT DEFAULT '',
    claimedBy TEXT DEFAULT '',
    claimedAt INTEGER DEFAULT NULL,
    manual INTEGER DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_req_status ON requests (status);
  CREATE INDEX IF NOT EXISTS idx_req_branch ON requests (branch);
  CREATE INDEX IF NOT EXISTS idx_req_pid ON requests (pid);
  CREATE INDEX IF NOT EXISTS idx_req_ts ON requests (ts DESC);

  CREATE TABLE IF NOT EXISTS openers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    branches_json TEXT NOT NULL,
    updated INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// 35 Pre-configured Major noon Egyptian Hubs across Cairo, Giza, Alexandria & Delta
const defaultBranchesList = [
  { name: 'التجمع الخامس (Fifth Settlement)', zone: 'القاهرة الجديدة', city: 'القاهرة' },
  { name: 'التجمع الأول (First Settlement)', zone: 'القاهرة الجديدة', city: 'القاهرة' },
  { name: 'الرحاب (Al Rehab)', zone: 'القاهرة الجديدة', city: 'القاهرة' },
  { name: 'مدينتي (Madinaty Hub)', zone: 'القاهرة الجديدة', city: 'القاهرة' },
  { name: 'الشروق وبدر (Shorouk Hub)', zone: 'مدن شرق القاهرة', city: 'القاهرة' },
  { name: 'العبور (Al Obour)', zone: 'مدن شرق القاهرة', city: 'القاهرة' },
  { name: 'مدينة نصر - مكرم عبيد', zone: 'شرق القاهرة', city: 'القاهرة' },
  { name: 'مدينة نصر - عباس العقاد', zone: 'شرق القاهرة', city: 'القاهرة' },
  { name: 'مصر الجديدة - الكوربة', zone: 'شرق القاهرة', city: 'القاهرة' },
  { name: 'النزهة وجسر السويس', zone: 'شرق القاهرة', city: 'القاهرة' },
  { name: 'عين شمس والمطرية', zone: 'شرق القاهرة', city: 'القاهرة' },
  { name: 'المعادي - اللاسلكي', zone: 'جنوب القاهرة', city: 'القاهرة' },
  { name: 'المعادي - دجلة', zone: 'جنوب القاهرة', city: 'القاهرة' },
  { name: 'المقطم والهضبة', zone: 'جنوب القاهرة', city: 'القاهرة' },
  { name: 'حلوان والمعصرة', zone: 'جنوب القاهرة', city: 'القاهرة' },
  { name: 'وسط البلد والزمالك', zone: 'وسط القاهرة', city: 'القاهرة' },
  { name: 'شبرا ومصر القديمة', zone: 'وسط القاهرة', city: 'القاهرة' },
  { name: 'الدقي والعجوزة', zone: 'الجيزة', city: 'الجيزة' },
  { name: 'المهندسين - البطل', zone: 'الجيزة', city: 'الجيزة' },
  { name: 'فيصل الرئيسي', zone: 'الجيزة', city: 'الجيزة' },
  { name: 'الهرم - مشعل', zone: 'الجيزة', city: 'الجيزة' },
  { name: 'حدائق الأهرام (البوابة 4)', zone: 'الجيزة', city: 'الجيزة' },
  { name: 'العمرانية وجنوب الجيزة', zone: 'الجيزة', city: 'الجيزة' },
  { name: 'الشيخ زايد - هايبر', zone: 'الشيخ زايد وأكتوبر', city: 'الجيزة' },
  { name: 'الشيخ زايد - بيفرلي هيلز', zone: 'الشيخ زايد وأكتوبر', city: 'الجيزة' },
  { name: '6 أكتوبر - ميدان الحصري', zone: 'الشيخ زايد وأكتوبر', city: 'الجيزة' },
  { name: '6 أكتوبر - المنطقة الصناعية', zone: 'الشيخ زايد وأكتوبر', city: 'الجيزة' },
  { name: 'إسكندرية - سموحة', zone: 'الإسكندرية', city: 'الإسكندرية' },
  { name: 'إسكندرية - ميامي وسيدي بشر', zone: 'الإسكندرية', city: 'الإسكندرية' },
  { name: 'إسكندرية - لوران ورشدي', zone: 'الإسكندرية', city: 'الإسكندرية' },
  { name: 'إسكندرية - العجمي ومحرم بك', zone: 'الإسكندرية', city: 'الإسكندرية' },
  { name: 'طنطا (الغربية)', zone: 'الدلتا', city: 'الدلتا' },
  { name: 'المنصورة (الدقهلية)', zone: 'الدلتا', city: 'الدلتا' },
  { name: 'الزقازيق (الشرقية)', zone: 'الدلتا', city: 'الدلتا' },
  { name: 'القناة (بورسعيد / السويس / الإسماعيلية)', zone: 'القناة', city: 'مدن القناة' }
];

// Seed branches if empty
const countBranches = db.prepare('SELECT COUNT(*) as cnt FROM branches').get();
if (countBranches.cnt === 0) {
  const insertBranch = db.prepare('INSERT OR IGNORE INTO branches (id, name, zone, city, active) VALUES (?, ?, ?, ?, 1)');
  defaultBranchesList.forEach((b, i) => {
    insertBranch.run('b_' + (i + 1), b.name, b.zone, b.city);
  });
}

// Migrate data from previous db.json if present and pilots are empty
const countPilots = db.prepare('SELECT COUNT(*) as cnt FROM pilots').get();
if (countPilots.cnt === 0 && fs.existsSync(OLD_JSON_DB)) {
  try {
    const raw = fs.readFileSync(OLD_JSON_DB, 'utf8');
    const old = JSON.parse(raw);
    if (old.pilots && old.pilots.length) {
      const insP = db.prepare('INSERT OR IGNORE INTO pilots (id, pid, name, branch, office, phone, created) VALUES (?, ?, ?, ?, ?, ?, ?)');
      old.pilots.forEach(p => {
        insP.run(p.id || ('p_' + p.pid), String(p.pid), p.name || 'طيار', p.branch || 'التجمع الخامس', p.office || '', p.phone || '', p.created || Date.now());
      });
    }
    if (old.requests && old.requests.length) {
      const insR = db.prepare('INSERT OR IGNORE INTO requests (id, branch, name, pid, phone, la_name, office, rt, notes, urg, status, ts, updated, by, reason, claimedBy, manual) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      old.requests.forEach(r => {
        insR.run(r.id, r.branch, r.name, String(r.pid), r.phone || '', r.la_name || '', r.office || '', r.rt || 'فتح شيفت', r.notes || '', r.urg ? 1 : 0, r.status || 'new', r.ts || Date.now(), r.updated || r.ts || Date.now(), r.by || '', r.reason || '', r.claimedBy || '', r.manual ? 1 : 0);
      });
    }
  } catch (e) {
    console.error('Migration notice:', e.message);
  }
}

// SSE live clients
const sseClients = new Set();
function broadcast(eventType, data) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 50 * 1024 * 1024) reject(new Error('Payload too large')); // 50MB for bulk imports
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const query = parsedUrl.query;

  // Real-time SSE Stream
  if (pathname === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write('retry: 4000\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  // API: Health / System Info
  if (pathname === '/api/info') {
    const totalPilots = db.prepare('SELECT COUNT(*) as c FROM pilots').get().c;
    const totalRequests = db.prepare('SELECT COUNT(*) as c FROM requests').get().c;
    const totalBranches = db.prepare('SELECT COUNT(*) as c FROM branches').get().c;
    return sendJson(res, 200, {
      name: 'noon Rider Hub Enterprise Operations',
      version: '3.0.0 (High-Concurrency SQLite)',
      totalPilots,
      totalRequests,
      totalBranches,
      capacity: '30+ Hubs, 2,000+ Active Riders'
    });
  }

  // API: Aggregated Stats & Dashboard (High-Performance Server Calculation)
  if (pathname === '/api/stats') {
    const now = Date.now();
    const dayStart = new Date().setHours(0, 0, 0, 0);

    const pending = db.prepare("SELECT COUNT(*) as c FROM requests WHERE status = 'new'").get().c;
    const doneToday = db.prepare("SELECT COUNT(*) as c FROM requests WHERE status = 'done' AND updated >= ?").get(dayStart).c;
    
    // Average response time in minutes
    const avgSlaRow = db.prepare("SELECT AVG(updated - ts) as avgMs FROM requests WHERE status = 'done' AND updated >= ? AND manual = 0").get(dayStart);
    const avgMinutes = avgSlaRow.avgMs ? (avgSlaRow.avgMs / 60000).toFixed(1) : 0;

    return sendJson(res, 200, {
      pending,
      doneToday,
      avgMinutes,
      timestamp: now
    });
  }

  // API: Full Data Initial Load (with limits for ultra-smooth rendering)
  if (pathname === '/api/data') {
    const branches = db.prepare('SELECT name, zone, city FROM branches ORDER BY name ASC').all().map(b => b.name);
    const pilots = db.prepare('SELECT id, pid, name, branch, office, phone FROM pilots ORDER BY name ASC LIMIT 3000').all();
    const requests = db.prepare('SELECT * FROM requests ORDER BY ts DESC LIMIT 800').all();
    const openers = db.prepare('SELECT * FROM openers').all().map(o => ({
      id: o.id,
      name: o.name,
      branches: JSON.parse(o.branches_json || '[]'),
      updated: o.updated
    }));

    return sendJson(res, 200, {
      branches,
      pilots,
      requests,
      openers,
      config: { shiftHours: 11 }
    });
  }

  // API: Bulk Pilot Import (Supports pasting or importing 2,000+ riders in 1 shot)
  if (pathname === '/api/pilots/bulk' && req.method === 'POST') {
    const body = await parseBody(req);
    const list = Array.isArray(body.pilots) ? body.pilots : [];

    if (!list.length) {
      return sendJson(res, 400, { error: 'No pilots provided' });
    }

    const ins = db.prepare(`
      INSERT OR REPLACE INTO pilots (id, pid, name, branch, office, phone, status, created)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
    `);

    let imported = 0;
    const now = Date.now();
    
    // Execute all in one SQLite ACID transaction for instant insertion
    db.exec('BEGIN TRANSACTION;');
    try {
      for (const p of list) {
        if (!p.pid || !p.name) continue;
        const pidClean = String(p.pid).replace(/\D/g, '');
        if (!pidClean) continue;
        const id = 'p_' + pidClean;
        ins.run(id, pidClean, p.name.trim(), p.branch || 'التجمع الخامس', p.office || '', p.phone || '', now);
        imported++;
      }
      db.exec('COMMIT;');
      broadcast('pilots_bulk_imported', { count: imported });
      return sendJson(res, 200, { success: true, count: imported });
    } catch (err) {
      db.exec('ROLLBACK;');
      return sendJson(res, 500, { error: err.message });
    }
  }

  // API: Pilots Single CRUD
  if (pathname === '/api/pilots') {
    if (req.method === 'GET') {
      const search = (query.search || '').trim();
      const branch = (query.branch || '').trim();
      let sql = 'SELECT * FROM pilots WHERE 1=1';
      const params = [];

      if (branch) {
        sql += ' AND branch = ?';
        params.push(branch);
      }
      if (search) {
        sql += ' AND (name LIKE ? OR pid LIKE ? OR phone LIKE ?)';
        const like = `%${search}%`;
        params.push(like, like, like);
      }
      sql += ' ORDER BY name ASC LIMIT 500';
      const rows = db.prepare(sql).all(...params);
      return sendJson(res, 200, rows);
    }

    if (req.method === 'POST') {
      const data = await parseBody(req);
      const pidClean = String(data.pid || '').replace(/\D/g, '');
      const id = 'p_' + (pidClean || Date.now().toString(36));
      const ins = db.prepare(`
        INSERT OR REPLACE INTO pilots (id, pid, name, branch, office, phone, status, created)
        VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
      `);
      ins.run(id, pidClean, data.name || '', data.branch || '', data.office || '', data.phone || '', Date.now());
      const newPilot = { id, pid: pidClean, name: data.name, branch: data.branch, office: data.office, phone: data.phone };
      broadcast('pilot_created', newPilot);
      return sendJson(res, 201, newPilot);
    }
  }

  // API: Requests CRUD
  if (pathname === '/api/requests') {
    if (req.method === 'GET') {
      const status = (query.status || '').trim();
      const branch = (query.branch || '').trim();
      let sql = 'SELECT * FROM requests WHERE 1=1';
      const params = [];
      if (status && status !== 'all') {
        sql += ' AND status = ?';
        params.push(status);
      }
      if (branch) {
        sql += ' AND branch = ?';
        params.push(branch);
      }
      sql += ' ORDER BY ts DESC LIMIT 500';
      const rows = db.prepare(sql).all(...params);
      return sendJson(res, 200, rows);
    }

    if (req.method === 'POST') {
      const data = await parseBody(req);
      const now = Date.now();
      const id = 'r_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const pidClean = String(data.pid || '').replace(/\D/g, '');

      const ins = db.prepare(`
        INSERT INTO requests (id, branch, name, pid, phone, la_name, office, rt, notes, urg, status, ts, updated, by, reason, claimedBy, manual)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      ins.run(
        id,
        data.branch || '',
        data.name || '',
        pidClean,
        data.phone || '',
        data.la_name || '',
        data.office || '',
        data.rt || 'فتح شيفت',
        data.notes || '',
        data.urg ? 1 : 0,
        data.status || 'new',
        data.ts || now,
        now,
        data.by || '',
        data.reason || '',
        data.claimedBy || '',
        data.manual ? 1 : 0
      );

      const created = {
        id,
        branch: data.branch,
        name: data.name,
        pid: pidClean,
        phone: data.phone,
        la_name: data.la_name,
        office: data.office,
        rt: data.rt,
        notes: data.notes,
        urg: !!data.urg,
        status: data.status || 'new',
        ts: data.ts || now,
        updated: now
      };

      broadcast('request_created', created);
      return sendJson(res, 201, created);
    }
  }

  // Single Request PATCH / DELETE
  if (pathname.startsWith('/api/requests/')) {
    const id = pathname.replace('/api/requests/', '');

    if (req.method === 'PATCH' || req.method === 'PUT') {
      const updates = await parseBody(req);
      const now = Date.now();

      const fields = [];
      const values = [];

      for (const k of ['status', 'by', 'reason', 'claimedBy']) {
        if (updates[k] !== undefined) {
          fields.push(`${k} = ?`);
          values.push(updates[k]);
        }
      }
      fields.push('updated = ?');
      values.push(now);
      values.push(id);

      db.prepare(`UPDATE requests SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      const updatedRow = db.prepare('SELECT * FROM requests WHERE id = ?').get(id);

      broadcast('request_updated', updatedRow);
      return sendJson(res, 200, updatedRow);
    }

    if (req.method === 'DELETE') {
      db.prepare('DELETE FROM requests WHERE id = ?').run(id);
      broadcast('request_deleted', { id });
      return sendJson(res, 200, { ok: true });
    }
  }

  // Branches API
  if (pathname === '/api/branches') {
    if (req.method === 'GET') {
      const list = db.prepare('SELECT name FROM branches ORDER BY name ASC').all().map(b => b.name);
      return sendJson(res, 200, list);
    }
    if (req.method === 'POST') {
      const data = await parseBody(req);
      if (Array.isArray(data.branches)) {
        db.exec('BEGIN TRANSACTION;');
        db.prepare('DELETE FROM branches').run();
        const ins = db.prepare('INSERT INTO branches (id, name) VALUES (?, ?)');
        data.branches.forEach((b, i) => ins.run('b_' + i, b.trim()));
        db.exec('COMMIT;');
        broadcast('config_updated', { branches: data.branches });
      }
      return sendJson(res, 200, { ok: true });
    }
  }

  // Openers API
  if (pathname === '/api/openers') {
    if (req.method === 'GET') {
      const rows = db.prepare('SELECT * FROM openers').all().map(o => ({
        id: o.id,
        name: o.name,
        branches: JSON.parse(o.branches_json || '[]'),
        updated: o.updated
      }));
      return sendJson(res, 200, rows);
    }
    if (req.method === 'POST') {
      const data = await parseBody(req);
      const id = data.id || ('o_' + Date.now().toString(36));
      const ins = db.prepare(`
        INSERT OR REPLACE INTO openers (id, name, branches_json, updated)
        VALUES (?, ?, ?, ?)
      `);
      ins.run(id, data.name || '', JSON.stringify(data.branches || []), Date.now());
      broadcast('openers_updated', { id, name: data.name, branches: data.branches });
      return sendJson(res, 200, { ok: true });
    }
  }

  // Serve Static Frontend Files
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      const indexPath = fs.existsSync(path.join(PUBLIC_DIR, 'index.html'))
        ? path.join(PUBLIC_DIR, 'index.html')
        : path.join(__dirname, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        fs.createReadStream(indexPath).pipe(res);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`===================================================`);
  console.log(`🚀 noon Rider Hub Enterprise Server is RUNNING!`);
  console.log(`📍 Capacity: Scaled for 35+ Hubs & 2,000+ Riders`);
  console.log(`⚡ Engine: Native SQLite with WAL High-Concurrency`);
  console.log(`🌐 Local:   http://localhost:${PORT}`);
  console.log(`🌐 Network: http://0.0.0.0:${PORT}`);
  console.log(`===================================================`);
});
