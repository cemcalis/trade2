import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import Database from 'better-sqlite3';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { marketBuckets } from './src/marketBuckets.js';
import { ensureUploads } from './src/uploadUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ dest: path.join(__dirname, 'uploads') });
const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
const MARKET_API_KEY = process.env.MARKET_API_KEY || '';
const NEWS_API_KEY = process.env.NEWS_API_KEY || '';

ensureUploads(path.join(__dirname, 'uploads'));

const db = new Database(path.join(__dirname, 'trading.db'));

db.pragma('journal_mode = WAL');

const migrations = [
  `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      tc_no TEXT UNIQUE NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      verified INTEGER DEFAULT 0,
      balance REAL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );`,
  `CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      front_path TEXT NOT NULL,
      back_path TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );`,
  `CREATE TABLE IF NOT EXISTS market_controls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bucket TEXT UNIQUE NOT NULL,
      active INTEGER DEFAULT 1,
      price_override REAL,
      paused_at TEXT
    );`,
  `CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      bucket TEXT NOT NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      quantity REAL NOT NULL,
      price REAL NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );`,
  `CREATE TABLE IF NOT EXISTS broker_orders (
      id TEXT PRIMARY KEY,
      broker_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      quantity REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      approved_by TEXT,
      approved_at TEXT
    );`,
  `CREATE TABLE IF NOT EXISTS balances (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      delta REAL NOT NULL,
      reason TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );`,
  `CREATE TABLE IF NOT EXISTS cash_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      requested_amount REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );`,
  `CREATE TABLE IF NOT EXISTS news_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      headline TEXT NOT NULL,
      url TEXT,
      source TEXT,
      published_at TEXT
    );`
];

migrations.forEach((m) => db.prepare(m).run());

const ensureAdmin = () => {
  const count = db.prepare('SELECT COUNT(1) as c FROM users WHERE role = "admin"').get();
  if (count.c === 0) {
    const id = uuidv4();
    const password_hash = bcrypt.hashSync('Admin123!', 10);
    db.prepare(`INSERT INTO users (id, tc_no, first_name, last_name, email, password_hash, role, verified, balance)
      VALUES (@id, @tc_no, @first_name, @last_name, @email, @password_hash, 'admin', 1, 0)`).run({
      id,
      tc_no: '00000000000',
      first_name: 'Root',
      last_name: 'Admin',
      email: 'admin@broker.local',
      password_hash
    });
  }
};

ensureAdmin();

const authMiddleware = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Bearer token gerekli' });
  const token = header.replace('Bearer ', '');
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Token geçersiz veya süresi dolmuş' });
  }
};

const requireRole = (roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Yetki yok' });
  next();
};

const getUser = (userId) => db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

app.post('/api/auth/register', (req, res) => {
  const { tc_no, first_name, last_name, email, password } = req.body;
  if (!tc_no || !first_name || !last_name || !email || !password) {
    return res.status(400).json({ error: 'Tüm alanlar zorunlu' });
  }
  if (!/^\d{11}$/.test(tc_no)) return res.status(400).json({ error: 'TC kimlik numarası 11 haneli olmalı' });
  const existing = db.prepare('SELECT 1 FROM users WHERE tc_no = ? OR email = ?').get(tc_no, email);
  if (existing) return res.status(400).json({ error: 'Kayıt zaten mevcut' });
  const id = uuidv4();
  const password_hash = bcrypt.hashSync(password, 10);
  db.prepare(`INSERT INTO users (id, tc_no, first_name, last_name, email, password_hash)
    VALUES (@id, @tc_no, @first_name, @last_name, @email, @password_hash)`).run({
    id,
    tc_no,
    first_name,
    last_name,
    email,
    password_hash
  });
  res.json({ id, tc_no, email });
});

