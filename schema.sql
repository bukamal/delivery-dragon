-- المستخدمين
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    telegram_id TEXT UNIQUE NOT NULL,
    role TEXT DEFAULT 'customer' CHECK(role IN ('customer', 'shop', 'rider', 'admin')),
    name TEXT,
    phone TEXT,
    is_approved BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- فئات المحلات
CREATE TABLE IF NOT EXISTS shop_categories (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    icon TEXT
);
INSERT INTO shop_categories (name, icon) VALUES 
    ('مطعم', '🍔'), ('سوبرماركت', '🛒'), ('صيدلية', '💊'), ('مخبز', '🥖')
ON CONFLICT (name) DO NOTHING;

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

-- مناطق التوصيل
CREATE TABLE IF NOT EXISTS delivery_zones (
    id SERIAL PRIMARY KEY,
    zone_name TEXT UNIQUE NOT NULL,
    base_fee REAL NOT NULL,
    is_active BOOLEAN DEFAULT true
);
INSERT INTO delivery_zones (zone_name, base_fee) VALUES 
    ('المزة', 5000), ('جرمانا', 7000), ('البرامكة', 4000), ('أبو رمانة', 5000)
ON CONFLICT (zone_name) DO NOTHING;

-- الطلبات
CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES users(id),
    shop_id INTEGER NOT NULL REFERENCES shops(id),
    zone_id INTEGER REFERENCES delivery_zones(id),
    rider_id INTEGER REFERENCES users(id),
    status TEXT DEFAULT 'pending',
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

-- تفاصيل السائقين
CREATE TABLE IF NOT EXISTS rider_details (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    vehicle_type TEXT,
    vehicle_number TEXT,
    is_online BOOLEAN DEFAULT false,
    current_lat REAL,
    current_lng REAL
);
