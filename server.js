'use strict';

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { Pool } = require('pg');

const STATIC_DIR = __dirname;
const SAFE_FILES = new Set([
  'index.html', 'office.html', '404.html', 'privacy.html',
  'site.js', 'admin-app.js', 'secure.css', 'admin.css',
  'favicon.png', 'og-image.jpg', 'manifest.webmanifest', 'robots.txt'
]);

function clean(value, max = 1000) {
  return String(value ?? '').trim().slice(0, max);
}

function boolValue(value) {
  return value === true || value === 'true' || value === 'on' || value === '1';
}

function createRateLimiter({ windowMs, max }) {
  const store = new Map();
  return (req, res, next) => {
    const key = `${req.ip}:${clean(req.body?.email || '', 200).toLowerCase()}`;
    const now = Date.now();
    const entry = store.get(key);
    if (!entry || entry.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      return res.status(429).json({ error: 'Забагато спроб. Спробуйте ще раз пізніше.' });
    }
    next();
  };
}

function createApp(options = {}) {
  const nodeEnv = options.nodeEnv || process.env.NODE_ENV || 'development';
  const databaseUrl = options.databaseUrl || process.env.DATABASE_URL;
  const jwtSecret = options.jwtSecret || process.env.JWT_SECRET || 'local-development-secret-change-me';
  const adminEmail = clean(options.adminEmail ?? process.env.ADMIN_EMAIL ?? '', 200).toLowerCase();
  const adminPassword = String(options.adminPassword ?? process.env.ADMIN_PASSWORD ?? '');
  const pool = options.pool || new Pool({
    connectionString: databaseUrl,
    ssl: nodeEnv === 'production' ? { rejectUnauthorized: false } : false
  });

  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' https:; frame-src https://www.google.com https://maps.google.com; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"
    );
    if (nodeEnv === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    if (req.path.startsWith('/api/') || req.path === '/office-ov' || req.path === '/office.html') {
      res.setHeader('Cache-Control', 'no-store');
    }
    next();
  });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 8 },
    fileFilter: (_req, file, cb) => {
      if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) return cb(null, true);
      cb(new Error('Дозволені лише JPG, PNG або WEBP.'));
    }
  });

  async function initDb() {
    if (!adminEmail || !adminPassword || adminPassword.length < 10) {
      throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD (minimum 10 characters) must be configured.');
    }
    await pool.query(`
      create table if not exists admins(
        id serial primary key,
        email text unique not null,
        password_hash text not null,
        created_at timestamptz default now(),
        managed_by_env boolean not null default true
      );
      create table if not exists leads(
        id bigserial primary key,
        name text not null,
        phone text not null,
        email text,
        preferred_contact text,
        topic text,
        budget text,
        message text not null,
        page_url text,
        status text not null default 'new',
        created_at timestamptz default now()
      );
      create table if not exists properties(
        id bigserial primary key,
        title text not null,
        type text not null default 'apartment',
        price numeric default 0,
        district text not null,
        area numeric default 0,
        rooms integer default 0,
        status text default 'Актуально',
        description text not null,
        published boolean default true,
        video_url text,
        created_at timestamptz default now(),
        updated_at timestamptz default now()
      );
      create table if not exists property_images(
        id bigserial primary key,
        property_id bigint references properties(id) on delete cascade,
        mime_type text not null,
        image_data bytea not null,
        sort_order integer default 0
      );
      create table if not exists site_settings(
        id integer primary key,
        phone text not null default '+38 (000) 000-00-00',
        email text not null default 'info@example.com',
        instagram_url text not null default '',
        telegram_url text not null default '',
        address text not null default 'Чернівці, Україна',
        hours text not null default 'Пн–Сб: 09:00–19:00',
        updated_at timestamptz default now()
      );
      create index if not exists leads_created_idx on leads(created_at desc);
      create index if not exists properties_published_idx on properties(published, created_at desc);
      create index if not exists property_images_property_idx on property_images(property_id, sort_order, id);
    `);

    await pool.query('alter table admins add column if not exists managed_by_env boolean not null default true');
    const passwordHash = await bcrypt.hash(adminPassword, 12);
    await pool.query(
      'insert into admins(email,password_hash) values($1,$2) on conflict(email) do nothing',
      [adminEmail, passwordHash]
    );
    await pool.query('insert into site_settings(id) values(1) on conflict(id) do nothing');
  }

  function auth(req, res, next) {
    try {
      req.admin = jwt.verify(req.cookies.oleg_admin || '', jwtSecret);
      next();
    } catch {
      res.status(401).json({ error: 'Потрібен вхід адміністратора.' });
    }
  }

  async function getProperties({ includeUnpublished = false } = {}) {
    const { rows } = await pool.query(
      includeUnpublished
        ? 'select * from properties order by created_at desc'
        : 'select * from properties where published=true order by created_at desc'
    );
    if (!rows.length) return rows;
    const ids = rows.map((row) => row.id);
    const imageResult = await pool.query(
      'select id, property_id, sort_order from property_images where property_id = any($1::bigint[]) order by sort_order,id',
      [ids]
    );
    const grouped = new Map();
    for (const image of imageResult.rows) {
      if (!grouped.has(String(image.property_id))) grouped.set(String(image.property_id), []);
      grouped.get(String(image.property_id)).push(`/api/images/${image.id}`);
    }
    return rows.map((row) => ({ ...row, images: grouped.get(String(row.id)) || [] }));
  }

  async function saveImages(client, propertyId, files, startOrder = 0) {
    for (let i = 0; i < (files || []).length; i += 1) {
      const file = files[i];
      await client.query(
        'insert into property_images(property_id,mime_type,image_data,sort_order) values($1,$2,$3,$4)',
        [propertyId, file.mimetype, file.buffer, startOrder + i]
      );
    }
  }

  const loginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 8 });
  const leadLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 20 });

  app.get('/api/health', async (_req, res, next) => {
    try {
      await pool.query('select 1');
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/login', loginLimiter, async (req, res, next) => {
    try {
      const email = clean(req.body.email, 200).toLowerCase();
      const password = String(req.body.password || '');
      const { rows } = await pool.query('select * from admins where email=$1', [email]);
      const admin = rows[0];
      if (!admin) return res.status(401).json({ error: 'Невірний email або пароль.' });
      let validPassword = await bcrypt.compare(password, admin.password_hash);
      if (!validPassword && admin.managed_by_env && email === adminEmail && password === adminPassword) {
        const syncedHash = await bcrypt.hash(adminPassword, 12);
        await pool.query('update admins set password_hash=$1 where id=$2', [syncedHash, admin.id]);
        validPassword = true;
      }
      if (!validPassword) return res.status(401).json({ error: 'Невірний email або пароль.' });
      const token = jwt.sign({ id: admin.id, email: admin.email }, jwtSecret, { expiresIn: '7d' });
      res.cookie('oleg_admin', token, {
        httpOnly: true,
        secure: nodeEnv === 'production',
        sameSite: 'strict',
        maxAge: 7 * 86400000,
        path: '/'
      });
      res.json({ ok: true, email: rows[0].email });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/logout', (_req, res) => {
    res.clearCookie('oleg_admin', { path: '/', sameSite: 'strict', secure: nodeEnv === 'production' });
    res.json({ ok: true });
  });

  app.get('/api/me', auth, (req, res) => res.json({ ok: true, email: req.admin.email }));

  app.post('/api/admin/change-password', auth, async (req, res, next) => {
    try {
      const currentPassword = String(req.body.current_password || '');
      const newPassword = String(req.body.new_password || '');
      if (newPassword.length < 10) {
        return res.status(400).json({ error: 'Новий пароль має містити щонайменше 10 символів.' });
      }
      const { rows } = await pool.query('select * from admins where id=$1', [req.admin.id]);
      if (!rows[0] || !(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
        return res.status(400).json({ error: 'Поточний пароль неправильний.' });
      }
      const hash = await bcrypt.hash(newPassword, 12);
      await pool.query('update admins set password_hash=$1, managed_by_env=false where id=$2', [hash, req.admin.id]);
      res.clearCookie('oleg_admin', { path: '/', sameSite: 'strict', secure: nodeEnv === 'production' });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/settings', async (_req, res, next) => {
    try {
      const { rows } = await pool.query('select phone,email,instagram_url,telegram_url,address,hours from site_settings where id=1');
      res.json(rows[0] || {});
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/settings', auth, async (req, res, next) => {
    try {
      const values = [
        clean(req.body.phone, 80),
        clean(req.body.email, 200),
        clean(req.body.instagram_url, 500),
        clean(req.body.telegram_url, 500),
        clean(req.body.address, 300),
        clean(req.body.hours, 200)
      ];
      const { rows } = await pool.query(
        `update site_settings set phone=$1,email=$2,instagram_url=$3,telegram_url=$4,address=$5,hours=$6,updated_at=now()
         where id=1 returning phone,email,instagram_url,telegram_url,address,hours`,
        values
      );
      res.json(rows[0]);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/leads', leadLimiter, async (req, res, next) => {
    try {
      if (clean(req.body.website, 200)) return res.json({ ok: true });
      const name = clean(req.body.name, 150);
      const phone = clean(req.body.phone, 80);
      const message = clean(req.body.message, 3000);
      if (name.length < 2 || phone.length < 5 || message.length < 2) {
        return res.status(400).json({ error: 'Перевірте ім’я, телефон і повідомлення.' });
      }
      await pool.query(
        `insert into leads(name,phone,email,preferred_contact,topic,budget,message,page_url)
         values($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          name,
          phone,
          clean(req.body.email, 200) || null,
          clean(req.body.preferred_contact, 50),
          clean(req.body.topic, 200),
          clean(req.body.budget, 100),
          message,
          clean(req.body.page_url, 1000)
        ]
      );
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/leads', auth, async (_req, res, next) => {
    try {
      const { rows } = await pool.query('select * from leads order by created_at desc limit 500');
      res.json(rows);
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/leads/:id', auth, async (req, res, next) => {
    try {
      const status = ['new', 'contacted', 'done'].includes(req.body.status) ? req.body.status : 'new';
      await pool.query('update leads set status=$1 where id=$2', [status, req.params.id]);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/leads/:id', auth, async (req, res, next) => {
    try {
      await pool.query('delete from leads where id=$1', [req.params.id]);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/leads.csv', auth, async (_req, res, next) => {
    try {
      const { rows } = await pool.query('select * from leads order by created_at desc limit 5000');
      const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
      const header = ['Дата', 'Ім’я', 'Телефон', 'Email', 'Тема', 'Бюджет', 'Спосіб зв’язку', 'Повідомлення', 'Статус'];
      const lines = [header.map(quote).join(',')];
      for (const row of rows) {
        lines.push([
          row.created_at, row.name, row.phone, row.email, row.topic, row.budget,
          row.preferred_contact, row.message, row.status
        ].map(quote).join(','));
      }
      res.type('text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="leads.csv"');
      res.send(`\uFEFF${lines.join('\n')}`);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/properties', async (_req, res, next) => {
    try {
      res.json(await getProperties());
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/admin/properties', auth, async (_req, res, next) => {
    try {
      res.json(await getProperties({ includeUnpublished: true }));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/properties', auth, upload.array('images', 8), async (req, res, next) => {
    const client = await pool.connect();
    try {
      const body = req.body;
      if (clean(body.title, 200).length < 2 || clean(body.district, 200).length < 2 || clean(body.description, 5000).length < 2) {
        return res.status(400).json({ error: 'Заповніть назву, район та опис.' });
      }
      await client.query('begin');
      const { rows } = await client.query(
        `insert into properties(title,type,price,district,area,rooms,status,description,published,video_url)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
        [
          clean(body.title, 200), clean(body.type, 50) || 'apartment', Number(body.price) || 0,
          clean(body.district, 200), Number(body.area) || 0, Number(body.rooms) || 0,
          clean(body.status, 100) || 'Актуально', clean(body.description, 5000), boolValue(body.published),
          clean(body.video_url, 1000) || null
        ]
      );
      await saveImages(client, rows[0].id, req.files || []);
      await client.query('commit');
      res.json(rows[0]);
    } catch (error) {
      await client.query('rollback').catch(() => {});
      next(error);
    } finally {
      client.release();
    }
  });

  app.patch('/api/properties/:id', auth, upload.array('images', 8), async (req, res, next) => {
    const client = await pool.connect();
    try {
      const body = req.body;
      if (clean(body.title, 200).length < 2 || clean(body.district, 200).length < 2 || clean(body.description, 5000).length < 2) {
        return res.status(400).json({ error: 'Заповніть назву, район та опис.' });
      }
      await client.query('begin');
      const { rows } = await client.query(
        `update properties set title=$1,type=$2,price=$3,district=$4,area=$5,rooms=$6,status=$7,
         description=$8,published=$9,video_url=$10,updated_at=now() where id=$11 returning *`,
        [
          clean(body.title, 200), clean(body.type, 50) || 'apartment', Number(body.price) || 0,
          clean(body.district, 200), Number(body.area) || 0, Number(body.rooms) || 0,
          clean(body.status, 100) || 'Актуально', clean(body.description, 5000), boolValue(body.published),
          clean(body.video_url, 1000) || null, req.params.id
        ]
      );
      if (!rows[0]) {
        await client.query('rollback');
        return res.status(404).json({ error: 'Об’єкт не знайдено.' });
      }
      const orderResult = await client.query('select coalesce(max(sort_order), -1) as max_order from property_images where property_id=$1', [req.params.id]);
      await saveImages(client, req.params.id, req.files || [], Number(orderResult.rows[0].max_order) + 1);
      await client.query('commit');
      res.json(rows[0]);
    } catch (error) {
      await client.query('rollback').catch(() => {});
      next(error);
    } finally {
      client.release();
    }
  });

  app.delete('/api/properties/:id', auth, async (req, res, next) => {
    try {
      await pool.query('delete from properties where id=$1', [req.params.id]);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/images/:id', async (req, res, next) => {
    try {
      const { rows } = await pool.query('select mime_type,image_data from property_images where id=$1', [req.params.id]);
      if (!rows[0]) return res.sendStatus(404);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.type(rows[0].mime_type).send(rows[0].image_data);
    } catch (error) {
      next(error);
    }
  });

  app.get('/', (_req, res) => res.sendFile(path.join(STATIC_DIR, 'index.html')));
  app.get(['/office-ov', '/office.html'], (_req, res) => res.sendFile(path.join(STATIC_DIR, 'office.html')));
  app.get('/:file', (req, res, next) => {
    if (!SAFE_FILES.has(req.params.file)) return next();
    res.sendFile(path.join(STATIC_DIR, req.params.file));
  });

  app.use((req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Маршрут не знайдено.' });
    res.status(404).sendFile(path.join(STATIC_DIR, '404.html'));
  });

  app.use((error, req, res, _next) => {
    console.error(error);
    const isApi = req.path.startsWith('/api/');
    const message = error instanceof multer.MulterError
      ? 'Файл завеликий або перевищено кількість файлів.'
      : clean(error.message, 300) || 'Внутрішня помилка сервера.';
    if (isApi) return res.status(500).json({ error: message });
    res.status(500).send('Внутрішня помилка сервера.');
  });

  return { app, pool, initDb };
}

async function start() {
  const port = Number(process.env.PORT) || 3000;
  if (!process.env.DATABASE_URL) {
    console.warn('DATABASE_URL is missing. The server will not start without a database.');
  }
  const { app, initDb } = createApp();
  await initDb();
  app.listen(port, () => console.log(`Server listening on ${port}`));
}

if (require.main === module) {
  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { createApp };
