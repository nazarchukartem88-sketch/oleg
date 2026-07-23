'use strict';
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-now';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@oleg-realtor.com').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'OlegPanel-2026!';
if (!DATABASE_URL) console.warn('DATABASE_URL is missing');
const pool = new Pool({ connectionString: DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 8 } });

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','SAMEORIGIN');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');next();});

async function initDb(){
  await pool.query(`
    create table if not exists admins(
      id serial primary key,
      email text unique not null,
      password_hash text not null,
      created_at timestamptz default now()
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
      created_at timestamptz default now()
    );
    create table if not exists property_images(
      id bigserial primary key,
      property_id bigint references properties(id) on delete cascade,
      mime_type text not null,
      image_data bytea not null,
      sort_order integer default 0
    );
  `);
  const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  await pool.query(`insert into admins(email,password_hash) values($1,$2) on conflict(email) do update set password_hash=excluded.password_hash`,[ADMIN_EMAIL,hash]);
}

function auth(req,res,next){
  try { req.admin = jwt.verify(req.cookies.oleg_admin || '', JWT_SECRET); next(); }
  catch { res.status(401).json({error:'Потрібен вхід адміністратора.'}); }
}
function clean(v,max=1000){ return String(v ?? '').trim().slice(0,max); }

app.get('/api/health', async (req,res)=>{try{await pool.query('select 1');res.json({ok:true});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.post('/api/login', async (req,res)=>{
  const email=clean(req.body.email,200).toLowerCase(); const password=String(req.body.password||'');
  const {rows}=await pool.query('select * from admins where email=$1',[email]);
  if(!rows[0] || !(await bcrypt.compare(password,rows[0].password_hash))) return res.status(401).json({error:'Невірний email або пароль.'});
  const token=jwt.sign({id:rows[0].id,email},JWT_SECRET,{expiresIn:'7d'});
  res.cookie('oleg_admin',token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',maxAge:7*86400000});
  res.json({ok:true});
});
app.post('/api/logout',(req,res)=>{res.clearCookie('oleg_admin');res.json({ok:true});});
app.get('/api/me',auth,(req,res)=>res.json({ok:true,email:req.admin.email}));

app.post('/api/leads', async (req,res)=>{
  const name=clean(req.body.name,150), phone=clean(req.body.phone,80), message=clean(req.body.message,3000);
  if(name.length<2||phone.length<5||message.length<2) return res.status(400).json({error:'Перевірте ім’я, телефон і повідомлення.'});
  await pool.query(`insert into leads(name,phone,email,preferred_contact,topic,budget,message,page_url) values($1,$2,$3,$4,$5,$6,$7,$8)`,[
    name,phone,clean(req.body.email,200)||null,clean(req.body.preferred_contact,50),clean(req.body.topic,200),clean(req.body.budget,100),message,clean(req.body.page_url,1000)
  ]);
  res.json({ok:true});
});
app.get('/api/leads',auth,async(req,res)=>{const {rows}=await pool.query('select * from leads order by created_at desc limit 500');res.json(rows);});
app.patch('/api/leads/:id',auth,async(req,res)=>{const status=['new','contacted','done'].includes(req.body.status)?req.body.status:'new';await pool.query('update leads set status=$1 where id=$2',[status,req.params.id]);res.json({ok:true});});
app.delete('/api/leads/:id',auth,async(req,res)=>{await pool.query('delete from leads where id=$1',[req.params.id]);res.json({ok:true});});

app.get('/api/properties',async(req,res)=>{
  const admin=req.query.admin==='1';
  const q=admin?'select * from properties order by created_at desc':'select * from properties where published=true order by created_at desc';
  const {rows}=await pool.query(q);
  for(const p of rows){const imgs=await pool.query('select id,sort_order from property_images where property_id=$1 order by sort_order,id',[p.id]);p.images=imgs.rows.map(i=>`/api/images/${i.id}`);}
  res.json(rows);
});
app.post('/api/properties',auth,upload.array('images',8),async(req,res)=>{
  const b=req.body;
  if(clean(b.title,200).length<2||clean(b.district,200).length<2||clean(b.description,5000).length<2) return res.status(400).json({error:'Заповніть назву, район та опис.'});
  const {rows}=await pool.query(`insert into properties(title,type,price,district,area,rooms,status,description,published,video_url) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,[
    clean(b.title,200),clean(b.type,50)||'apartment',Number(b.price)||0,clean(b.district,200),Number(b.area)||0,Number(b.rooms)||0,clean(b.status,100)||'Актуально',clean(b.description,5000),b.published==='true'||b.published==='on',clean(b.video_url,1000)||null
  ]);
  for(let i=0;i<(req.files||[]).length;i++){const f=req.files[i];if(!/^image\/(jpeg|png|webp)$/.test(f.mimetype))continue;await pool.query('insert into property_images(property_id,mime_type,image_data,sort_order) values($1,$2,$3,$4)',[rows[0].id,f.mimetype,f.buffer,i]);}
  res.json(rows[0]);
});
app.delete('/api/properties/:id',auth,async(req,res)=>{await pool.query('delete from properties where id=$1',[req.params.id]);res.json({ok:true});});
app.get('/api/images/:id',async(req,res)=>{const {rows}=await pool.query('select mime_type,image_data from property_images where id=$1',[req.params.id]);if(!rows[0])return res.sendStatus(404);res.type(rows[0].mime_type).send(rows[0].image_data);});

app.use(express.static(path.join(__dirname,'public')));
app.get('/office-ov',(req,res)=>res.sendFile(path.join(__dirname,'public','office.html')));
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initDb().then(()=>app.listen(PORT,()=>console.log(`Server on ${PORT}`))).catch(e=>{console.error(e);process.exit(1);});
