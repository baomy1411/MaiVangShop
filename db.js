// Cơ sở dữ liệu PostgreSQL (dùng Neon miễn phí). Cần biến môi trường DATABASE_URL.
const { Pool, types } = require('pg');
types.setTypeParser(20, v => Number(v));   // BIGINT, COUNT -> số
types.setTypeParser(1700, v => Number(v)); // NUMERIC, SUM -> số

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('\nThiếu biến môi trường DATABASE_URL (chuỗi kết nối Postgres từ Neon). Xem README.md.\n');
  process.exit(1);
}
const local = /localhost|127\.0\.0\.1/.test(url);
const pool = new Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, max: 5, idleTimeoutMillis: 10000 });
pool.on('error', e => console.error('Lỗi kết nối cơ sở dữ liệu:', e.message));

const q = (text, params) => pool.query(text, params).then(r => r.rows);
const one = (text, params) => q(text, params).then(r => r[0]);
async function tx(fn) {
  const c = await pool.connect();
  const t = { q: (text, params) => c.query(text, params).then(r => r.rows), one: (text, params) => c.query(text, params).then(r => r.rows[0]) };
  try {
    await c.query('BEGIN');
    const out = await fn(t);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch {}
    throw e;
  } finally { c.release(); }
}

async function init() {
  await pool.query(`
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer',
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until BIGINT NOT NULL DEFAULT 0,
  consented_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  image TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  total BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  payment TEXT NOT NULL,
  shipping INTEGER NOT NULL DEFAULT 0,
  paid INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  qty INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL, phone TEXT NOT NULL, content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS resets (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS images (
  name TEXT PRIMARY KEY, mime TEXT NOT NULL, data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`);
  const c = await one('SELECT COUNT(*)::int AS c FROM products');
  if (c.c === 0) {
    for (const r of [
      ['Mai vàng 7 năm tuổi dáng thế', 'Mai chậu lớn', 'Gốc to, dáng thế đẹp, nhiều nụ, phù hợp trưng phòng khách.', 4500000, 5],
      ['Mai vàng bonsai gốc cổ', 'Mai chậu lớn', 'Gốc cổ thụ uốn lượn, tán cân đối, đã chăm sẵn để nở đúng Tết.', 12000000, 2],
      ['Mai giảo Bến Tre', 'Mai chậu vừa', 'Cánh dày, hoa to, hương thơm nhẹ, dễ chăm sóc.', 2200000, 12],
      ['Mai chiếu thủy', 'Mai chậu vừa', 'Cành rủ mềm mại như thác nước, rất hợp sân vườn và ban công.', 3800000, 6],
      ['Mai tứ quý mini để bàn', 'Mai mini', 'Chậu nhỏ gọn, nở quanh năm, thích hợp làm quà tặng.', 450000, 30],
      ['Cành mai vàng cắt sẵn (bó 3 cành)', 'Mai cành', 'Cành mai cắt tươi nhiều nụ, cắm bình ngày Tết.', 350000, 40],
      ['Phân bón chuyên dụng cho mai', 'Phụ kiện', 'Túi 1kg, giúp mai ra nụ đều và nở đúng dịp.', 90000, 100],
      ['Chậu sứ men xanh cho mai', 'Phụ kiện', 'Chậu sứ đường kính 40cm, có lỗ thoát nước.', 780000, 15],
    ]) await q('INSERT INTO products (name,category,description,price,stock) VALUES ($1,$2,$3,$4,$5)', r);
  }
}

module.exports = { pool, q, one, tx, init };