app.post('/api/auth/login', (req, res) => {
  const { tc_no, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE tc_no = ?').get(tc_no);
  if (!user) return res.status(401).json({ error: 'Bilgiler yanlış' });
  if (!bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Bilgiler yanlış' });
  const token = jwt.sign({ sub: user.id, role: user.role, verified: !!user.verified }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, role: user.role, verified: !!user.verified, first_name: user.first_name });
});

app.get('/api/profile', authMiddleware, (req, res) => {
  const user = getUser(req.user.sub);
  res.json({
    id: user.id,
    tc_no: user.tc_no,
    first_name: user.first_name,
    last_name: user.last_name,
    email: user.email,
    role: user.role,
    verified: !!user.verified,
    balance: user.balance
  });
});

app.post('/api/users/:userId/documents', authMiddleware, upload.fields([{ name: 'front' }, { name: 'back' }]), (req, res) => {
  const { userId } = req.params;
  if (req.user.sub !== userId && req.user.role !== 'admin') return res.status(403).json({ error: 'Sadece kendi belgenizi yükleyebilirsiniz' });
  const front = req.files.front?.[0];
  const back = req.files.back?.[0];
  if (!front || !back) return res.status(400).json({ error: 'Ön ve arka kimlik fotoğrafı zorunlu' });
  const id = uuidv4();
  db.prepare('INSERT INTO documents (id, user_id, front_path, back_path) VALUES (?, ?, ?, ?)')
    .run(id, userId, front.filename, back.filename);
  res.json({ id });
});

app.post('/api/admin/users/:userId/verify', authMiddleware, requireRole(['admin']), (req, res) => {
  const { userId } = req.params;
  const { status } = req.body;
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Durum hatalı' });
  db.prepare('UPDATE documents SET status = ? WHERE user_id = ?').run(status, userId);
  db.prepare('UPDATE users SET verified = ? WHERE id = ?').run(status === 'approved' ? 1 : 0, userId);
  res.json({ userId, status });
});

const marketCache = new Map();
const cacheDurationMs = 30 * 1000;

const fetchPrice = async (symbol) => {
  if (!MARKET_API_KEY) throw new Error('MARKET_API_KEY gerekli');
  const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(symbol)}&apikey=${MARKET_API_KEY}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('Fiyat alınamadı');
  const data = await resp.json();
  if (!data || !data.price) throw new Error('Geçersiz fiyat cevabı');
  return parseFloat(data.price);
};

