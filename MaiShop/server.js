const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('./db');

const PORT = process.env.PORT || 3000;
const PROD = process.env.NODE_ENV === 'production';

// ===== Khóa bí mật cho JWT: lấy từ biến môi trường hoặc tự sinh và lưu lại =====
function getSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const dir = process.env.DATA_DIR || path.join(__dirname, 'data');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'jwt.key');
  if (PROD) console.warn('CẢNH BÁO: chưa đặt JWT_SECRET, mỗi lần deploy khách sẽ bị đăng xuất. Hãy đặt biến môi trường JWT_SECRET.');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(f, 'utf8');
}
const SECRET = getSecret();

// ===== Email (đặt SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM; nếu chưa đặt, nội dung email được in ra Terminal) =====
let mailer = null;
if (process.env.SMTP_HOST) {
  try {
    mailer = require('nodemailer').createTransport({
      host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_PORT === '465',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  } catch { console.log('Chưa cài nodemailer, hãy chạy: npm install'); }
}
async function sendMail(to, subject, text) {
  if (!mailer) return console.log(`\n[Email giả lập] Gửi tới ${to} | ${subject}\n${text}\n`);
  try { await mailer.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, text }); }
  catch (e) { console.error('Gửi email lỗi:', e.message); }
}

// ===== Tiện ích bất đồng bộ =====
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
class UserError extends Error {}
const bad = msg => new UserError(msg);
const intId = v => { const n = Number(v); return Number.isInteger(n) && n > 0 && n < 2147483647 ? n : null; };

// ===== Tạo tài khoản admin lần chạy đầu =====
async function ensureAdmin() {
  if (await db.one("SELECT 1 FROM users WHERE role='admin'")) return;
  const email = process.env.ADMIN_EMAIL || 'admin@maihoa.local';
  const pass = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  await db.q("INSERT INTO users (name,email,password_hash,role) VALUES ($1,$2,$3,'admin')",
    ['Quản trị viên', email, bcrypt.hashSync(pass, 12)]);
  console.log('\n=== TÀI KHOẢN ADMIN (chỉ hiện 1 lần) ===');
  console.log('Email   :', email);
  console.log('Mật khẩu:', pass);
  console.log('========================================\n');
}


const app = express();
app.set('trust proxy', 1); // chạy sau proxy của Render: để giới hạn tốc độ và HTTPS nhận đúng IP khách
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
}));
app.use(express.json({ limit: '20kb' }));
app.use(cookieParser());

// ===== Chống CSRF: bắt buộc header tùy chỉnh cho mọi request thay đổi dữ liệu (kết hợp cookie SameSite=Strict) =====
app.use('/api', (req, res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('X-Requested-With') !== 'fetch')
    return res.status(403).json({ error: 'Yêu cầu không hợp lệ' });
  next();
});
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 400, standardHeaders: true, legacyHeaders: false }));
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Thử quá nhiều lần, vui lòng đợi 15 phút rồi thử lại' },
});

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Bạn gửi quá nhiều lần, vui lòng đợi một lát rồi thử lại' },
});

// ===== Thông báo cho chủ shop qua Telegram (miễn phí, chạy tốt trên Render free) =====
// Đặt TELEGRAM_BOT_TOKEN và TELEGRAM_CHAT_ID trong biến môi trường; chưa đặt thì bỏ qua.
async function notifyShop(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: text.slice(0, 3500) }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) console.log('Telegram lỗi:', r.status);
  } catch (e) { console.log('Telegram lỗi:', e.message); }
}

// ===== Tiện ích =====
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const isEmail = e => /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(e) && e.length <= 254;
const isPhone = p => /^(0|\+84)\d{9,10}$/.test(p);
const fail = (res, code, msg) => res.status(code).json({ error: msg });
const publicUser = u => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role });
const USER_COLS = 'id,name,email,phone,role';

