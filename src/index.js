import express from 'express';
import cors from 'cors';
import { Bot } from 'grammy';
import pkg from 'pg';
const { Pool } = pkg;

const app = express();

// ========== إعداد CORS ==========
app.use(cors({
  origin: [
    'https://f8d8f121.delivery-mini-app.pages.dev',
    'https://delivery-mini-app.pages.dev',
    'https://72cdd4ae.delivery-mini-app.pages.dev',
    'https://delivery-dragon.vercel.app'
  ],
  credentials: true
}));
app.use(express.json());

// ========== إعداد قاعدة البيانات ==========
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ========== إعداد البوت ==========
const bot = new Bot(process.env.BOT_TOKEN);
const MINI_APP_URL = process.env.MINI_APP_URL || 'https://f8d8f121.delivery-mini-app.pages.dev';

let botInitialized = false;
async function ensureBotInitialized() {
  if (!botInitialized) {
    await bot.init();
    botInitialized = true;
    console.log('✅ Bot initialized');
  }
}

async function getDbUser(telegramId) {
  const res = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [telegramId.toString()]);
  return res.rows[0];
}

// ========== أوامر البوت ==========
bot.command('start', async (ctx) => {
  const telegramId = ctx.from.id;
  const name = ctx.from.first_name + (ctx.from.last_name ? ' ' + ctx.from.last_name : '');
  await pool.query(
    `INSERT INTO users (telegram_id, name, role, is_approved) 
     VALUES ($1, $2, 'customer', true) 
     ON CONFLICT (telegram_id) DO UPDATE SET name = EXCLUDED.name`,
    [telegramId.toString(), name]
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

// ---- معلومات المستخدم ----
app.get('/api/me', async (req, res) => {
  try {
    const initData = req.headers['x-telegram-init-data'];
    if (!initData) return res.status(401).json({ error: 'Unauthorized' });
    const urlParams = new URLSearchParams(initData);
    const userString = urlParams.get('user');
    if (!userString) return res.status(401).json({ error: 'Unauthorized' });
    const tgUser = JSON.parse(userString);
    
    // تأكد من وجود المستخدم في DB (أنشئه كزبون إذا لم يكن موجودًا)
    await pool.query(
      `INSERT INTO users (telegram_id, name, role, is_approved) 
       VALUES ($1, $2, 'customer', true) 
       ON CONFLICT (telegram_id) DO NOTHING`,
      [tgUser.id.toString(), tgUser.first_name || 'User']
    );
    
    const dbUser = await getDbUser(tgUser.id);
    res.json(dbUser || { role: 'customer' });
  } catch (error) {
    console.error('/api/me error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ---- فئات المحلات ----
app.get('/api/categories', async (req, res) => {
  const result = await pool.query('SELECT * FROM shop_categories');
  res.json(result.rows);
});

// ---- تسجيل تاجر (مع ضمان وجود المستخدم) ----
app.post('/api/register/shop', async (req, res) => {
  try {
    const initData = req.headers['x-telegram-init-data'];
    if (!initData) return res.status(401).json({ error: 'Unauthorized' });
    const urlParams = new URLSearchParams(initData);
    const userString = urlParams.get('user');
    if (!userString) return res.status(401).json({ error: 'Unauthorized' });
    const tgUser = JSON.parse(userString);
    const { name, shop_name, category_id, phone, address } = req.body;
    
    // إنشاء أو تحديث المستخدم
    await pool.query(
      `INSERT INTO users (telegram_id, name, phone, role, is_approved) 
       VALUES ($1, $2, $3, 'shop', false) 
       ON CONFLICT (telegram_id) DO UPDATE SET 
         name = EXCLUDED.name, 
         phone = EXCLUDED.phone, 
         role = 'shop', 
         is_approved = false`,
      [tgUser.id.toString(), name, phone]
    );
    
    // إدراج المحل
    await pool.query(
      `INSERT INTO shops (owner_id, shop_name, category_id, phone, address) 
       VALUES ((SELECT id FROM users WHERE telegram_id = $1), $2, $3, $4, $5)`,
      [tgUser.id.toString(), shop_name, category_id, phone, address]
    );
    
    res.status(201).json({ success: true });
  } catch (error) {
    console.error('/api/register/shop error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ---- تسجيل سائق (مع ضمان وجود المستخدم) ----
app.post('/api/register/rider', async (req, res) => {
  try {
    const initData = req.headers['x-telegram-init-data'];
    if (!initData) return res.status(401).json({ error: 'Unauthorized' });
    const urlParams = new URLSearchParams(initData);
    const userString = urlParams.get('user');
    if (!userString) return res.status(401).json({ error: 'Unauthorized' });
    const tgUser = JSON.parse(userString);
    const { name, phone, vehicle_type } = req.body;
    
    // إنشاء أو تحديث المستخدم
    await pool.query(
      `INSERT INTO users (telegram_id, name, phone, role, is_approved) 
       VALUES ($1, $2, $3, 'rider', false) 
       ON CONFLICT (telegram_id) DO UPDATE SET 
         name = EXCLUDED.name, 
         phone = EXCLUDED.phone, 
         role = 'rider', 
         is_approved = false`,
      [tgUser.id.toString(), name, phone]
    );
    
    // إدراج تفاصيل السائق
    await pool.query(
      `INSERT INTO rider_details (user_id, vehicle_type) 
       VALUES ((SELECT id FROM users WHERE telegram_id = $1), $2) 
       ON CONFLICT (user_id) DO UPDATE SET vehicle_type = EXCLUDED.vehicle_type`,
      [tgUser.id.toString(), vehicle_type || 'دراجة']
    );
    
    res.status(201).json({ success: true });
  } catch (error) {
    console.error('/api/register/rider error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ---- جلب المحلات ----
app.get('/api/shops', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.*, c.name as category_name, c.icon 
      FROM shops s 
      LEFT JOIN shop_categories c ON s.category_id = c.id 
      WHERE s.is_open = true
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- جلب منتجات محل ----
app.get('/api/shops/:shopId/products', async (req, res) => {
  try {
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
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- مناطق التوصيل ----
app.get('/api/zones', async (req, res) => {
  const result = await pool.query('SELECT * FROM delivery_zones WHERE is_active = true');
  res.json(result.rows);
});

// ---- إنشاء طلب ----
app.post('/api/orders', async (req, res) => {
  try {
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
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== لوحة تحكم التاجر ==========
app.get('/api/shop/orders', async (req, res) => {
  try {
    const initData = req.headers['x-telegram-init-data'];
    if (!initData) return res.status(401).json({ error: 'Unauthorized' });
    const urlParams = new URLSearchParams(initData);
    const userString = urlParams.get('user');
    if (!userString) return res.status(401).json({ error: 'Unauthorized' });
    const tgUser = JSON.parse(userString);
    const dbUser = await getDbUser(tgUser.id);
    if (dbUser?.role !== 'shop' || !dbUser?.is_approved) return res.status(403).json({ error: 'Forbidden' });
    
    const orders = await pool.query(`
      SELECT o.*, u.name as customer_name 
      FROM orders o 
      JOIN users u ON o.customer_id = u.id 
      WHERE o.shop_id = (SELECT id FROM shops WHERE owner_id = $1) 
      ORDER BY o.created_at DESC
    `, [dbUser.id]);
    res.json(orders.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/shop/orders/:orderId/status', async (req, res) => {
  try {
    const initData = req.headers['x-telegram-init-data'];
    if (!initData) return res.status(401).json({ error: 'Unauthorized' });
    const urlParams = new URLSearchParams(initData);
    const userString = urlParams.get('user');
    if (!userString) return res.status(401).json({ error: 'Unauthorized' });
    const tgUser = JSON.parse(userString);
    const dbUser = await getDbUser(tgUser.id);
    if (dbUser?.role !== 'shop') return res.status(403).json({ error: 'Forbidden' });
    
    const { status } = req.body;
    await pool.query(
      `UPDATE orders SET status = $1 WHERE id = $2 AND shop_id = (SELECT id FROM shops WHERE owner_id = $3)`,
      [status, req.params.orderId, dbUser.id]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/shop/products', async (req, res) => {
  try {
    const initData = req.headers['x-telegram-init-data'];
    if (!initData) return res.status(401).json({ error: 'Unauthorized' });
    const urlParams = new URLSearchParams(initData);
    const userString = urlParams.get('user');
    if (!userString) return res.status(401).json({ error: 'Unauthorized' });
    const tgUser = JSON.parse(userString);
    const dbUser = await getDbUser(tgUser.id);
    if (dbUser?.role !== 'shop') return res.status(403).json({ error: 'Forbidden' });
    
    const products = await pool.query(
      `SELECT * FROM products WHERE shop_id = (SELECT id FROM shops WHERE owner_id = $1) ORDER BY name`,
      [dbUser.id]
    );
    res.json(products.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/shop/products', async (req, res) => {
  try {
    const initData = req.headers['x-telegram-init-data'];
    if (!initData) return res.status(401).json({ error: 'Unauthorized' });
    const urlParams = new URLSearchParams(initData);
    const userString = urlParams.get('user');
    if (!userString) return res.status(401).json({ error: 'Unauthorized' });
    const tgUser = JSON.parse(userString);
    const dbUser = await getDbUser(tgUser.id);
    if (dbUser?.role !== 'shop') return res.status(403).json({ error: 'Forbidden' });
    
    const { name, price, category_id } = req.body;
    await pool.query(
      `INSERT INTO products (shop_id, name, price, category_id) VALUES ((SELECT id FROM shops WHERE owner_id = $1), $2, $3, $4)`,
      [dbUser.id, name, price, category_id || null]
    );
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== لوحة السائق ==========
app.get('/api/rider/available-orders', async (req, res) => {
  try {
    const initData = req.headers['x-telegram-init-data'];
    if (!initData) return res.status(401).json({ error: 'Unauthorized' });
    const urlParams = new URLSearchParams(initData);
    const userString = urlParams.get('user');
    if (!userString) return res.status(401).json({ error: 'Unauthorized' });
    const tgUser = JSON.parse(userString);
    const dbUser = await getDbUser(tgUser.id);
    if (dbUser?.role !== 'rider' || !dbUser?.is_approved) return res.status(403).json({ error: 'Forbidden' });
    
    const orders = await pool.query(`
      SELECT o.*, s.shop_name, s.address as shop_address, z.zone_name 
      FROM orders o 
      JOIN shops s ON o.shop_id = s.id 
      JOIN delivery_zones z ON o.zone_id = z.id 
      WHERE o.status = 'ready_for_pickup' AND o.rider_id IS NULL
    `);
    res.json(orders.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/rider/accept-order', async (req, res) => {
  try {
    const initData = req.headers['x-telegram-init-data'];
    if (!initData) return res.status(401).json({ error: 'Unauthorized' });
    const urlParams = new URLSearchParams(initData);
    const userString = urlParams.get('user');
    if (!userString) return res.status(401).json({ error: 'Unauthorized' });
    const tgUser = JSON.parse(userString);
    const dbUser = await getDbUser(tgUser.id);
    if (dbUser?.role !== 'rider') return res.status(403).json({ error: 'Forbidden' });
    
    const { order_id } = req.body;
    const result = await pool.query(
      `UPDATE orders SET rider_id = $1, status = 'delivering', rider_accepted_at = NOW() 
       WHERE id = $2 AND rider_id IS NULL AND status = 'ready_for_pickup'`,
      [dbUser.id, order_id]
    );
    if (result.rowCount === 0) return res.status(409).json({ error: 'Order already taken' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== لوحة الأدمن ==========
app.get('/api/admin/pending', async (req, res) => {
  try {
    const initData = req.headers['x-telegram-init-data'];
    if (!initData) return res.status(401).json({ error: 'Unauthorized' });
    const urlParams = new URLSearchParams(initData);
    const userString = urlParams.get('user');
    if (!userString) return res.status(401).json({ error: 'Unauthorized' });
    const tgUser = JSON.parse(userString);
    
    // تحقق من أن المستخدم أدمن
    const dbUser = await getDbUser(tgUser.id);
    if (dbUser?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    
    const pending = await pool.query(`
      SELECT id, telegram_id, name, phone, role, created_at 
      FROM users 
      WHERE is_approved = false AND role IN ('shop', 'rider')
      ORDER BY created_at DESC
    `);
    res.json(pending.rows);
  } catch (error) {
    console.error('/api/admin/pending error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/approve', async (req, res) => {
  try {
    const initData = req.headers['x-telegram-init-data'];
    if (!initData) return res.status(401).json({ error: 'Unauthorized' });
    const urlParams = new URLSearchParams(initData);
    const userString = urlParams.get('user');
    if (!userString) return res.status(401).json({ error: 'Unauthorized' });
    const tgUser = JSON.parse(userString);
    
    const dbUser = await getDbUser(tgUser.id);
    if (dbUser?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    
    const { user_id } = req.body;
    await pool.query(`UPDATE users SET is_approved = true WHERE id = $1`, [user_id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== Webhook ==========
app.post('/api/webhook', async (req, res) => {
  try {
    await ensureBotInitialized();
    await bot.handleUpdate(req.body);
    res.status(200).send('OK');
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).send('Error');
  }
});

app.get('/', (req, res) => res.send('🐉 Delivery Dragon API is running.'));

export default app;