app.get('/api/markets/:bucket', authMiddleware, async (req, res) => {
  const { bucket } = req.params;
  const controls = db.prepare('SELECT * FROM market_controls WHERE bucket = ?').get(bucket);
  if (controls && controls.active === 0) return res.status(423).json({ error: 'Piyasa duraklatıldı' });
  const list = marketBuckets[bucket];
  if (!list) return res.status(404).json({ error: 'Tanımsız market' });
  const now = Date.now();
  if (marketCache.has(bucket)) {
    const cached = marketCache.get(bucket);
    if (now - cached.ts < cacheDurationMs) return res.json({ bucket, as_of: cached.ts, quotes: cached.quotes });
  }
  try {
    const quotes = await Promise.all(list.slice(0, 15).map(async (symbol) => { // throttle
      try {
        const price = controls?.price_override ?? await fetchPrice(symbol);
        return { symbol, price };
      } catch (err) {
        return { symbol, error: err.message };
      }
    }));
    const payload = { bucket, as_of: now, quotes };
    marketCache.set(bucket, payload);
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/trades/order', authMiddleware, (req, res) => {
  const user = getUser(req.user.sub);
  if (!user.verified) return res.status(403).json({ error: 'Doğrulanmış kullanıcılar işlem yapabilir' });
  const { bucket, symbol, side, quantity, price } = req.body;
  if (!['buy', 'sell'].includes(side)) return res.status(400).json({ error: 'Geçersiz yön' });
  const id = uuidv4();
  db.prepare(`INSERT INTO orders (id, user_id, bucket, symbol, side, quantity, price)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, user.id, bucket, symbol, side, quantity, price);
  const delta = side === 'buy' ? -quantity * price : quantity * price;
  db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(delta, user.id);
  db.prepare('INSERT INTO balances (id, user_id, delta, reason) VALUES (?, ?, ?, ?)')
    .run(uuidv4(), user.id, delta, `${side} ${symbol}`);
  res.json({ id, balance: user.balance + delta });
});

app.post('/api/deposits/request', authMiddleware, (req, res) => {
  const { amount } = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO cash_requests (id, user_id, type, amount, requested_amount) VALUES (?, ?, "deposit", ?, ?)')
    .run(id, req.user.sub, amount, amount);
  res.json({ id, status: 'pending' });
});

app.post('/api/withdrawals/request', authMiddleware, (req, res) => {
  const { amount } = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO cash_requests (id, user_id, type, amount, requested_amount) VALUES (?, ?, "withdrawal", ?, ?)')
    .run(id, req.user.sub, amount, amount);
  res.json({ id, status: 'pending' });
});

app.post('/api/admin/cash/:id/approve', authMiddleware, requireRole(['admin']), (req, res) => {
  const { id } = req.params;
  const { amount } = req.body;
  const request = db.prepare('SELECT * FROM cash_requests WHERE id = ?').get(id);
  if (!request) return res.status(404).json({ error: 'Kayıt yok' });
  db.prepare('UPDATE cash_requests SET status = ? , amount = ? WHERE id = ?').run('approved', amount, id);
  const delta = request.type === 'deposit' ? amount : -amount;
  db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(delta, request.user_id);
  db.prepare('INSERT INTO balances (id, user_id, delta, reason) VALUES (?, ?, ?, ?)')
    .run(uuidv4(), request.user_id, delta, `${request.type} approval`);
  res.json({ id, final_amount: amount });
});

app.post('/api/admin/users/:userId/balance', authMiddleware, requireRole(['admin']), (req, res) => {
  const { userId } = req.params;
  const { amount, reason } = req.body;
  db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(amount, userId);
  db.prepare('INSERT INTO balances (id, user_id, delta, reason) VALUES (?, ?, ?, ?)')
    .run(uuidv4(), userId, amount, reason || 'manual');
  res.json({ userId, amount });
});

app.post('/api/admin/markets/control', authMiddleware, requireRole(['admin']), (req, res) => {
  const { bucket, active, price_override } = req.body;
  if (!bucket) return res.status(400).json({ error: 'bucket zorunlu' });
  db.prepare(`INSERT INTO market_controls (bucket, active, price_override)
    VALUES (@bucket, @active, @price_override)
    ON CONFLICT(bucket) DO UPDATE SET active = excluded.active, price_override = excluded.price_override, paused_at = CURRENT_TIMESTAMP`)
    .run({ bucket, active: active ? 1 : 0, price_override });
  marketCache.delete(bucket);
  res.json({ bucket, active, price_override });
});

app.post('/api/broker/batch-order', authMiddleware, requireRole(['broker']), (req, res) => {
  const { symbol, side, quantity } = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO broker_orders (id, broker_id, symbol, side, quantity) VALUES (?, ?, ?, ?, ?)')
    .run(id, req.user.sub, symbol, side, quantity);
  res.json({ id, status: 'pending admin approval' });
});

app.post('/api/admin/broker-orders/:id/approve', authMiddleware, requireRole(['admin']), (req, res) => {
  const { id } = req.params;
  const order = db.prepare('SELECT * FROM broker_orders WHERE id = ?').get(id);
  if (!order) return res.status(404).json({ error: 'Kayıt yok' });
  db.prepare('UPDATE broker_orders SET status = "approved", approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(req.user.sub, id);
  res.json({ id, status: 'approved' });
});

app.get('/api/news', async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const cached = db.prepare('SELECT * FROM news_cache WHERE published_at >= ?').all(`${today}T00:00:00`);
  if (cached.length) return res.json({ articles: cached });
  if (!NEWS_API_KEY) return res.status(503).json({ error: 'NEWS_API_KEY gerekli' });
  try {
    const resp = await fetch(`https://newsapi.org/v2/top-headlines?country=tr&category=business&apiKey=${NEWS_API_KEY}`);
    if (!resp.ok) throw new Error('Haber kaynağı hatası');
    const data = await resp.json();
    const stmt = db.prepare('INSERT INTO news_cache (headline, url, source, published_at) VALUES (?, ?, ?, ?)');
    data.articles.slice(0, 20).forEach((a) => {
      stmt.run(a.title, a.url, a.source.name, a.publishedAt);
    });
    res.json({ articles: data.articles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Broker platform listening on ${port}`);
});