function setCookie(res, user) {
  const token = jwt.sign({ id: user.id }, SECRET, { expiresIn: '7d' });
  res.cookie('token', token, { httpOnly: true, sameSite: 'strict', secure: PROD, maxAge: 7 * 24 * 3600 * 1000 });
}
async function auth(req, res, next) {
  let id;
  try { id = jwt.verify(req.cookies.token || '', SECRET).id; } catch { return fail(res, 401, 'Vui lòng đăng nhập'); }
  try {
    const u = await db.one(`SELECT ${USER_COLS} FROM users WHERE id=$1`, [id]);
    if (!u) return fail(res, 401, 'Vui lòng đăng nhập');
    req.user = u; next();
  } catch (e) { next(e); }
}
const adminOnly = (req, res, next) => req.user.role === 'admin' ? next() : fail(res, 403, 'Không có quyền truy cập');

// ===== Xác thực =====
const DUMMY = bcrypt.hashSync('dummy-password-1', 12);

app.post('/api/auth/register', authLimiter, ah(async (req, res) => {
  const name = str(req.body.name, 60), email = str(req.body.email, 254).toLowerCase();
  const phone = str(req.body.phone, 15).replace(/[\s.-]/g, ''), password = String(req.body.password ?? '');
  if (name.length < 2) return fail(res, 400, 'Họ tên tối thiểu 2 ký tự');
  if (!isEmail(email)) return fail(res, 400, 'Email không hợp lệ');
  if (!isPhone(phone)) return fail(res, 400, 'Số điện thoại không hợp lệ');
  if (password.length < 8 || password.length > 72 || !/[a-zA-Z]/.test(password) || !/\d/.test(password))
    return fail(res, 400, 'Mật khẩu 8-72 ký tự, gồm cả chữ và số');
  if (req.body.consent !== true) return fail(res, 400, 'Vui lòng tick đồng ý cho cửa hàng lưu thông tin của bạn');
  if (await db.one('SELECT 1 FROM users WHERE email=$1', [email])) return fail(res, 409, 'Email đã được đăng ký');
  let user;
  try {
    user = await db.one(`INSERT INTO users (name,email,phone,password_hash,consented_at) VALUES ($1,$2,$3,$4,now()) RETURNING ${USER_COLS}`,
      [name, email, phone, bcrypt.hashSync(password, 12)]);
  } catch (e) { if (e.code === '23505') return fail(res, 409, 'Email đã được đăng ký'); throw e; }
  setCookie(res, user);
  res.status(201).json({ user: publicUser(user) });
}));

app.post('/api/auth/login', authLimiter, ah(async (req, res) => {
  const email = str(req.body.email, 254).toLowerCase(), password = String(req.body.password ?? '').slice(0, 72);
  const u = await db.one('SELECT * FROM users WHERE email=$1', [email]);
  const badMsg = 'Email hoặc mật khẩu không đúng';
  if (!u) { bcrypt.compareSync(password, DUMMY); return fail(res, 401, badMsg); }
  if (u.locked_until > Date.now()) return fail(res, 423, 'Tài khoản tạm khóa do nhập sai nhiều lần, thử lại sau 15 phút');
  if (!bcrypt.compareSync(password, u.password_hash)) {
    const n = u.failed_attempts + 1;
    if (n >= 5) await db.q('UPDATE users SET failed_attempts=0, locked_until=$1 WHERE id=$2', [Date.now() + 15 * 60 * 1000, u.id]);
    else await db.q('UPDATE users SET failed_attempts=$1 WHERE id=$2', [n, u.id]);
    return fail(res, 401, badMsg);
  }
  await db.q('UPDATE users SET failed_attempts=0, locked_until=0 WHERE id=$1', [u.id]);
  setCookie(res, u);
  res.json({ user: publicUser(u) });
}));

app.post('/api/auth/logout', (req, res) => { res.clearCookie('token'); res.json({ ok: true }); });

app.get('/api/auth/me', ah(async (req, res) => {
  let id;
  try { id = jwt.verify(req.cookies.token || '', SECRET).id; } catch { return res.json({ user: null }); }
  const u = await db.one(`SELECT ${USER_COLS} FROM users WHERE id=$1`, [id]);
  res.json({ user: u ? publicUser(u) : null });
}));

