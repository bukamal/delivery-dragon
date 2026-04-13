import express from 'express';
import { Bot } from 'grammy';
import pkg from 'pg';
const { Pool } = pkg;

const app = express();
app.use(express.json());

// ========== إعداد قاعدة البيانات Supabase ==========
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ========== إعداد البوت ==========
const bot = new Bot(process.env.BOT_TOKEN);
const MINI_APP_URL = process.env.MINI_APP_URL || 'https://delivery-mini-app.pages.dev';

// دالة مساعدة لجلب المستخدم
async function getDbUser(telegramId) {
  const res = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [telegramId.toString()]);
  return res.rows[0];
}

// ========== أوامر البوت ==========
bot.command('start', async (ctx) => {
  const telegramId = ctx.from.id;
  const name = ctx.from.first_name + (ctx.from.last_name ? ' ' + ctx.from.last_name : '');
  await pool.query(
    'INSERT INTO users (telegram_id, name, role) VALUES ($1, $2, $3) ON CONFLICT (telegram_id) DO NOTHING',
    [telegramId.toString(), name, 'customer']
  );
  ctx.reply('🐉 مرحباً! اضغط الزر لفتح التطبيق:', {
    reply_markup: { inline_keyboard: [[{ text: '🚀 افتح منصة التنين', web_app: { url: MINI_APP_URL } }]] }
  });
});

bot.command('menu', (ctx) => {
  ctx.reply('اضغط الزر أدناه لتصفح المطاعم:', {
    reply_markup: { inline_keyboard: [[{ text: '🍔 تصفح المطاعم', web_app: { url: MINI_APP_URL } }]] }
  });
});

// ========== API Routes ==========
app.get('/api/me', async (req, res) => {
  const initData = req.headers['x-telegram-init-data'];
  if (!initData) return res.status(401).json({ error: 'Unauthorized' });
  const urlParams = new URLSearchParams(initData);
  const userString = urlParams.get('user');
  if (!userString) return res.status(401).json({ error: 'Unauthorized' });
  const tgUser = JSON.parse(userString);
  const dbUser = await getDbUser(tgUser.id);
  res.json(dbUser || { role: 'customer' });
});

app.get('/api/categories', async (req, res) => {
  const result = await pool.query('SELECT * FROM shop_categories');
  res.json(result.rows);
});

app.post('/api/register/shop', async (req, res) => {
  const initData = req.headers['x-telegram-init-data'];
  if (!initData) return res.status(401).json({ error: 'Unauthorized' });
  const urlParams = new URLSearchParams(initData);
  const userString = urlParams.get('user');
  if (!userString) return res.status(401).json({ error: 'Unauthorized' });
  const tgUser = JSON.parse(userString);
  const { name, shop_name, category_id, phone, address } = req.body;
  await pool.query('UPDATE users SET role = $1, name = $2, phone = $3, is_approved = false WHERE telegram_id = $4',
    ['shop', name, phone, tgUser.id]);
  await pool.query('INSERT INTO shops (owner_id, shop_name, category_id, phone, address) VALUES ((SELECT id FROM users WHERE telegram_id = $1), $2, $3, $4, $5)',
    [tgUser.id, shop_name, category_id, phone, address]);
  res.status(201).json({ success: true });
});

app.post('/api/register/rider', async (req, res) => {
  const initData = req.headers['x-telegram-init-data'];
  if (!initData) return res.status(401).json({ error: 'Unauthorized' });
  const urlParams = new URLSearchParams(initData);
  const userString = urlParams.get('user');
  if (!userString) return res.status(401).json({ error: 'Unauthorized' });
  const tgUser = JSON.parse(userString);
  const { name, phone, vehicle_type } = req.body;
  await pool.query('UPDATE users SET role = $1, name = $2, phone = $3, is_approved = false WHERE telegram_id = $4',
    ['rider', name, phone, tgUser.id]);
  await pool.query('INSERT INTO rider_details (user_id, vehicle_type) VALUES ((SELECT id FROM users WHERE telegram_id = $1), $2) ON CONFLICT (user_id) DO NOTHING',
    [tgUser.id, vehicle_type || 'دراجة']);
  res.status(201).json({ success: true });
});

app.get('/api/shops', async (req, res) => {
  const result = await pool.query(`
    SELECT s.*, c.name as category_name, c.icon 
    FROM shops s 
    LEFT JOIN shop_categories c ON s.category_id = c.id 
    WHERE s.is_open = true
  `);
  res.json(result.rows);
});

app.get('/api/shops/:shopId/products', async (req, res) => {
  const { shopId } = req.params;
  const result = await pool.query(`
    SELECT p.*, pc.name as category_name 
    FROM products p 
    LEFT JOIN product_categories pc ON p.category_id = pc.id 
    WHERE p.shop_id = $1 AND p.is_available = true
    ORDER BY pc.display_order, p.name
  `, [shopId]);
  const categories = {};
  result.rows.forEach(p => {
    const cat = p.category_name || 'أخرى';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(p);
  });
  res.json({ categories });
});

app.get('/api/zones', async (req, res) => {
  const result = await pool.query('SELECT * FROM delivery_zones WHERE is_active = true');
  res.json(result.rows);
});

app.post('/api/orders', async (req, res) => {
  const initData = req.headers['x-telegram-init-data'];
  if (!initData) return res.status(401).json({ error: 'Unauthorized' });
  const urlParams = new URLSearchParams(initData);
  const userString = urlParams.get('user');
  if (!userString) return res.status(401).json({ error: 'Unauthorized' });
  const tgUser = JSON.parse(userString);
  const dbUser = await getDbUser(tgUser.id);
  const { shop_id, items, zone_id, address } = req.body;
  const productIds = items.map(i => i.id);
  const productsResult = await pool.query(
    'SELECT id, name, price FROM products WHERE id = ANY($1::int[]) AND shop_id = $2',
    [productIds, shop_id]
  );
  const productsMap = new Map(productsResult.rows.map(p => [p.id, p]));
  const frozenItems = items.map(item => {
    const p = productsMap.get(item.id);
    return { id: p.id, name: p.name, price: p.price, quantity: item.quantity };
  });
  const subtotal = frozenItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const zoneResult = await pool.query('SELECT base_fee FROM delivery_zones WHERE id = $1', [zone_id]);
  const deliveryFee = zoneResult.rows[0].base_fee;
  const total = subtotal + deliveryFee;
  const orderResult = await pool.query(
    `INSERT INTO orders (customer_id, shop_id, zone_id, items, subtotal, delivery_fee, total_price, address, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending') RETURNING id`,
    [dbUser.id, shop_id, zone_id, JSON.stringify(frozenItems), subtotal, deliveryFee, total, address]
  );
  res.status(201).json({ order_id: orderResult.rows[0].id, total });
});

// ========== Webhook للبوت ==========
app.post('/api/webhook', async (req, res) => {
  try {
    await bot.handleUpdate(req.body);
    res.status(200).send('OK');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error');
  }
});

app.get('/', (req, res) => res.send('🐉 Delivery Dragon API is running.'));

export default app;
