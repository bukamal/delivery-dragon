import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { Bot } from 'grammy';
import pkg from 'pg';
import { validate } from '@telegram-apps/init-data-node';
const { Pool } = pkg;

const app = express();

// ========== تحسينات الأمان ==========
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://telegram.org", "https://unpkg.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://delivery-dragon.vercel.app", "https://delivery-mini-app.manhal-almasriiii199119.workers.dev"]
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

const allowedOrigins = [
  'https://f8d8f121.delivery-mini-app.pages.dev',
  'https://delivery-mini-app.pages.dev',
  'https://72cdd4ae.delivery-mini-app.pages.dev',
  'https://delivery-mini-app.manhal-almasriiii199119.workers.dev',
  'https://delivery-dragon.vercel.app'
];
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
app.use(express.json());

// ========== دوال التحقق من initData ==========
function verifyInitData(initData) {
  if (!initData) return { valid: false, error: 'Missing init data' };
  try {
    const botToken = process.env.BOT_TOKEN;
    validate(initData, botToken);
    return { valid: true };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

function extractTgUser(initData) {
  const params = new URLSearchParams(initData);
  const userString = params.get('user');
  if (!userString) return null;
  return JSON.parse(userString);
}

// ========== Middleware للمصادقة ==========
// صارم: يرفض الطلب إذا فشل التحقق
function requireAuth(req, res, next) {
  const initData = req.headers['x-telegram-init-data'];
  const verification = verifyInitData(initData);
  if (!verification.valid) {
    return res.status(401).json({ error: 'Unauthorized', details: verification.error });
  }
  req.tgUser = extractTgUser(initData);
  if (!req.tgUser) {
    return res.status(401).json({ error: 'Invalid user data' });
  }
  next();
}

// مرن: يحاول التحقق لكنه لا يرفض الطلب إذا فشل (للمسارات العامة)
function optionalAuth(req, res, next) {
  const initData = req.headers['x-telegram-init-data'];
  if (initData) {
    const verification = verifyInitData(initData);
    if (verification.valid) {
      req.tgUser = extractTgUser(initData);
    }
  }
  next();
}

// ========== قاعدة البيانات والبوت ==========
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const bot = new Bot(process.env.BOT_TOKEN);
const MINI_APP_URL = process.env.MINI_APP_URL || 'https://delivery-mini-app.manhal-almasriiii199119.workers.dev';
const ADMIN_ID = process.env.ADMIN_ID;
const PLATFORM_FIXED_FEE = parseFloat(process.env.PLATFORM_FIXED_FEE || '5000');

let botInitialized = false;
async function ensureBotInitialized() { if (!botInitialized) { await bot.init(); botInitialized = true; console.log('✅ Bot initialized'); } }
async function getDbUser(telegramId) { const res = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [telegramId.toString()]); return res.rows[0]; }

// ========== دوال الإشعارات ==========
// ... (نفس الدوال السابقة بدون تغيير) ...
async function notifyShop(orderId) {
  try {
    const order = await pool.query(`SELECT o.*, u.chat_id as owner_chat_id FROM orders o JOIN shops s ON o.shop_id=s.id JOIN users u ON s.owner_id=u.id WHERE o.id=$1`,[orderId]);
    if (order.rows[0]?.owner_chat_id) await bot.api.sendMessage(order.rows[0].owner_chat_id, `🛎 *طلب جديد!*\n\nرقم الطلب: #${orderId}\nالمبلغ: ${order.rows[0].total_price} ل.س\nالعنوان: ${order.rows[0].address}\n\n_يرجى الدخول للوحة التحكم لبدء التحضير._`,{parse_mode:'Markdown'});
  } catch(e){ console.error('Notify shop error:',e); }
}
async function notifyCustomer(orderId, status) {
  try {
    const order = await pool.query(`SELECT o.*, u.chat_id as customer_chat_id FROM orders o JOIN users u ON o.customer_id=u.id WHERE o.id=$1`,[orderId]);
    if (order.rows[0]?.customer_chat_id) {
      const messages = { paid:'💰 تم تأكيد الدفع! جاري تجهيز طلبك.', preparing:'👨‍🍳 المطعم بدأ بتحضير طلبك!', ready_for_pickup:'📦 طلبك جاهز! جاري البحث عن سائق...', delivering:'🛵 السائق في الطريق إليك!', completed:'✅ تم توصيل طلبك. شكراً لثقتك!' };
      await bot.api.sendMessage(order.rows[0].customer_chat_id, `📢 *تحديث الطلب #${orderId}*\n\n${messages[status]||status}`,{parse_mode:'Markdown'});
    }
  } catch(e){ console.error('Notify customer error:',e); }
}
async function notifyRiders(orderId) {
  try {
    const order = await pool.query(`SELECT o.*, s.shop_name, s.address as shop_address, z.zone_name FROM orders o JOIN shops s ON o.shop_id=s.id JOIN delivery_zones z ON o.zone_id=z.id WHERE o.id=$1`,[orderId]);
    const o = order.rows[0]; if (!o) return;
    const riders = await pool.query(`SELECT u.chat_id, u.name FROM users u WHERE u.role='rider' AND u.is_approved=true AND u.chat_id IS NOT NULL`);
    const msg = `🚨 *طلب توصيل جديد!*\n\n🆔 #${orderId}\n🏪 ${o.shop_name} - ${o.shop_address}\n📍 إلى: ${o.zone_name} - ${o.address}\n💵 الأجرة: ${o.delivery_fee} ل.س\n\n_اضغط لفتح لوحة السائق لقبول الطلب._`;
    for (const r of riders.rows) { try { await bot.api.sendMessage(r.chat_id, msg, {parse_mode:'Markdown'}); } catch(e){} }
  } catch(e){ console.error('Notify riders error:',e); }
}

// ========== أوامر البوت ==========
// ... (نفس الأوامر السابقة) ...
bot.command('start', async (ctx) => {
  const telegramId = ctx.from.id; const chatId = ctx.chat.id.toString(); const name = ctx.from.first_name + (ctx.from.last_name ? ' ' + ctx.from.last_name : '');
  await pool.query(`INSERT INTO users (telegram_id, name, role, is_approved, chat_id) VALUES ($1,$2,'customer',true,$3) ON CONFLICT(telegram_id) DO UPDATE SET chat_id=EXCLUDED.chat_id, name=EXCLUDED.name`,[telegramId.toString(), name, chatId]);
  ctx.reply('🦅 أهلاً بك في *شاهين - نحن أسرع إليك*! اضغط الزر لفتح التطبيق:', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🚀 افتح شاهين', web_app: { url: MINI_APP_URL } }]] } });
});
bot.command('menu', (ctx) => ctx.reply('اضغط الزر أدناه لتصفح المطاعم:', { reply_markup: { inline_keyboard: [[{ text: '🍔 تصفح المطاعم', web_app: { url: MINI_APP_URL } }]] } }));
bot.command('track', async (ctx) => { const dbUser = await getDbUser(ctx.from.id); if (dbUser?.role !== 'rider') return ctx.reply('❌ هذا الأمر للسائقين فقط.'); ctx.reply('📍 الرجاء مشاركة موقعك المباشر (Live Location) من قائمة المرفقات 📎', { reply_markup: { keyboard: [[{ text: '📍 مشاركة الموقع', request_location: true }]], one_time_keyboard: true, resize_keyboard: true } }); });
bot.on(':location', async (ctx) => { const dbUser = await getDbUser(ctx.from.id); if (dbUser?.role !== 'rider') return; const { latitude, longitude } = ctx.message.location; const activeOrder = await pool.query(`SELECT id FROM orders WHERE rider_id=$1 AND status='delivering' ORDER BY created_at DESC LIMIT 1`,[dbUser.id]); if (activeOrder.rows[0]) { await pool.query(`INSERT INTO rider_locations (order_id, latitude, longitude) VALUES ($1,$2,$3)`,[activeOrder.rows[0].id, latitude, longitude]); ctx.reply('✅ تم تحديث موقعك.'); } else { ctx.reply('⚠️ لا يوجد طلب نشط مرتبط بك حاليًا.'); } });
bot.on('edited_message', async (ctx) => { const msg = ctx.editedMessage; if (!msg.location) return; const dbUser = await getDbUser(msg.from.id); if (dbUser?.role !== 'rider') return; const { latitude, longitude } = msg.location; const activeOrder = await pool.query(`SELECT id FROM orders WHERE rider_id=$1 AND status='delivering' ORDER BY created_at DESC LIMIT 1`,[dbUser.id]); if (activeOrder.rows[0]) { await pool.query(`INSERT INTO rider_locations (order_id, latitude, longitude) VALUES ($1, $2, $3)`,[activeOrder.rows[0].id, latitude, longitude]); } });
bot.on(':photo', async (ctx) => {
  const userId = ctx.from.id;
  const dbUser = await getDbUser(userId);
  if (!dbUser) return ctx.reply('❌ لم يتم العثور على حسابك. أرسل /start أولاً.');
  const order = await pool.query(`SELECT id, total_price FROM orders WHERE customer_id=$1 AND status='verifying' ORDER BY created_at DESC LIMIT 1`, [dbUser.id]);
  if (!order.rows[0]) return ctx.reply('❌ لا يوجد طلب معلق بانتظار الدفع. قم بإنشاء طلب أولاً من التطبيق.');
  const orderId = order.rows[0].id;
  const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
  await pool.query(`UPDATE orders SET screenshot_file_id=$1, status=$2 WHERE id=$3 AND status='verifying'`, [fileId, 'pending', orderId]);
  if (ADMIN_ID) {
    await bot.api.sendMessage(ADMIN_ID, `🛡 *طلب جديد للمراجعة*\n\nرقم الطلب: #${orderId}\nالزبون: ${dbUser.name || ctx.from.first_name}\nالمبلغ: ${order.rows[0].total_price} ل.س\n\n[اضغط لمراجعة الطلب](${MINI_APP_URL}/admin-dashboard.html)`, { parse_mode: 'Markdown' });
  }
  ctx.reply('✅ تم استلام لقطة الشاشة. سيقوم الأدمن بمراجعة طلبك قريباً.');
});

// ========== API Routes ==========
// المسارات العامة (لا تحتاج مصادقة صارمة)
app.get('/api/categories', optionalAuth, async (req, res) => { const result = await pool.query('SELECT * FROM shop_categories'); res.json(result.rows); });
app.get('/api/cities', optionalAuth, async (req, res) => { const result = await pool.query('SELECT * FROM cities WHERE is_active = true ORDER BY name'); res.json(result.rows); });
app.get('/api/zones', optionalAuth, async (req, res) => { const { city_id } = req.query; let query = 'SELECT * FROM delivery_zones WHERE is_active = true'; const params = []; if (city_id) { query += ' AND city_id = $1'; params.push(city_id); } query += ' ORDER BY zone_name'; const result = await pool.query(query, params); res.json(result.rows); });
app.get('/api/shops', optionalAuth, async (req, res) => { try { const { city_id, page=1, limit=20 } = req.query; const offset = (page-1)*limit; let query = `SELECT s.*, c.name as category_name, c.icon FROM shops s LEFT JOIN shop_categories c ON s.category_id=c.id WHERE s.is_open=true`; const params = []; if (city_id) { query += ' AND s.city_id = $1'; params.push(city_id); } query += ` ORDER BY s.created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`; params.push(limit, offset); const result = await pool.query(query, params); res.json(result.rows); } catch(error) { res.status(500).json({ error: error.message }); } });
app.get('/api/shops/:shopId/products', optionalAuth, async (req, res) => { try { const { shopId } = req.params; const result = await pool.query(`SELECT p.*, pc.name as category_name FROM products p LEFT JOIN product_categories pc ON p.category_id=pc.id WHERE p.shop_id=$1 AND p.is_available=true ORDER BY pc.display_order, p.name`,[shopId]); const categories = {}; result.rows.forEach(p => { const cat = p.category_name || 'أخرى'; if (!categories[cat]) categories[cat] = []; categories[cat].push(p); }); res.json({ categories }); } catch(error) { res.status(500).json({ error: error.message }); } });

// المسارات المحمية (تتطلب مصادقة صارمة)
app.use('/api', requireAuth); // هذا سيُطبق على جميع المسارات التالية

app.get('/api/me', async (req, res) => {
  try {
    const tgUser = req.tgUser;
    await pool.query(`INSERT INTO users (telegram_id, name, role, is_approved) VALUES ($1,$2,'customer',true) ON CONFLICT(telegram_id) DO NOTHING`,[tgUser.id.toString(), tgUser.first_name||'User']);
    const dbUser = await getDbUser(tgUser.id);
    res.json(dbUser || { role:'customer' });
  } catch(error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/register/shop', async (req, res) => { try { const tgUser = req.tgUser; const { name, shop_name, category_id, phone, address, city_id } = req.body; await pool.query(`INSERT INTO users (telegram_id, name, phone, role, is_approved) VALUES ($1,$2,$3,'shop',false) ON CONFLICT(telegram_id) DO UPDATE SET name=EXCLUDED.name, phone=EXCLUDED.phone, role='shop', is_approved=false`,[tgUser.id.toString(), name, phone]); await pool.query(`INSERT INTO shops (owner_id, shop_name, category_id, phone, address, city_id) VALUES ((SELECT id FROM users WHERE telegram_id=$1),$2,$3,$4,$5,$6)`,[tgUser.id.toString(), shop_name, category_id, phone, address, city_id]); res.status(201).json({ success: true }); } catch(error) { res.status(500).json({ error: error.message }); } });
app.post('/api/register/rider', async (req, res) => { try { const tgUser = req.tgUser; const { name, phone, vehicle_type } = req.body; await pool.query(`INSERT INTO users (telegram_id, name, phone, role, is_approved) VALUES ($1,$2,$3,'rider',false) ON CONFLICT(telegram_id) DO UPDATE SET name=EXCLUDED.name, phone=EXCLUDED.phone, role='rider', is_approved=false`,[tgUser.id.toString(), name, phone]); await pool.query(`INSERT INTO rider_details (user_id, vehicle_type) VALUES ((SELECT id FROM users WHERE telegram_id=$1),$2) ON CONFLICT(user_id) DO UPDATE SET vehicle_type=EXCLUDED.vehicle_type`,[tgUser.id.toString(), vehicle_type||'دراجة']); res.status(201).json({ success: true }); } catch(error) { res.status(500).json({ error: error.message }); } });

app.post('/api/orders', async (req, res) => { try { const tgUser = req.tgUser; const dbUser = await getDbUser(tgUser.id); if (!dbUser) return res.status(401).json({ error: 'User not found' }); const { shop_id, items, zone_id, address, city_id } = req.body; const productIds = items.map(i => i.id); const productsResult = await pool.query(`SELECT id, name, price FROM products WHERE id = ANY($1::int[]) AND shop_id=$2`,[productIds, shop_id]); const productsMap = new Map(productsResult.rows.map(p=>[p.id, p])); const frozenItems = items.map(item => { const productId = parseInt(item.id, 10); const p = productsMap.get(productId); if (!p) throw new Error(`المنتج ${item.id} غير موجود`); return { id: p.id, name: p.name, price: p.price, quantity: item.quantity }; }); const subtotal = frozenItems.reduce((sum, i) => sum + i.price * i.quantity, 0); const zoneResult = await pool.query('SELECT base_fee FROM delivery_zones WHERE id=$1',[zone_id]); if (!zoneResult.rows[0]) throw new Error('Zone not found'); const deliveryFee = zoneResult.rows[0].base_fee; const total = subtotal + deliveryFee; const orderResult = await pool.query(`INSERT INTO orders (customer_id, shop_id, zone_id, items, subtotal, delivery_fee, total_price, address, city_id, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'verifying') RETURNING id`,[dbUser.id, shop_id, zone_id, JSON.stringify(frozenItems), subtotal, deliveryFee, total, address, city_id]); const orderId = orderResult.rows[0].id; if (dbUser.chat_id) await bot.api.sendMessage(dbUser.chat_id, `📸 *تم إنشاء الطلب #${orderId}*\n\nالمبلغ الإجمالي: ${total} ل.س\n\nالرجاء إرسال لقطة شاشة عملية الدفع الآن (كصورة) لتأكيد الطلب.`, { parse_mode: 'Markdown' }); res.status(201).json({ order_id: orderId, total }); } catch (error) { console.error('/api/orders error:', error); res.status(500).json({ error: error.message }); } });

app.get('/api/me/orders', async (req, res) => { try { const tgUser = req.tgUser; const dbUser = await getDbUser(tgUser.id); const orders = await pool.query(`SELECT o.*, s.shop_name FROM orders o JOIN shops s ON o.shop_id=s.id WHERE o.customer_id=$1 ORDER BY o.created_at DESC`,[dbUser.id]); res.json(orders.rows); } catch(error) { res.status(500).json({ error: error.message }); } });
app.get('/api/shop/orders', async (req, res) => { try { const tgUser = req.tgUser; const dbUser = await getDbUser(tgUser.id); if (dbUser?.role !== 'shop' || !dbUser?.is_approved) return res.status(403).json({ error: 'Forbidden' }); const shop = await pool.query('SELECT id FROM shops WHERE owner_id=$1',[dbUser.id]); if (!shop.rows[0]) return res.json([]); const shopId = shop.rows[0].id; const { archived } = req.query; let statusCondition = archived === 'true' ? `o.status IN ('completed', 'rejected')` : `o.status IN ('paid', 'preparing', 'ready_for_pickup', 'delivering')`; const orders = await pool.query(`SELECT o.*, u_customer.name as customer_name, u_customer.phone as customer_phone, u_rider.name as rider_name FROM orders o JOIN users u_customer ON o.customer_id = u_customer.id LEFT JOIN users u_rider ON o.rider_id = u_rider.id WHERE o.shop_id = $1 AND ${statusCondition} ORDER BY o.created_at DESC`, [shopId]); res.json(orders.rows); } catch(error) { res.status(500).json({ error: error.message }); } });
app.post('/api/shop/orders/:orderId/status', async (req, res) => { try { const tgUser = req.tgUser; const dbUser = await getDbUser(tgUser.id); if (dbUser?.role !== 'shop') return res.status(403).json({ error: 'Forbidden' }); const { status } = req.body; const { orderId } = req.params; await pool.query(`UPDATE orders SET status=$1 WHERE id=$2 AND shop_id=(SELECT id FROM shops WHERE owner_id=$3)`,[status, orderId, dbUser.id]); if (status==='ready_for_pickup') await notifyRiders(orderId); await notifyCustomer(orderId, status); res.json({ success: true }); } catch(error) { res.status(500).json({ error: error.message }); } });
app.get('/api/shop/products', async (req, res) => { try { const tgUser = req.tgUser; const dbUser = await getDbUser(tgUser.id); if (dbUser?.role !== 'shop') return res.status(403).json({ error: 'Forbidden' }); const products = await pool.query(`SELECT * FROM products WHERE shop_id=(SELECT id FROM shops WHERE owner_id=$1) ORDER BY name`,[dbUser.id]); res.json(products.rows); } catch(error) { res.status(500).json({ error: error.message }); } });
app.post('/api/shop/products', async (req, res) => { try { const tgUser = req.tgUser; const dbUser = await getDbUser(tgUser.id); if (dbUser?.role !== 'shop') return res.status(403).json({ error: 'Forbidden' }); const { name, price, category_id } = req.body; await pool.query(`INSERT INTO products (shop_id, name, price, category_id) VALUES ((SELECT id FROM shops WHERE owner_id=$1),$2,$3,$4)`,[dbUser.id, name, price, category_id||null]); res.status(201).json({ success: true }); } catch(error) { res.status(500).json({ error: error.message }); } });
app.delete('/api/shop/products/:productId', async (req, res) => { try { const tgUser = req.tgUser; const dbUser = await getDbUser(tgUser.id); if (dbUser?.role !== 'shop') return res.status(403).json({ error: 'Forbidden' }); await pool.query(`DELETE FROM products WHERE id=$1 AND shop_id=(SELECT id FROM shops WHERE owner_id=$2)`,[req.params.productId, dbUser.id]); res.json({ success: true }); } catch(error) { res.status(500).json({ error: error.message }); } });

// ========== السائق ==========
app.get('/api/rider/available-orders', async (req, res) => { try { const tgUser = req.tgUser; const dbUser = await getDbUser(tgUser.id); if (dbUser?.role !== 'rider' || !dbUser?.is_approved) return res.status(403).json({ error: 'Forbidden' }); const orders = await pool.query(`SELECT o.*, s.shop_name, s.address as shop_address, z.zone_name FROM orders o JOIN shops s ON o.shop_id=s.id JOIN delivery_zones z ON o.zone_id=z.id WHERE o.status='ready_for_pickup' AND o.rider_id IS NULL`); res.json(orders.rows); } catch(error) { res.status(500).json({ error: error.message }); } });
app.post('/api/rider/accept-order', async (req, res) => { try { const tgUser = req.tgUser; const dbUser = await getDbUser(tgUser.id); if (dbUser?.role !== 'rider') return res.status(403).json({ error: 'Forbidden' }); const { order_id } = req.body; const result = await pool.query(`UPDATE orders SET rider_id=$1, status='delivering', rider_accepted_at=NOW() WHERE id=$2 AND rider_id IS NULL AND status='ready_for_pickup'`,[dbUser.id, order_id]); if (result.rowCount===0) return res.status(409).json({ error:'Order already taken' }); await notifyCustomer(order_id, 'delivering'); const shopOwner = await pool.query(`SELECT u.chat_id FROM users u JOIN shops s ON u.id = s.owner_id WHERE s.id = (SELECT shop_id FROM orders WHERE id = $1)`, [order_id]); if (shopOwner.rows[0]?.chat_id) { await bot.api.sendMessage(shopOwner.rows[0].chat_id, `🛵 *السائق ${dbUser.name} قبل طلبك #${order_id}*\nسيقوم بتوصيله قريباً.`, { parse_mode: 'Markdown' }); } await bot.api.sendMessage(dbUser.chat_id, `✅ *تم قبول الطلب #${order_id}*\n\n📍 الرجاء مشاركة موقعك الحي (Live Location) من قائمة المرفقات 📎 لمدة 8 ساعات.`, { parse_mode: 'Markdown' }); res.json({ success: true }); } catch(error) { res.status(500).json({ error: error.message }); } });
app.get('/api/rider/active-order', async (req, res) => { try { const tgUser = req.tgUser; const dbUser = await getDbUser(tgUser.id); if (dbUser?.role !== 'rider' || !dbUser?.is_approved) return res.status(403).json({ error: 'Forbidden' }); const activeOrder = await pool.query(`SELECT o.*, s.shop_name, s.address as shop_address, z.zone_name FROM orders o JOIN shops s ON o.shop_id = s.id JOIN delivery_zones z ON o.zone_id = z.id WHERE o.rider_id = $1 AND o.status = 'delivering' ORDER BY o.created_at DESC LIMIT 1`, [dbUser.id]); res.json(activeOrder.rows[0] || null); } catch(error) { res.status(500).json({ error: error.message }); } });
app.post('/api/rider/complete-order', async (req, res) => { try { const tgUser = req.tgUser; const dbUser = await getDbUser(tgUser.id); if (dbUser?.role !== 'rider') return res.status(403).json({ error: 'Forbidden' }); const { order_id } = req.body; const order = await pool.query('SELECT * FROM orders WHERE id=$1 AND rider_id=$2 AND status=$3',[order_id, dbUser.id, 'delivering']); if (order.rowCount===0) return res.status(400).json({ error:'Invalid order' }); await pool.query(`UPDATE orders SET status='completed' WHERE id=$1`,[order_id]); const o = order.rows[0]; const platformCommission = PLATFORM_FIXED_FEE; const shopNet = o.subtotal; const riderFee = o.delivery_fee - platformCommission; await pool.query(`UPDATE orders SET platform_commission=$1, shop_net=$2, rider_fee=$3 WHERE id=$4`,[platformCommission, shopNet, riderFee, order_id]); await pool.query(`INSERT INTO financial_transactions (order_id, transaction_type, amount) VALUES ($1,'platform_fee',$2),($1,'shop_payout',$3),($1,'rider_payout',$4)`,[order_id, platformCommission, shopNet, riderFee]); await notifyCustomer(order_id, 'completed'); const shopOwner = await pool.query(`SELECT u.chat_id FROM users u JOIN shops s ON u.id = s.owner_id WHERE s.id = (SELECT shop_id FROM orders WHERE id = $1)`, [order_id]); if (shopOwner.rows[0]?.chat_id) { await bot.api.sendMessage(shopOwner.rows[0].chat_id, `✅ *تم توصيل الطلب #${order_id} بنجاح*\nصافي المبلغ المستحق لك: ${shopNet} ل.س`, { parse_mode: 'Markdown' }); } res.json({ success: true }); } catch(error) { res.status(500).json({ error: error.message }); } });
app.post('/api/rider/cancel-order', async (req, res) => { try { const tgUser = req.tgUser; const dbUser = await getDbUser(tgUser.id); if (dbUser?.role !== 'rider') return res.status(403).json({ error: 'Forbidden' }); const { order_id } = req.body; const result = await pool.query(`UPDATE orders SET rider_id = NULL, status = 'ready_for_pickup' WHERE id = $1 AND rider_id = $2 AND status = 'delivering'`, [order_id, dbUser.id]); if (result.rowCount === 0) return res.status(400).json({ error: 'Order not found or not yours' }); await notifyCustomer(order_id, 'ready_for_pickup'); res.json({ success: true }); } catch(error) { res.status(500).json({ error: error.message }); } });

// ========== الأدمن ==========
app.get('/api/admin/pending', async (req, res) => { try { const tgUser = req.tgUser; const dbUser = await getDbUser(tgUser.id); if (dbUser?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' }); const pending = await pool.query(`SELECT id, telegram_id, name, phone, role, created_at FROM users WHERE is_approved=false AND role IN ('shop','rider') ORDER BY created_at DESC`); res.json(pending.rows); } catch(error) { res.status(500).json({ error: error.message }); } });
app.post('/api/admin/approve', async (req, res) => { try { const tgUser = req.tgUser; const dbUser = await getDbUser(tgUser.id); if (dbUser?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' }); const { user_id } = req.body; await pool.query(`UPDATE users SET is_approved=true WHERE id=$1`,[user_id]); res.json({ success: true }); } catch(error) { res.status(500).json({ error: error.message }); } });
app.get('/api/admin/orders/pending', async (req, res) => { try { const tgUser = req.tgUser; const dbUser = await getDbUser(tgUser.id); if (dbUser?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' }); const { page=1, limit=10 } = req.query; const offset = (page-1)*limit; const orders = await pool.query(`SELECT o.*, u.name as customer_name, s.shop_name FROM orders o JOIN users u ON o.customer_id = u.id JOIN shops s ON o.shop_id = s.id WHERE o.status = 'pending' ORDER BY o.created_at DESC LIMIT $1 OFFSET $2`, [limit, offset]); res.json(orders.rows); } catch(error) { res.status(500).json({ error: error.message }); } });
app.post('/api/admin/orders/:orderId/approve', async (req, res) => { try { const tgUser = req.tgUser; const dbUser = await getDbUser(tgUser.id); if (dbUser?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' }); const { orderId } = req.params; await pool.query(`UPDATE orders SET status='paid' WHERE id=$1`,[orderId]); await notifyShop(orderId); await notifyCustomer(orderId, 'paid'); res.json({ success: true }); } catch(error) { res.status(500).json({ error: error.message }); } });
app.delete('/api/admin/shops/:shopId', async (req, res) => { const client = await pool.connect(); try { const tgUser = req.tgUser; const dbUser = await getDbUser(tgUser.id); if (dbUser?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' }); const { shopId } = req.params; await client.query('BEGIN'); const shop = await client.query('SELECT owner_id FROM shops WHERE id = $1', [shopId]); if (!shop.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'المتجر غير موجود' }); } const ownerId = shop.rows[0].owner_id; await client.query('DELETE FROM products WHERE shop_id = $1', [shopId]); await client.query('DELETE FROM orders WHERE shop_id = $1', [shopId]); await client.query('DELETE FROM shops WHERE id = $1', [shopId]); await client.query(`UPDATE users SET role = 'customer', is_approved = true WHERE id = $1`, [ownerId]); await client.query('COMMIT'); res.json({ success: true }); } catch (error) { await client.query('ROLLBACK'); res.status(500).json({ error: error.message }); } finally { client.release(); } });
app.delete('/api/admin/riders/:userId', async (req, res) => { try { const tgUser = req.tgUser; const dbUser = await getDbUser(tgUser.id); if (dbUser?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' }); const { userId } = req.params; await pool.query('DELETE FROM rider_details WHERE user_id = $1', [userId]); await pool.query(`UPDATE users SET role = 'customer', is_approved = true WHERE id = $1`, [userId]); res.json({ success: true }); } catch(error) { res.status(500).json({ error: error.message }); } });

// ========== Webhook ==========
app.post('/api/webhook', async (req, res) => { try { await ensureBotInitialized(); await bot.handleUpdate(req.body); res.status(200).send('OK'); } catch(err) { console.error('Webhook error:', err); res.status(500).send('Error'); } });
app.get('/', (req, res) => res.send('🦅 شاهين API is running.'));
export default app;