app.post('/api/auth/password', auth, authLimiter, ah(async (req, res) => {
  const oldP = String(req.body.oldPassword ?? ''), newP = String(req.body.newPassword ?? '');
  const u = await db.one('SELECT * FROM users WHERE id=$1', [req.user.id]);
  if (!bcrypt.compareSync(oldP, u.password_hash)) return fail(res, 400, 'Mật khẩu hiện tại không đúng');
  if (newP.length < 8 || newP.length > 72 || !/[a-zA-Z]/.test(newP) || !/\d/.test(newP))
    return fail(res, 400, 'Mật khẩu mới 8-72 ký tự, gồm cả chữ và số');
  await db.q('UPDATE users SET password_hash=$1 WHERE id=$2', [bcrypt.hashSync(newP, 12), u.id]);
  res.json({ ok: true });
}));

// ===== Sản phẩm (công khai) =====
app.get('/api/products', ah(async (req, res) => {
  res.json(await db.q('SELECT * FROM products WHERE active=1 ORDER BY id DESC'));
}));

// ===== Đơn hàng =====
app.post('/api/orders', auth, ah(async (req, res) => {
  const b = req.body || {};
  const name = str(b.name, 60), phone = str(b.phone, 15).replace(/[\s.-]/g, '');
  const address = str(b.address, 250), note = str(b.note, 500);
  const payment = b.payment === 'bank' ? 'bank' : b.payment === 'cod' ? 'cod' : (b.payment === 'vnpay' && VNP.tmn && VNP.secret) ? 'vnpay' : null;
  if (name.length < 2) return fail(res, 400, 'Vui lòng nhập họ tên người nhận');
  if (!isPhone(phone)) return fail(res, 400, 'Số điện thoại không hợp lệ');
  if (address.length < 8) return fail(res, 400, 'Vui lòng nhập địa chỉ giao hàng đầy đủ');
  if (!payment) return fail(res, 400, 'Chọn phương thức thanh toán');
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > 50) return fail(res, 400, 'Giỏ hàng trống');

  const qtys = new Map();
  for (const it of b.items) {
    const id = Number(it.id), qty = Number(it.qty);
    if (!Number.isInteger(id) || id < 1 || id > 2147483646 || !Number.isInteger(qty) || qty < 1 || qty > 99) return fail(res, 400, 'Giỏ hàng không hợp lệ');
    qtys.set(id, (qtys.get(id) || 0) + qty);
  }
  let r;
  try {
    r = await db.tx(async t => {
      let total = 0; const lines = [];
      for (const [id, qty] of [...qtys].sort((x, y) => x[0] - y[0])) { // khóa dòng sản phẩm để không bán quá tồn kho
        const p = await t.one('SELECT * FROM products WHERE id=$1 AND active=1 FOR UPDATE', [id]);
        if (!p) throw bad('Có sản phẩm không còn bán');
        if (p.stock < qty) throw bad(`"${p.name}" chỉ còn ${p.stock} sản phẩm`);
        lines.push({ p, qty }); total += p.price * qty; // giá luôn lấy từ server
      }
      const shipping = total >= FREE_SHIP ? 0 : SHIP_FEE; total += shipping; // phí giao hàng tính ở server
      const o = await t.one('INSERT INTO orders (user_id,total,shipping,name,phone,address,note,payment) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
        [req.user.id, total, shipping, name, phone, address, note, payment]);
      for (const { p, qty } of lines) {
        await t.q('INSERT INTO order_items (order_id,product_id,name,price,qty) VALUES ($1,$2,$3,$4,$5)', [o.id, p.id, p.name, p.price, qty]);
        await t.q('UPDATE products SET stock=stock-$1 WHERE id=$2', [qty, p.id]);
      }
      return { id: o.id, total };
    });
  } catch (e) { if (e instanceof UserError) return fail(res, 400, e.message); throw e; }
  res.status(201).json(r);
  const info = `Mã đơn #${r.id}\nTổng tiền: ${r.total.toLocaleString('vi-VN')}đ\nNgười nhận: ${name} - ${phone}\nĐịa chỉ: ${address}`;
  sendMail(req.user.email, `Hà Thanh Tâm - Đã nhận đơn hàng #${r.id}`, `Cảm ơn bạn đã đặt hàng.\n${info}\nHotline: 0938 333 540`);
  if (process.env.SHOP_EMAIL) sendMail(process.env.SHOP_EMAIL, `Đơn hàng mới #${r.id}`, info);
  notifyShop(`🌼 Đơn hàng mới\n${info}\nThanh toán: ${payment}`);
}));

