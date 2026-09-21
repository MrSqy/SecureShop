-- MySQL 8.4. Yalnız boş, seçilmiş veritabanına scripts/db-init.js uygular.
-- Katalog ve yerel örnek yönetici src/models/seed.js kaynağından gelir.
-- Audit ve eski kilit sütunları saklanır; uygulama bunlara yazmaz.
-- ─── Kullanıcılar ────────────────────────────────────────
CREATE TABLE users (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username        VARCHAR(50) NOT NULL UNIQUE,
  phone_number    VARCHAR(16) NOT NULL UNIQUE,
  password_hash   VARCHAR(255) NOT NULL,     -- bcrypt hash (plain password ASLA saklanmaz)
  role            ENUM('customer','admin') NOT NULL DEFAULT 'customer',
  is_active       TINYINT(1) NOT NULL DEFAULT 1,
  failed_logins   INT UNSIGNED DEFAULT 0,    -- Brute force izleme
  locked_until    DATETIME NULL,
  last_login_at   DATETIME NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_username (username),
  INDEX idx_phone_number (phone_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

-- ─── Kategoriler ─────────────────────────────────────────
CREATE TABLE categories (
  id        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name      VARCHAR(100) NOT NULL,
  slug      VARCHAR(100) NOT NULL UNIQUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

-- ─── Ürünler ─────────────────────────────────────────────
CREATE TABLE products (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(255) NOT NULL,
  description   TEXT,
  price         DECIMAL(10,2) NOT NULL,
  stock         INT UNSIGNED NOT NULL DEFAULT 0,
  image_url     VARCHAR(500),
  category_id   INT UNSIGNED,
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
  CONSTRAINT ck_product_price CHECK (price > 0),
  CONSTRAINT ck_product_stock CHECK (stock <= 1000000),
  CONSTRAINT ck_product_name CHECK (CHAR_LENGTH(TRIM(name)) > 0),
  INDEX idx_category (category_id),
  FULLTEXT INDEX idx_search (name, description)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

-- ─── Siparişler ──────────────────────────────────────────
CREATE TABLE orders (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id           INT UNSIGNED NOT NULL,
  total_amount      DECIMAL(10,2) NOT NULL,
  shipping_address  JSON NOT NULL,           -- Yapılandırılmış adres
  request_key       CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_hash      CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  UNIQUE KEY uq_order_request (user_id, request_key),
  CONSTRAINT ck_order_total CHECK (total_amount > 0),
  status            ENUM('pending','confirmed','shipped','delivered','cancelled') DEFAULT 'pending',
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  INDEX idx_user_orders (user_id),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

-- ─── Sipariş Kalemleri ────────────────────────────────────
CREATE TABLE order_items (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id    INT UNSIGNED NOT NULL,
  product_id  INT UNSIGNED NOT NULL,
  quantity    INT UNSIGNED NOT NULL,
  unit_price  DECIMAL(10,2) NOT NULL,        -- O anki fiyat saklanır (değişime karşı)
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
  CONSTRAINT ck_item_quantity CHECK (quantity > 0),
  CONSTRAINT ck_item_price CHECK (unit_price > 0),
  UNIQUE KEY uq_order_product (order_id, product_id),
  INDEX idx_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

-- ─── Güvenlik Audit Log ──────────────────────────────────
CREATE TABLE security_audit_log (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_type  VARCHAR(100) NOT NULL,
  user_id     INT UNSIGNED NULL,
  ip_address  VARCHAR(45) NOT NULL,
  user_agent  VARCHAR(500),
  details     JSON,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_event_type (event_type),
  INDEX idx_created_at (created_at),
  INDEX idx_ip (ip_address)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;
