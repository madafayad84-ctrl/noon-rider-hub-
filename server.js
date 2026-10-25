const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });

// Initial seed data if database is fresh
const defaultBranches = [
  'التجمع الخامس', 'المعادي', 'مدينة نصر', 'مصر الجديدة',
  'المهندسين', 'الدقي', 'الشيخ زايد', '6 أكتوبر',
  'الرحاب', 'الشروق', 'العبور', 'حلوان', 'شبرا', 'فيصل والهرم'
];

let db = {
  requests: [],
  pilots: [],
  branches: defaultBranches,
  openers: [],
  config: { shiftHours: 11, pin: '5821', mgrPin: '7700' }
};

// Load database from file
if (fs.existsSync(DB_FILE)) {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    db = Object.assign(db, JSON.parse(raw));
  } catch (e) {
    console.error('Error loading db.json:', e);
  }
} else {
  saveDb();
}

function saveDb() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving db.json:', e);
  }
}

// SSE connected clients for real-time live sync
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

// Parse body helper
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) { // 5MB limit
        reject(new Error('Body too large'));
      }
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

// MIME types for static files
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
  // CORS Preflight
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

  // Real-Time SSE Stream
  if (pathname === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write('retry: 5000\n\n');
    sseClients.add(res);

    req.on('close', () => {
      sseClients.delete(res);
    });
    return;
  }

  // --- API ROUTES ---

  // Health / Info
  if (pathname === '/api/info' && req.method === 'GET') {
    return sendJson(res, 200, {
      name: 'noon Rider Hub Operations Portal',
      version: '2.0.0',
      totalRequests: db.requests.length,
      totalPilots: db.pilots.length,
      branches: db.branches.length
    });
  }

  // GET /api/data (full initial sync)
  if (pathname === '/api/data' && req.method === 'GET') {
    return sendJson(res, 200, db);
  }

  // REQUESTS API
  if (pathname === '/api/requests') {
    if (req.method === 'GET') {
      return sendJson(res, 200, db.requests);
    }
    if (req.method === 'POST') {
      const data = await parseBody(req);
      const now = Date.now();
      const newReq = {
        id: 'r_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        branch: data.branch || '',
        name: data.name || '',
        pid: String(data.pid || ''),
        phone: data.phone || '',
        la_name: data.la_name || '', // Requested: LA name
        office: data.office || '',
        rt: data.rt || 'فتح شيفت',
        notes: data.notes || '',
        urg: !!data.urg,
        status: data.status || 'new',
        ts: data.ts || now,
        updated: now,
        by: data.by || '',
        reason: data.reason || '',
        claimedBy: data.claimedBy || '',
        claimedAt: data.claimedAt || null,
        manual: !!data.manual
      };
      db.requests.unshift(newReq);
      saveDb();
      broadcast('request_created', newReq);
      return sendJson(res, 201, newReq);
    }
  }

  // Single Request operations
  if (pathname.startsWith('/api/requests/')) {
    const id = pathname.replace('/api/requests/', '');
    const idx = db.requests.findIndex(r => r.id === id);

    if (idx === -1) {
      return sendJson(res, 404, { error: 'Request not found' });
    }

    if (req.method === 'PATCH' || req.method === 'PUT') {
      const updates = await parseBody(req);
      db.requests[idx] = Object.assign({}, db.requests[idx], updates, { updated: Date.now() });
      saveDb();
      broadcast('request_updated', db.requests[idx]);
      return sendJson(res, 200, db.requests[idx]);
    }

    if (req.method === 'DELETE') {
      const removed = db.requests.splice(idx, 1)[0];
      saveDb();
      broadcast('request_deleted', { id });
      return sendJson(res, 200, removed);
    }
  }

  // PILOTS API
  if (pathname === '/api/pilots') {
    if (req.method === 'GET') {
      return sendJson(res, 200, db.pilots);
    }
    if (req.method === 'POST') {
      const data = await parseBody(req);
      const newPilot = {
        id: 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: data.name || '',
        pid: String(data.pid || ''),
        branch: data.branch || '',
        office: data.office || '',
        phone: data.phone || '',
        created: Date.now()
      };
      db.pilots.push(newPilot);
      saveDb();
      broadcast('pilot_created', newPilot);
      return sendJson(res, 201, newPilot);
    }
  }

  if (pathname.startsWith('/api/pilots/')) {
    const id = pathname.replace('/api/pilots/', '');
    const idx = db.pilots.findIndex(p => p.id === id);

    if (idx === -1) {
      return sendJson(res, 404, { error: 'Pilot not found' });
    }

    if (req.method === 'PATCH' || req.method === 'PUT') {
      const updates = await parseBody(req);
      db.pilots[idx] = Object.assign({}, db.pilots[idx], updates);
      saveDb();
      broadcast('pilot_updated', db.pilots[idx]);
      return sendJson(res, 200, db.pilots[idx]);
    }

    if (req.method === 'DELETE') {
      const removed = db.pilots.splice(idx, 1)[0];
      saveDb();
      broadcast('pilot_deleted', { id });
      return sendJson(res, 200, removed);
    }
  }

  // BRANCHES & CONFIG API
  if (pathname === '/api/branches') {
    if (req.method === 'GET') {
      return sendJson(res, 200, db.branches);
    }
    if (req.method === 'POST') {
      const data = await parseBody(req);
      if (Array.isArray(data.branches)) {
        db.branches = data.branches;
      }
      if (data.shiftHours) {
        db.config.shiftHours = Number(data.shiftHours) || 11;
      }
      saveDb();
      broadcast('config_updated', { branches: db.branches, config: db.config });
      return sendJson(res, 200, { branches: db.branches, config: db.config });
    }
  }

  // OPENERS / DISPATCHERS API
  if (pathname === '/api/openers') {
    if (req.method === 'GET') {
      return sendJson(res, 200, db.openers);
    }
    if (req.method === 'POST') {
      const data = await parseBody(req);
      const id = data.id || ('o_' + Date.now().toString(36));
      const idx = db.openers.findIndex(o => o.id === id);
      const openerObj = {
        id,
        name: data.name || '',
        branches: Array.isArray(data.branches) ? data.branches : [],
        updated: Date.now()
      };
      if (idx >= 0) {
        db.openers[idx] = openerObj;
      } else {
        db.openers.push(openerObj);
      }
      saveDb();
      broadcast('openers_updated', db.openers);
      return sendJson(res, 200, openerObj);
    }
  }

  if (pathname.startsWith('/api/openers/') && req.method === 'DELETE') {
    const id = pathname.replace('/api/openers/', '');
    db.openers = db.openers.filter(o => o.id !== id);
    saveDb();
    broadcast('openers_updated', db.openers);
    return sendJson(res, 200, { ok: true });
  }

  // STATIC FILE SERVING
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

  // Prevent path traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Access denied');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback to index.html for SPA-style routing
      const indexPath = path.join(PUBLIC_DIR, 'index.html');
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
  console.log(`🚀 noon Rider Hub Operations Server is running!`);
  console.log(`📍 Local:   http://localhost:${PORT}`);
  console.log(`🌐 Network: http://0.0.0.0:${PORT}`);
  console.log(`===================================================`);
});