async function withItems(orders) {
  if (!orders.length) return [];
  const items = await db.q('SELECT order_id,name,price,qty FROM order_items WHERE order_id = ANY($1::int[]) ORDER BY id', [orders.map(o => o.id)]);
  const map = new Map();
  for (const i of items) {
    if (!map.has(i.order_id)) map.set(i.order_id, []);
    map.get(i.order_id).push({ name: i.name, price: i.price, qty: i.qty });
  }
  return orders.map(o => ({ ...o, items: map.get(o.id) || [] }));
}
app.get('/api/orders', auth, ah(async (req, res) => {
  res.json(await withItems(await db.q('SELECT * FROM orders WHERE user_id=$1 ORDER BY id DESC', [req.user.id])));
}));

// ===== Quản trị =====
const STATUSES = ['pending', 'confirmed', 'shipping', 'done', 'cancelled'];

// Đơn hàng kèm email tài khoản của người đặt
app.get('/api/admin/orders', auth, adminOnly, ah(async (req, res) => {
  res.json(await withItems(await db.q(
    'SELECT o.*, u.email AS user_email FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.id DESC LIMIT 500')));
}));

// Danh sách khách hàng đã đăng ký: số đơn, tổng tiền đã mua, lần đặt gần nhất
app.get('/api/admin/customers', auth, adminOnly, ah(async (req, res) => {
  res.json(await db.q(`
    SELECT u.id, u.name, u.email, u.phone, u.created_at,
           COUNT(o.id) AS order_count,
           COALESCE(SUM(CASE WHEN o.status != 'cancelled' THEN o.total END), 0) AS spent,
           MAX(o.created_at) AS last_order
    FROM users u LEFT JOIN orders o ON o.user_id = u.id
    WHERE u.role = 'customer'
    GROUP BY u.id ORDER BY u.id DESC LIMIT 500`));
}));

app.patch('/api/admin/orders/:id', auth, adminOnly, ah(async (req, res) => {
  const status = req.body.status, id = intId(req.params.id);
  if (!STATUSES.includes(status)) return fail(res, 400, 'Trạng thái không hợp lệ');
  const o = id && await db.one('SELECT * FROM orders WHERE id=$1', [id]);
  if (!o) return fail(res, 404, 'Không tìm thấy đơn hàng');
  if (o.status === 'cancelled') return fail(res, 400, 'Đơn đã hủy, hãy tạo đơn mới thay vì khôi phục');
  await db.tx(async t => {
    if (status === 'cancelled' && o.status !== 'cancelled')
      for (const it of await t.q('SELECT product_id,qty FROM order_items WHERE order_id=$1', [id]))
        await t.q('UPDATE products SET stock=stock+$1 WHERE id=$2', [it.qty, it.product_id]);
    await t.q("UPDATE orders SET status=$1::text, paid=CASE WHEN $1::text='done' THEN 1 ELSE paid END WHERE id=$2", [status, id]);
  });
  res.json({ ok: true });
}));

app.post('/api/admin/orders/:id/paid', auth, adminOnly, ah(async (req, res) => {
  const id = intId(req.params.id);
  const o = id && await db.one('SELECT status FROM orders WHERE id=$1', [id]);
  if (!o) return fail(res, 404, 'Không tìm thấy đơn hàng');
  if (o.status === 'cancelled') return fail(res, 400, 'Đơn đã hủy');
  await db.q('UPDATE orders SET paid=1 WHERE id=$1', [id]);
  res.json({ ok: true });
}));

