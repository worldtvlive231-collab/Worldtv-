-- WORLD TV: fresh Cloudflare D1 schema, part 2 / 2.
-- Customer operations tables. No Railway data is copied.
-- These tables alone do not implement auth, payments, live chat or file uploads.

CREATE TABLE IF NOT EXISTS resellers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  phone TEXT,
  commission_percent REAL NOT NULL DEFAULT 0 CHECK (commission_percent BETWEEN 0 AND 100),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reseller_sessions (
  token_hash TEXT PRIMARY KEY,
  reseller_id INTEGER NOT NULL REFERENCES resellers(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_reseller_sessions_expires ON reseller_sessions(expires_at);

CREATE TABLE IF NOT EXISTS reseller_code_allocation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reseller_id INTEGER NOT NULL UNIQUE REFERENCES resellers(id) ON DELETE CASCADE,
  allocated_count INTEGER NOT NULL DEFAULT 0 CHECK (allocated_count >= 0),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  available_count INTEGER NOT NULL DEFAULT 0 CHECK (available_count >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reseller_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reseller_id INTEGER NOT NULL REFERENCES resellers(id),
  user_id INTEGER REFERENCES users(id),
  plan_id INTEGER REFERENCES plans(id),
  order_id INTEGER UNIQUE REFERENCES orders(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency TEXT NOT NULL,
  commission_minor INTEGER NOT NULL DEFAULT 0 CHECK (commission_minor >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_reseller_sales_reseller ON reseller_sales(reseller_id,created_at);

CREATE TABLE IF NOT EXISTS live_chat_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_token_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT 'Website visitor',
  email TEXT,
  page_path TEXT NOT NULL DEFAULT '/',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  unread_admin INTEGER NOT NULL DEFAULT 0 CHECK (unread_admin >= 0),
  unread_customer INTEGER NOT NULL DEFAULT 0 CHECK (unread_customer >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_message_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_status ON live_chat_conversations(status,last_message_at);

CREATE TABLE IF NOT EXISTS live_chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES live_chat_conversations(id) ON DELETE CASCADE,
  sender TEXT NOT NULL CHECK (sender IN ('customer','admin','assistant')),
  source TEXT NOT NULL DEFAULT 'human' CHECK (source IN ('human','ai')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON live_chat_messages(conversation_id,id);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_ghs_minor INTEGER NOT NULL DEFAULT 0 CHECK (price_ghs_minor >= 0),
  category TEXT NOT NULL DEFAULT 'General',
  image_url TEXT,
  stock_status TEXT NOT NULL DEFAULT 'in_stock',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number TEXT NOT NULL UNIQUE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  user_id INTEGER REFERENCES users(id),
  customer_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency TEXT NOT NULL,
  payment_reference TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','fulfilled','cancelled','refunded')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id,created_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(created_at);
