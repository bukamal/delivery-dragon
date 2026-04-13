-- المستخدمين
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    telegram_id TEXT UNIQUE NOT NULL,
    role TEXT DEFAULT 'customer' CHECK(role IN ('customer', 'shop', 'rider', 'admin')),
    name TEXT,
    phone TEXT,
    is_approved BOOLEAN DEFAULT false,
    chat_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- فئات المحلات
CREATE TABLE IF NOT EXISTS shop_categories (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    icon TEXT
);
INSERT INTO shop_categories (name, icon) VALUES ('مطعم','🍔'),('سوبرماركت','🛒'),('صيدلية','💊'),('مخبز','🥖') ON CONFLICT (name) DO NOTHING;
-- المحلات
CREATE TABLE IF NOT EXISTS shops (
    id SERIAL PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id),
    shop_name TEXT NOT NULL,
    category_id INTEGER REFERENCES shop_categories(id),
    description TEXT,
    phone TEXT,
    address TEXT,
    latitude REAL,
    longitude REAL,
    is_open BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- فئات المنتجات
CREATE TABLE IF NOT EXISTS product_categories (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    display_order INTEGER DEFAULT 0
);
-- المنتجات
CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    category_id INTEGER REFERENCES product_categories(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL,
    image_url TEXT,
    is_available BOOLEAN DEFAULT true,
    options JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- مناطق التوصيل (نوى فقط)
CREATE TABLE IF NOT EXISTS delivery_zones (
    id SERIAL PRIMARY KEY,
    zone_name TEXT UNIQUE NOT NULL,
    base_fee REAL NOT NULL,
    is_active BOOLEAN DEFAULT true
);
INSERT INTO delivery_zones (zone_name, base_fee) VALUES ('نوى', 20000) ON CONFLICT (zone_name) DO UPDATE SET base_fee=20000;
-- الطلبات (تم إضافة حالات جديدة)
CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES users(id),
    shop_id INTEGER NOT NULL REFERENCES shops(id),
    zone_id INTEGER REFERENCES delivery_zones(id),
    rider_id INTEGER REFERENCES users(id),
    status TEXT DEFAULT 'verifying' CHECK(status IN ('verifying','pending','paid','preparing','ready_for_pickup','delivering','completed','rejected')),
    items JSONB NOT NULL,
    subtotal REAL NOT NULL,
    delivery_fee REAL NOT NULL,
    total_price REAL NOT NULL,
    platform_commission REAL DEFAULT 0,
    rider_fee REAL DEFAULT 0,
    shop_net REAL DEFAULT 0,
    address TEXT,
    screenshot_file_id TEXT,
    rider_accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- مواقع السائقين
CREATE TABLE IF NOT EXISTS rider_locations (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- تفاصيل السائقين
CREATE TABLE IF NOT EXISTS rider_details (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    vehicle_type TEXT,
    vehicle_number TEXT,
    is_online BOOLEAN DEFAULT false,
    current_lat REAL,
    current_lng REAL
);
-- المعاملات المالية
CREATE TABLE IF NOT EXISTS financial_transactions (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    transaction_type TEXT CHECK(transaction_type IN ('shop_payout','rider_payout','platform_fee')),
    amount REAL NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- تقييمات
CREATE TABLE IF NOT EXISTS ratings (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    from_user_id INTEGER NOT NULL REFERENCES users(id),
    to_user_id INTEGER NOT NULL REFERENCES users(id),
    rating INTEGER CHECK(rating BETWEEN 1 AND 5),
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