function parseProduct(b) {
  const p = {
    name: str(b.name, 120), category: str(b.category, 40), description: str(b.description, 2000),
    price: Number(b.price), stock: Number(b.stock), image: str(b.image, 500), active: b.active ? 1 : 0,
  };
  if (p.name.length < 2) return { error: 'Tên sản phẩm quá ngắn' };
  if (!p.category) return { error: 'Vui lòng nhập danh mục' };
  if (!Number.isInteger(p.price) || p.price < 0 || p.price > 1e9) return { error: 'Giá không hợp lệ' };
  if (!Number.isInteger(p.stock) || p.stock < 0 || p.stock > 1e6) return { error: 'Tồn kho không hợp lệ' };
  if (p.image && !/^(\/|https:\/\/)[^\s"'<>]+$/.test(p.image)) return { error: 'Ảnh phải bắt đầu bằng / hoặc https://' };
  return { p };
}
const PCOLS = p => [p.name, p.category, p.description, p.price, p.stock, p.image, p.active];
app.get('/api/admin/products', auth, adminOnly, ah(async (req, res) => res.json(await db.q('SELECT * FROM products ORDER BY id DESC'))));
app.post('/api/admin/products', auth, adminOnly, ah(async (req, res) => {
  const { p, error } = parseProduct(req.body); if (error) return fail(res, 400, error);
  const r = await db.one('INSERT INTO products (name,category,description,price,stock,image,active) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', PCOLS(p));
  res.status(201).json({ id: r.id });
}));
app.put('/api/admin/products/:id', auth, adminOnly, ah(async (req, res) => {
  const { p, error } = parseProduct(req.body); if (error) return fail(res, 400, error);
  const id = intId(req.params.id);
  const r = id && await db.one('UPDATE products SET name=$1,category=$2,description=$3,price=$4,stock=$5,image=$6,active=$7 WHERE id=$8 RETURNING id', [...PCOLS(p), id]);
  r ? res.json({ ok: true }) : fail(res, 404, 'Không tìm thấy sản phẩm');
}));
app.delete('/api/admin/products/:id', auth, adminOnly, ah(async (req, res) => {
  // Ẩn sản phẩm thay vì xóa để giữ lịch sử đơn hàng
  const id = intId(req.params.id);
  if (id) await db.q('UPDATE products SET active=0 WHERE id=$1', [id]);
  res.json({ ok: true });
}));

// ===== Cấu hình công khai, phí giao hàng =====
const SHIP_FEE = Number(process.env.SHIP_FEE ?? 30000), FREE_SHIP = Number(process.env.FREE_SHIP_FROM ?? 2000000);
const VNP = { tmn: process.env.VNPAY_TMN, secret: process.env.VNPAY_SECRET, url: process.env.VNPAY_URL || 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html' };
const BASE = () => process.env.BASE_URL || `http://localhost:${PORT}`;
app.get('/api/config', (req, res) => res.json({ shipFee: SHIP_FEE, freeShipFrom: FREE_SHIP, vnpay: !!(VNP.tmn && VNP.secret) }));

// ===== Thanh toán VNPay (đặt VNPAY_TMN, VNPAY_SECRET; mặc định dùng môi trường thử nghiệm sandbox) =====
const vnpSign = params => {
  const q = Object.keys(params).sort().map(k => k + '=' + encodeURIComponent(params[k]).replace(/%20/g, '+')).join('&');
  return { q, hash: crypto.createHmac('sha512', VNP.secret).update(Buffer.from(q, 'utf-8')).digest('hex') };
};
async function vnpApply(query) {
  const p = {};
  for (const [k, v] of Object.entries(query)) if (k.startsWith('vnp_') && k !== 'vnp_SecureHash' && k !== 'vnp_SecureHashType') p[k] = String(v);
  if (!VNP.secret || vnpSign(p).hash !== String(query.vnp_SecureHash || '').toLowerCase()) return { code: '97' };
  const oid = intId(String(p.vnp_TxnRef).split('_')[0]);
  const o = oid && await db.one('SELECT * FROM orders WHERE id=$1', [oid]);
  if (!o) return { code: '01' };
  if (Number(p.vnp_Amount) !== o.total * 100) return { code: '04' };
  if (p.vnp_ResponseCode === '00' && p.vnp_TransactionStatus === '00') {
    if (o.paid) return { code: '02' };
    await db.q('UPDATE orders SET paid=1 WHERE id=$1', [o.id]);
  }
  return { code: '00' };
}
app.post('/api/orders/:id/vnpay', auth, ah(async (req, res) => {
  if (!VNP.tmn || !VNP.secret) return fail(res, 400, 'Cửa hàng chưa bật thanh toán VNPay');
  const id = intId(req.params.id);
  const o = id && await db.one('SELECT * FROM orders WHERE id=$1 AND user_id=$2', [id, req.user.id]);
  if (!o || o.payment !== 'vnpay' || o.paid || o.status !== 'pending') return fail(res, 400, 'Đơn hàng không thể thanh toán');
  const p = {
    vnp_Version: '2.1.0', vnp_Command: 'pay', vnp_TmnCode: VNP.tmn, vnp_Amount: String(o.total * 100), vnp_CurrCode: 'VND',
    vnp_TxnRef: `${o.id}_${Date.now()}`, vnp_OrderInfo: `Thanh toan don hang ${o.id}`, vnp_OrderType: 'other', vnp_Locale: 'vn',
    vnp_ReturnUrl: BASE() + '/api/payment/vnpay-return', vnp_IpAddr: (req.ip || '127.0.0.1').replace('::ffff:', '').replace('::1', '127.0.0.1'),
    vnp_CreateDate: new Date(Date.now() + 7 * 3600e3).toISOString().replace(/\D/g, '').slice(0, 14),
  };
  const { q, hash } = vnpSign(p);
  res.json({ url: `${VNP.url}?${q}&vnp_SecureHash=${hash}` });
}));
app.get('/api/payment/vnpay-return', ah(async (req, res) => { await vnpApply(req.query); res.redirect('/#/orders'); }));
app.get('/api/payment/vnpay-ipn', ah(async (req, res) => { const r = await vnpApply(req.query); res.json({ RspCode: r.code, Message: ['00', '02'].includes(r.code) ? 'Confirm Success' : 'Error' }); }));

// ===== Tải ảnh sản phẩm (quản trị): lưu vào cơ sở dữ liệu nên không mất khi deploy lại =====
app.post('/api/admin/upload', auth, adminOnly, express.raw({ type: 'image/*', limit: '3mb' }), ah(async (req, res) => {
  const b = req.body; if (!Buffer.isBuffer(b) || b.length < 12) return fail(res, 400, 'Ảnh không hợp lệ');
  const ext = (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) ? 'jpg' : b.slice(0, 4).toString('hex') === '89504e47' ? 'png'
    : (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') ? 'webp' : null;
  if (!ext) return fail(res, 400, 'Chỉ nhận ảnh JPG, PNG hoặc WEBP (tối đa 3MB)');
  const name = crypto.randomBytes(8).toString('hex') + '.' + ext;
  const mime = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[ext];
  await db.q('INSERT INTO images (name,mime,data) VALUES ($1,$2,$3)', [name, mime, b]);
  res.status(201).json({ url: '/img/uploads/' + name });
}));
app.get('/img/uploads/:name', ah(async (req, res) => {
  if (!/^[a-f0-9]{16}\.(jpg|png|webp)$/.test(req.params.name)) return res.status(404).end();
  const i = await db.one('SELECT mime,data FROM images WHERE name=$1', [req.params.name]);
  if (!i) return res.status(404).end();
  res.set({ 'Content-Type': i.mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
  res.send(i.data);
}));

// ===== Liên hệ =====
app.post('/api/contact', contactLimiter, ah(async (req, res) => {
  const name = str(req.body.name, 60), phone = str(req.body.phone, 15).replace(/[\s.-]/g, ''), content = str(req.body.content, 1000);
  if (name.length < 2) return fail(res, 400, 'Vui lòng nhập họ tên');
  if (!isPhone(phone)) return fail(res, 400, 'Số điện thoại không hợp lệ');
  if (content.length < 5) return fail(res, 400, 'Vui lòng nhập nội dung liên hệ');
  await db.q('INSERT INTO messages (name,phone,content) VALUES ($1,$2,$3)', [name, phone, content]);
  res.status(201).json({ ok: true });
  notifyShop(`💬 Tin nhắn liên hệ mới\n${name} - ${phone}\n${content}`);
}));
app.get('/api/admin/messages', auth, adminOnly, ah(async (req, res) => {
  res.json(await db.q('SELECT * FROM messages ORDER BY id DESC LIMIT 200'));
}));

// ===== Quên mật khẩu (gửi email nếu đã cấu hình SMTP, không thì in ra log) =====
const sha = t => crypto.createHash('sha256').update(t).digest('hex');
const validPass = p => p.length >= 8 && p.length <= 72 && /[a-zA-Z]/.test(p) && /\d/.test(p);
app.post('/api/auth/forgot', authLimiter, ah(async (req, res) => {
  const email = str(req.body.email, 254).toLowerCase();
  const u = await db.one('SELECT id FROM users WHERE email=$1', [email]);
  if (u) {
    const token = crypto.randomBytes(24).toString('hex');
    await db.q('DELETE FROM resets WHERE user_id=$1', [u.id]);
    await db.q('INSERT INTO resets (token_hash,user_id,expires) VALUES ($1,$2,$3)', [sha(token), u.id, Date.now() + 30 * 60 * 1000]);
    sendMail(email, 'Hà Thanh Tâm - Đặt lại mật khẩu', `Bấm vào liên kết sau để đặt mật khẩu mới (hiệu lực 30 phút):\n${BASE()}/#/reset/${token}`);
  }
  res.json({ ok: true }); // luôn trả về như nhau để không lộ email nào đã đăng ký
}));
app.post('/api/auth/reset', authLimiter, ah(async (req, res) => {
  const token = str(req.body.token, 100), password = String(req.body.password ?? '');
  if (!validPass(password)) return fail(res, 400, 'Mật khẩu 8-72 ký tự, gồm cả chữ và số');
  const r = await db.one('SELECT * FROM resets WHERE token_hash=$1', [sha(token)]);
  if (!r || r.expires < Date.now()) return fail(res, 400, 'Liên kết không hợp lệ hoặc đã hết hạn');
  await db.tx(async t => {
    await t.q('UPDATE users SET password_hash=$1, failed_attempts=0, locked_until=0 WHERE id=$2', [bcrypt.hashSync(password, 12), r.user_id]);
    await t.q('DELETE FROM resets WHERE user_id=$1', [r.user_id]);
  });
  res.json({ ok: true });
}));

// ===== Khách tự hủy đơn đang chờ xác nhận =====
app.post('/api/orders/:id/cancel', auth, ah(async (req, res) => {
  const id = intId(req.params.id);
  const o = id && await db.one('SELECT * FROM orders WHERE id=$1 AND user_id=$2', [id, req.user.id]);
  if (!o) return fail(res, 404, 'Không tìm thấy đơn hàng');
  if (o.status !== 'pending' || o.paid) return fail(res, 400, 'Đơn đã xác nhận hoặc đã thanh toán, vui lòng gọi 0938 333 540 để được hỗ trợ');
  await db.tx(async t => {
    for (const it of await t.q('SELECT product_id,qty FROM order_items WHERE order_id=$1', [id]))
      await t.q('UPDATE products SET stock=stock+$1 WHERE id=$2', [it.qty, it.product_id]);
    await t.q("UPDATE orders SET status='cancelled' WHERE id=$1", [id]);
  });
  res.json({ ok: true });
}));

app.use('/api', (req, res) => fail(res, 404, 'Không tìm thấy'));
app.get(['/', '/index.html'], (req, res) => {
  const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8').replace(/%BASE%/g, BASE().replace(/\/$/, ''));
  res.type('html').send(html);
});
app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.use((err, req, res, next) => {
  console.error(err);
  fail(res, err.status === 400 ? 400 : 500, err.status === 400 ? 'Dữ liệu gửi lên không hợp lệ' : 'Lỗi máy chủ');
});

(async () => {
  await db.init();
  await ensureAdmin();
  app.listen(PORT, () => console.log(`Website chạy tại http://localhost:${PORT}`));
})().catch(e => { console.error('Không khởi động được:', e.message); process.exit(1); });
