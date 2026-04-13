import express from 'express';
import cors from 'cors';
import { Bot } from 'grammy';
import pkg from 'pg';
const { Pool } = pkg;

const app = express();

// ========== إعداد CORS (يشمل رابط workers.dev) ==========
app.use(cors({
  origin: [
    'https://f8d8f121.delivery-mini-app.pages.dev',
    'https://delivery-mini-app.pages.dev',
    'https://72cdd4ae.delivery-mini-app.pages.dev',
    'https://delivery-mini-app.manhal-almasriiii199119.workers.dev',
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
const MINI_APP_URL = process.env.MINI_APP_URL || 'https://delivery-mini-app.manhal-almasriiii199119.workers.dev';
const ADMIN_ID = process.env.ADMIN_ID;

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

// ========== دوال الإشعارات ==========
async function notifyShop(orderId) {
  try {
    const order = await pool.query(`
      SELECT o.*, u.chat_id as owner_chat_id, s.shop_name 
      FROM orders o 
      JOIN shops s ON o.shop_id = s.id 
      JOIN users u ON s.owner_id = u.id 
      WHERE o.id = $1
    `, [orderId]);
    if (order.rows[0]?.owner_chat_id) {
      await bot.api.sendMessage(order.rows[0].owner_chat_id,
        `🛎 *طلب جديد!*\n\n` +
        `رقم الطلب: #${orderId}\n` +
        `المبلغ: ${order.rows[0].total_price} ل.س\n` +
        `العنوان: ${order.rows[0].address}\n\n` +
        `_يرجى الدخول للوحة التحكم لبدء التحضير._`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (e) { console.error('Notify shop error:', e); }
}

async function notifyCustomer(orderId, status) {
  try {
    const order = await pool.query(`
      SELECT o.*, u.chat_id as customer_chat_id 
      FROM orders o 
      JOIN users u ON o.customer_id = u.id 
      WHERE o.id = $1
    `, [orderId]);
    if (order.rows[0]?.customer_chat_id) {
      const messages = {
        preparing: '👨‍🍳 المطعم بدأ بتحضير طلبك!',
        ready_for_pickup: '📦 طلبك جاهز! جاري البحث عن سائق...',
        delivering: '🛵 السائق في الطريق إليك!',
        completed: '✅ تم توصيل طلبك. شكراً لثقتك!'
      };
      await bot.api.sendMessage(order.rows[0].customer_chat_id,
        `📢 *تحديث الطلب #${orderId}*\n\n${messages[status] || status}`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (e) { console.error('Notify customer error:', e); }
}

async function notifyRiders(orderId) {
  try {
    const order = await pool.query(`
      SELECT o.*, s.shop_name, s.address as shop_address, z.zone_name 
      FROM orders o 
      JOIN shops s ON o.shop_id = s.id 
      JOIN delivery_zones z ON o.zone_id = z.id 
      WHERE o.id = $1
    `, [orderId]);
    const o = order.rows[0];
    if (!o) return;

    // جلب السائقين المعتمدين فقط الذين لديهم chat_id
    const riders = await pool.query(`
      SELECT u.chat_id, u.name 
      FROM users u 
      WHERE u.role = 'rider' AND u.is_approved = true AND u.chat_id IS NOT NULL
    `);

    const messageText = 
      `🚨 *طلب توصيل جديد!*\n\n` +
      `🆔 #${orderId}\n` +
      `🏪 ${o.shop_name} - ${o.shop_address}\n` +
      `📍 إلى: ${o.zone_name} - ${o.address}\n` +
      `💵 الأجرة: ${o.delivery_fee} ل.س\n\n` +
      `_اضغط لفتح لوحة السائق لقبول الطلب._`;

    for (const rider of riders.rows) {
      try {
        await bot.api.sendMessage(rider.chat_id, messageText, { parse_mode: 'Markdown' });
      } catch (e) {
        console.error(`فشل إرسال إشعار إلى ${rider.name || rider.chat_id}:`, e.message);
      }
    }
  } catch (e) { console.error('Notify riders error:', e); }
}

// ========== أوامر البوت ==========
bot.command('start', async (ctx) => {
  const telegramId = ctx.from.id;
  const chatId = ctx.chat.id.toString();
  const name = ctx.from.first_name + (ctx.from.last_name ? ' ' + ctx.from.last_name : '');
  await pool.query(
    `INSERT INTO users (telegram_id, name, role, is_approved, chat_id) 
     VALUES ($1, $2, 'customer', true, $3) 
     ON CONFLICT (telegram_id) DO UPDATE SET chat_id = EXCLUDED.chat_id, name = EXCLUDED.name`,
    [telegramId.toString(), name, chatId]
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

bot.command('track', async (ctx) => {
  const dbUser = await getDbUser(ctx.from.id);
  if (dbUser?.role !== 'rider') return ctx.reply('❌ هذا الأمر للسائقين فقط.');
  ctx.reply('📍 الرجاء مشاركة موقعك المباشر (Live Location) من قائمة المرفقات 📎', {
    reply_markup: { keyboard: [[{ text: '📍 مشاركة الموقع', request_location: true }]], one_time_keyboard: true, resize_keyboard: true }
  });
});

bot.on(':location', async (ctx) => {
  const dbUser = await getDbUser(ctx.from.id);
  if (dbUser?.role !== 'rider') return;
  const { latitude, longitude } = ctx.message.location;
  const activeOrder = await pool.query(
    `SELECT id FROM orders WHERE rider_id = $1 AND status = 'delivering' ORDER BY created_at DESC LIMIT 1`,
    [dbUser.id]
  );
  if (activeOrder.rows[0]) {
    await pool.query(
      `INSERT INTO rider_locations (order_id, latitude, longitude) VALUES ($1, $2, $3)`,
      [activeOrder.rows[0].id, latitude, longitude]
    );
    ctx.reply('✅ تم تحديث موقعك.');
  } else {
    ctx.reply('⚠️ لا يوجد طلب نشط مرتبط بك حاليًا.');
  }
});

// ========== API Routes ==========

app.get('/api/me', async (req, res) => {
  try {
    const initData = req.headers['x-telegram-init-data'];
    if (!initData) return res.status(401).json({ error: 'Unauthorized' });
    const urlParams = new URLSearchParams(initData);
    const userString = urlParams.get('user');
    if (!userString) return res.status(401).json({ error: 'Unauthorized' });
    const tgUser = JSON.parse(userString);
    
    await pool.query(
      `INSERT INTO users (telegram_id, name, role, is_approved) 
       VALUES ($1, $2, 'customer', true) 
       ON CONFLICT (telegram_id) DO NOTHING`,
      [tgUser.id.toString(), tgUser.first_name || 'User']
    );
    
    const dbUser = await getDbUser(tgUser.id);
    res.json(dbUser || { role: 'customer' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/categories', async (req, res) => {
  const result = await pool.query('SELECT * FROM shop_categories');
  res.json(result.rows);
});

app.post('/api/register/shop', async (req, res) => {
  try {
    const initData = req.headers['x-telegram-init-data'];
    if (!initData) return res.status(401).json({ error: 'Unauthorized' });
    const urlParams = new URLSearchParams(initData);
    const userString = urlParams.get('user');
    if (!userString) return res.status(401).json({ error: 'Unauthorized' });
    const tgUser = JSON.parse(userString);
    const { name, shop_name, category_id, phone, address } = req.body;
    
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
    
    await pool.query(
      `INSERT INTO shops (owner_id, shop_name, category_id, phone, address) 
       VALUES ((SELECT id FROM users WHERE telegram_id = $1), $2, $3, $4, $5)`,
      [tgUser.id.toString(), shop_name, category_id, phone, address]
    );
    
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/register/rider', async (req, res) => {
  try {
    const initData = req.headers['x-telegram-init-data'];
    if (!initData) return res.status(401).json({ error: 'Unauthorized' });
    const urlParams = new URLSearchParams(initData);
    const userString = urlParams.get('user');
    if (!userString) return res.status(401).json({ error: 'Unauthorized' });
    const tgUser = JSON.parse(userString);
    const { name, phone, vehicle_type } = req.body;
    
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
    
    await pool.query(
      `INSERT INTO rider_details (user_id, vehicle_type) 
       VALUES ((SELECT id FROM users WHERE telegram_id = $1), $2) 
       ON CONFLICT (user_id) DO UPDATE SET vehicle_type = EXCLUDED.vehicle_type`,
      [tgUser.id.toString(), vehicle_type || 'دراجة']
    );
    
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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

app.get('/api/zones', async (req, res) => {
  const result = await pool.query('SELECT * FROM delivery_zones WHERE is_active = true');
  res.json(result.rows);
});

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
    const orderId = orderResult.rows[0].id;
    
    await notifyShop(orderId);
    
    res.status(201).json({ order_id: orderId, total });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/orders/:orderId/location', async (req, res) => {
  try {
    const { orderId } = req.params;
    const result = await pool.query(
      `SELECT latitude, longitude, updated_at FROM rider_locations WHERE order_id = $1 ORDER BY updated_at DESC LIMIT 1`,
      [orderId]
    );
    res.json(result.rows[0] || {});
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/orders/:orderId/rate', async (req, res) => {
  try {
    const initData = req.headers['x-telegram-init-data'];
    if (!initData) return res.status(401).json({ error: 'Unauthorized' });
    const urlParams = new URLSearchParams(initData);
    const userString = urlParams.get('user');
    if (!userString) return res.status(401).json({ error: 'Unauthorized' });
    const tgUser = JSON.parse(userString);
    const dbUser = await getDbUser(tgUser.id);
    const { orderId } = req.params;
    const { rating, comment, target } = req.body;
    
    const order = await pool.query('SELECT shop_id, rider_id FROM orders WHERE id = $1 AND customer_id = $2', [orderId, dbUser.id]);
    if (!order.rows[0]) return res.status(403).json({ error: 'Order not found or not yours' });
    
    let toUserId = null;
    if (target === 'shop') {
      const shop = await pool.query('SELECT owner_id FROM shops WHERE id = $1', [order.rows[0].shop_id]);
      toUserId = shop.rows[0]?.owner_id;
    } else if (target === 'rider') {
      toUserId = order.rows[0].rider_id;
    }
    if (!toUserId) return res.status(400).json({ error: 'Invalid target' });
    
    await pool.query(
      `INSERT INTO ratings (order_id, from_user_id, to_user_id, rating, comment) VALUES ($1, $2, $3, $4, $5)`,
      [orderId, dbUser.id, toUserId, rating, comment]
    );
    res.json({ success: true });
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
    const { orderId } = req.params;
    await pool.query(
      `UPDATE orders SET status = $1 WHERE id = $2 AND shop_id = (SELECT id FROM shops WHERE owner_id = $3)`,
      [status, orderId, dbUser.id]
    );
    
    if (status === 'ready_for_pickup') {
      await notifyRiders(orderId);
    }
    await notifyCustomer(orderId, status);
    
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
    
    await notifyCustomer(order_id, 'delivering');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/rider/complete-order', async (req, res) => {
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
    const order = await pool.query('SELECT * FROM orders WHERE id = $1 AND rider_id = $2 AND status = $3', [order_id, dbUser.id, 'delivering']);
    if (order.rowCount === 0) return res.status(400).json({ error: 'Invalid order' });
    
    await pool.query(`UPDATE orders SET status = 'completed' WHERE id = $1`, [order_id]);
    
    const o = order.rows[0];
    const platformCommission = o.subtotal * parseFloat(process.env.PLATFORM_COMMISSION_RATE || '0.05');
    const shopNet = o.subtotal - platformCommission;
    const riderFee = o.delivery_fee;
    
    await pool.query(
      `UPDATE orders SET platform_commission = $1, shop_net = $2, rider_fee = $3 WHERE id = $4`,
      [platformCommission, shopNet, riderFee, order_id]
    );
    
    await pool.query(
      `INSERT INTO financial_transactions (order_id, transaction_type, amount) VALUES 
       ($1, 'platform_fee', $2), ($1, 'shop_payout', $3), ($1, 'rider_payout', $4)`,
      [order_id, platformCommission, shopNet, riderFee]
    );
    
    await notifyCustomer(order_id, 'completed');
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

app.get('/api/admin/finance', async (req, res) => {
  try {
    const initData = req.headers['x-telegram-init-data'];
    if (!initData) return res.status(401).json({ error: 'Unauthorized' });
    const urlParams = new URLSearchParams(initData);
    const userString = urlParams.get('user');
    if (!userString) return res.status(401).json({ error: 'Unauthorized' });
    const tgUser = JSON.parse(userString);
    const dbUser = await getDbUser(tgUser.id);
    if (dbUser?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    
    const summary = await pool.query(`
      SELECT 
        (SELECT COALESCE(SUM(platform_commission),0) FROM orders WHERE status = 'completed') as total_platform_fees,
        (SELECT COALESCE(SUM(amount),0) FROM financial_transactions WHERE transaction_type = 'shop_payout' AND status = 'pending') as pending_shop_payouts,
        (SELECT COALESCE(SUM(amount),0) FROM financial_transactions WHERE transaction_type = 'rider_payout' AND status = 'pending') as pending_rider_payouts
    `);
    res.json(summary.rows[0]);
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
