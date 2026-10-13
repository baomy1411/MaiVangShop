// ===== Thông tin cửa hàng (sửa tại đây) =====
const SHOP = {
  phone: '0938333540', phoneText: '0938 333 540',
  address: '98/120 Bùi Văn Ba, Quận 7, TP. Hồ Chí Minh',
  // Điền thông tin ngân hàng thật để hiện mã QR chuyển khoản (bankId theo VietQR, ví dụ: VCB, MB, ACB, TCB)
  bank: { bankId: '', accountNo: '', accountName: '' },
};
function bankBlock(orderId, total) {
  const b = SHOP.bank;
  if (!b.bankId || !b.accountNo) return `<p>Vui lòng liên hệ <a href="tel:${SHOP.phone}">${SHOP.phoneText}</a> để nhận thông tin chuyển khoản. Nội dung: <b>MAI ${orderId}</b></p>`;
  const qr = `https://img.vietqr.io/image/${encodeURIComponent(b.bankId)}-${encodeURIComponent(b.accountNo)}-compact2.png?amount=${total}&addInfo=${encodeURIComponent('MAI ' + orderId)}&accountName=${encodeURIComponent(b.accountName)}`;
  return `<p>Quét mã để chuyển khoản:</p><img src="${qr}" alt="Mã QR chuyển khoản" style="max-width:260px;width:100%"><p>${esc(b.accountName)} · ${esc(b.bankId)} · ${esc(b.accountNo)}<br>Nội dung: <b>MAI ${orderId}</b></p>`;
}

const payLabel = o => (o.payment === 'cod' ? 'COD' : o.payment === 'vnpay' ? 'VNPay' : 'Chuyển khoản') + (o.paid ? ' · Đã thanh toán' : '');
const shipFee = t => state.cfg && t < state.cfg.freeShipFrom ? state.cfg.shipFee : 0;
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const vnd = n => Number(n).toLocaleString('vi-VN') + 'đ';
const STATUS = { pending: 'Chờ xác nhận', confirmed: 'Đã xác nhận', shipping: 'Đang giao', done: 'Hoàn thành', cancelled: 'Đã hủy' };

let cart = {};
try { cart = JSON.parse(localStorage.getItem('cart') || '{}'); } catch { cart = {}; }
const state = { user: null, products: [], filter: { q: '', cat: '' } };

const saveCart = () => { try { localStorage.setItem('cart', JSON.stringify(cart)); } catch {} };
const cartCount = () => Object.values(cart).reduce((a, b) => a + b, 0);

const vnTime = s => s ? new Date(s).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '';
async function api(url, method = 'GET', body) {
  const r = await fetch(url, {
    method, credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Có lỗi xảy ra, vui lòng thử lại');
  return d;
}
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
const pic = p => p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy">` : '<span aria-hidden="true">🌼</span>';
const go = h => { location.hash = h; };

// ===== Liên hệ / quên mật khẩu =====
function viewContact() {
  const maps = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(SHOP.address);
  $('#app').innerHTML = `<h2 style="margin-top:2rem">Liên hệ Hà Thanh Tâm</h2><div class="row">
    <div class="panel"><h3>Thông tin cửa hàng</h3>
      <p>📍 ${esc(SHOP.address)}<br><a href="${maps}" target="_blank" rel="noopener">Xem chỉ đường trên Google Maps</a></p>
      <p>📞 <a href="tel:${SHOP.phone}">${esc(SHOP.phoneText)}</a></p>
      <p>💬 <a href="https://zalo.me/${SHOP.phone}" target="_blank" rel="noopener">Nhắn tin qua Zalo</a></p></div>
    <form class="panel" id="f" novalidate><h3>Gửi tin nhắn cho cửa hàng</h3>
      <label for="cn">Họ tên</label><input id="cn" value="${esc(state.user?.name || '')}">
      <label for="cp">Số điện thoại</label><input id="cp" type="tel" value="${esc(state.user?.phone || '')}">
      <label for="cc">Nội dung</label><textarea id="cc" rows="4"></textarea>
      <p class="err" id="err"></p><button class="btn">Gửi liên hệ</button></form></div>`;
  $('#f').addEventListener('submit', async e => {
    e.preventDefault();
    try { await api('/api/contact', 'POST', { name: $('#cn').value, phone: $('#cp').value, content: $('#cc').value }); $('#f').reset(); $('#err').textContent = ''; toast('Đã gửi, cửa hàng sẽ liên hệ lại sớm'); }
    catch (er) { $('#err').textContent = er.message; }
  });
}
function viewForgot() {
  $('#app').innerHTML = `<form class="panel narrow" id="f" novalidate><h2>Quên mật khẩu</h2>
    <label for="email">Email đã đăng ký</label><input id="email" type="email" required>
    <p class="err" id="err"></p><p id="ok"></p><button class="btn">Gửi yêu cầu</button>
    <p>Nếu chưa nhận được liên kết, hãy gọi <a href="tel:${SHOP.phone}">${SHOP.phoneText}</a> để cửa hàng hỗ trợ.</p></form>`;
  $('#f').addEventListener('submit', async e => {
    e.preventDefault();
    try { await api('/api/auth/forgot', 'POST', { email: $('#email').value }); $('#err').textContent = ''; $('#ok').textContent = 'Nếu email tồn tại, liên kết đặt lại mật khẩu sẽ được gửi (hiệu lực 30 phút).'; }
    catch (er) { $('#err').textContent = er.message; }
  });
}
function viewReset(token) {
  $('#app').innerHTML = `<form class="panel narrow" id="f" novalidate><h2>Đặt lại mật khẩu</h2>
    <label for="pw">Mật khẩu mới (tối thiểu 8 ký tự, gồm chữ và số)</label><input id="pw" type="password" autocomplete="new-password" required>
    <p class="err" id="err"></p><button class="btn">Đổi mật khẩu</button></form>`;
  $('#f').addEventListener('submit', async e => {
    e.preventDefault();
    try { await api('/api/auth/reset', 'POST', { token, password: $('#pw').value }); toast('Đã đổi mật khẩu, hãy đăng nhập'); go('#/login'); }
    catch (er) { $('#err').textContent = er.message; }
  });
}

// ===== Thanh điều hướng =====
function renderNav() {
  const u = state.user;
  $('#nav').innerHTML = `
    <a href="#/">Cửa hàng</a>
    <a href="#/contact">Liên hệ</a>
    <a href="#/cart">Giỏ hàng<span class="badge">${cartCount()}</span></a>
    ${u ? `<a href="#/orders">Đơn hàng</a>${u.role === 'admin' ? '<a href="#/admin">Quản trị</a>' : ''}<a href="#/account">${esc(u.name)}</a><button data-act="logout">Đăng xuất</button>`
        : '<a href="#/login">Đăng nhập</a><a href="#/register">Đăng ký</a>'}`;
}

// ===== Trang cửa hàng =====
function viewShop() {
  const cats = [...new Set(state.products.map(p => p.category))];
  $('#app').innerHTML = `
    <section class="hero">
      <p class="hero-kicker">HÀ THANH TÂM · VƯỜN MAI VÀNG</p>
      <h1>Gìn giữ sắc mai, vun đầy ngày Tết</h1>
      <p>Khám phá những chậu mai vàng và dáng mai bonsai mang nét đẹp truyền thống. Chọn cây yêu thích, chúng tôi sẽ hỗ trợ bạn tư vấn và đặt hàng.</p>
      <a class="btn gold" href="#shop">Khám phá vườn mai&nbsp; →</a>
    </section>
    <section class="benefits" aria-label="Cam kết cửa hàng">
      <div class="benefit"><span class="benefit-icon">🌼</span><div><strong>Mai tuyển chọn</strong><small>Thông tin cây rõ ràng</small></div></div>
      <div class="benefit"><span class="benefit-icon">🌿</span><div><strong>Tư vấn chăm sóc</strong><small>Hướng dẫn theo nhu cầu</small></div></div>
      <div class="benefit"><span class="benefit-icon">🤝</span><div><strong>Hỗ trợ đặt hàng</strong><small>Xác nhận trước khi giao</small></div></div>
    </section>
    <div class="section-head" id="shop"><div><h2>Chọn sắc mai bạn yêu</h2><p>Mỗi dáng mai mang một nét duyên riêng.</p></div></div>
    <div class="bar">
      <input id="q" type="search" placeholder="Tìm tên cây, giống mai..." aria-label="Tìm kiếm" value="${esc(state.filter.q)}">
      <select id="cat" aria-label="Danh mục"><option value="">Tất cả danh mục</option>
        ${cats.map(c => `<option ${c === state.filter.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
    </div>
    <div class="grid" id="list"></div>`;
  const draw = () => {
    const q = state.filter.q.toLowerCase();
    const items = state.products.filter(p => (!state.filter.cat || p.category === state.filter.cat) && (p.name + p.description).toLowerCase().includes(q));
    $('#list').innerHTML = items.length ? items.map(p => `
      <article class="card">
        <a class="pic" href="#/product/${p.id}">${pic(p)}</a>
        <div class="info">
          <span class="cat">${esc(p.category)}</span>
          <h3><a href="#/product/${p.id}">${esc(p.name)}</a></h3>
          <span class="price">${vnd(p.price)}</span>
          <button class="btn" data-add="${p.id}" ${p.stock < 1 ? 'disabled' : ''}>${p.stock < 1 ? 'Hết hàng' : 'Thêm vào giỏ'}</button>
        </div>
      </article>`).join('') : '<p class="empty">Không tìm thấy sản phẩm phù hợp. Thử từ khóa khác.</p>';
  };
  draw();
  $('#q').addEventListener('input', e => { state.filter.q = e.target.value; draw(); });
  $('#cat').addEventListener('change', e => { state.filter.cat = e.target.value; draw(); });
}

function viewProduct(id) {
  const p = state.products.find(x => x.id === Number(id));
  if (!p) return $('#app').innerHTML = '<p class="empty">Sản phẩm không tồn tại hoặc đã ngừng bán. <a href="#/">Về cửa hàng</a></p>';
  $('#app').innerHTML = `
    <div class="detail">
      <div class="pic">${pic(p)}</div>
      <div>
        <span class="cat">${esc(p.category)}</span>
        <h1>${esc(p.name)}</h1>
        <p class="price" style="font-size:1.5rem">${vnd(p.price)}</p>
        <p>${esc(p.description).replace(/\n/g, '<br>')}</p>
        <p class="cat">${p.stock > 0 ? `Còn ${p.stock} sản phẩm` : 'Tạm hết hàng'}</p>
        <button class="btn" data-add="${p.id}" ${p.stock < 1 ? 'disabled' : ''}>Thêm vào giỏ</button>
        <a class="btn ghost" href="#/">Tiếp tục xem</a>
      </div>
    </div>`;
}

// ===== Giỏ hàng =====
function cartLines() {
  return Object.entries(cart).map(([id, qty]) => ({ p: state.products.find(x => x.id === Number(id)), qty })).filter(l => l.p);
}
function viewCart() {
  const lines = cartLines();
  if (!lines.length) return $('#app').innerHTML = '<div class="empty"><h2>Giỏ hàng đang trống</h2><a class="btn" href="#/">Chọn mai ngay</a></div>';
  const total = lines.reduce((s, l) => s + l.p.price * l.qty, 0);
  $('#app').innerHTML = `<h2 style="margin-top:2rem">Giỏ hàng</h2>
    <div class="panel scroll"><table class="tbl">
      <thead><tr><th>Sản phẩm</th><th>Đơn giá</th><th>Số lượng</th><th>Thành tiền</th><th></th></tr></thead>
      <tbody>${lines.map(({ p, qty }) => `<tr>
        <td><a href="#/product/${p.id}">${esc(p.name)}</a></td><td>${vnd(p.price)}</td>
        <td><span class="qty"><button data-dec="${p.id}" aria-label="Giảm">−</button>${qty}<button data-inc="${p.id}" aria-label="Tăng">+</button></span></td>
        <td>${vnd(p.price * qty)}</td><td><button class="btn ghost sm" data-rm="${p.id}">Xóa</button></td></tr>`).join('')}</tbody>
    </table>
    <p style="text-align:right;font-size:1.2rem">Tổng cộng: <strong class="price">${vnd(total)}</strong></p>
    <p style="text-align:right"><a class="btn" href="#/checkout">Tiến hành đặt hàng</a></p></div>`;
}

// ===== Đăng ký / đăng nhập =====
function viewLogin() {
  $('#app').innerHTML = `<form class="panel narrow" id="f" novalidate><h2>Đăng nhập</h2>
    <label for="email">Email</label><input id="email" type="email" autocomplete="username" required>
    <label for="pw">Mật khẩu</label><input id="pw" type="password" autocomplete="current-password" required>
    <p class="err" id="err"></p><button class="btn">Đăng nhập</button>
    <p><a href="#/forgot">Quên mật khẩu?</a></p>
    <p>Chưa có tài khoản? <a href="#/register">Đăng ký</a></p></form>`;
  $('#f').addEventListener('submit', async e => {
    e.preventDefault();
    try { state.user = (await api('/api/auth/login', 'POST', { email: $('#email').value, password: $('#pw').value })).user; renderNav(); go(sessionStorage.getItem('next') || '#/'); sessionStorage.removeItem('next'); }
    catch (er) { $('#err').textContent = er.message; }
  });
}
function viewRegister() {
  $('#app').innerHTML = `<form class="panel narrow" id="f" novalidate><h2>Tạo tài khoản</h2>
    <label for="name">Họ và tên</label><input id="name" autocomplete="name" required>
    <label for="email">Email</label><input id="email" type="email" autocomplete="username" required>
    <label for="phone">Số điện thoại</label><input id="phone" type="tel" autocomplete="tel" required>
    <label for="pw">Mật khẩu (tối thiểu 8 ký tự, gồm chữ và số)</label><input id="pw" type="password" autocomplete="new-password" required>
    <label for="pw2">Nhập lại mật khẩu</label><input id="pw2" type="password" autocomplete="new-password" required>
    <label style="display:flex;gap:.5rem;align-items:flex-start;margin:.75rem 0;font-weight:400"><input type="checkbox" id="consent" style="width:auto;margin-top:.25rem"><span>Tôi đồng ý để Hà Thanh Tâm lưu họ tên, email, số điện thoại và địa chỉ giao hàng của tôi để xử lý đơn hàng và liên hệ chăm sóc khách hàng.</span></label>
    <p class="err" id="err"></p><button class="btn">Đăng ký</button>
    <p>Đã có tài khoản? <a href="#/login">Đăng nhập</a></p></form>`;
  $('#f').addEventListener('submit', async e => {
    e.preventDefault();
    if ($('#pw').value !== $('#pw2').value) return $('#err').textContent = 'Mật khẩu nhập lại không khớp';
    if (!$('#consent').checked) return $('#err').textContent = 'Vui lòng tick đồng ý cho cửa hàng lưu thông tin của bạn';
    try {
      state.user = (await api('/api/auth/register', 'POST', { name: $('#name').value, email: $('#email').value, phone: $('#phone').value, password: $('#pw').value, consent: true })).user;
      renderNav(); toast('Đăng ký thành công'); go(sessionStorage.getItem('next') || '#/'); sessionStorage.removeItem('next');
    } catch (er) { $('#err').textContent = er.message; }
  });
}
function viewAccount() {
  const u = state.user;
  $('#app').innerHTML = `<div class="panel narrow"><h2>Tài khoản</h2>
    <p><b>${esc(u.name)}</b><br>${esc(u.email)}<br>${esc(u.phone || '')}</p></div>
    <form class="panel narrow" id="f"><h3>Đổi mật khẩu</h3>
    <label for="o">Mật khẩu hiện tại</label><input id="o" type="password" autocomplete="current-password" required>
    <label for="n">Mật khẩu mới</label><input id="n" type="password" autocomplete="new-password" required>
    <p class="err" id="err"></p><button class="btn">Cập nhật</button></form>`;
  $('#f').addEventListener('submit', async e => {
    e.preventDefault();
    try { await api('/api/auth/password', 'POST', { oldPassword: $('#o').value, newPassword: $('#n').value }); $('#f').reset(); $('#err').textContent = ''; toast('Đã đổi mật khẩu'); }
    catch (er) { $('#err').textContent = er.message; }
  });
}

// ===== Thanh toán =====
function viewCheckout() {
  const lines = cartLines();
  if (!lines.length) return go('#/cart');
  const u = state.user, total = lines.reduce((s, l) => s + l.p.price * l.qty, 0);
  $('#app').innerHTML = `<h2 style="margin-top:2rem">Đặt hàng</h2><div class="row">
    <form class="panel" id="f" novalidate>
      <label for="name">Người nhận</label><input id="name" value="${esc(u.name)}" required>
      <label for="phone">Số điện thoại</label><input id="phone" type="tel" value="${esc(u.phone || '')}" required>
      <label for="addr">Địa chỉ giao hàng</label><textarea id="addr" rows="2" required></textarea>
      <label for="note">Ghi chú (tùy chọn)</label><textarea id="note" rows="2"></textarea>
      <label>Thanh toán</label>
      <label style="font-weight:400"><input type="radio" name="pay" value="cod" checked style="width:auto"> Thanh toán khi nhận hàng (COD)</label>
      <label style="font-weight:400"><input type="radio" name="pay" value="bank" style="width:auto"> Chuyển khoản ngân hàng</label>
      ${state.cfg?.vnpay ? '<label style="font-weight:400"><input type="radio" name="pay" value="vnpay" style="width:auto"> Thanh toán online qua VNPay (thẻ ATM, QR, thẻ quốc tế)</label>' : ''}
      <p class="err" id="err"></p><button class="btn gold">Xác nhận đặt hàng</button></form>
    <div class="panel"><h3>Đơn hàng của bạn</h3>
      ${lines.map(l => `<p>${esc(l.p.name)} × ${l.qty}<br><span class="price">${vnd(l.p.price * l.qty)}</span></p>`).join('')}
      <hr><p>Tạm tính: ${vnd(total)}<br>Phí giao hàng: ${shipFee(total) ? vnd(shipFee(total)) : 'Miễn phí'}</p><p>Tổng: <strong class="price">${vnd(total + shipFee(total))}</strong></p>${state.cfg?.freeShipFrom ? `<p class="cat">Miễn phí giao hàng từ ${vnd(state.cfg.freeShipFrom)}</p>` : ''}</div></div>`;
  $('#f').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const pay = $('input[name=pay]:checked').value;
      const r = await api('/api/orders', 'POST', {
        items: lines.map(l => ({ id: l.p.id, qty: l.qty })), name: $('#name').value, phone: $('#phone').value,
        address: $('#addr').value, note: $('#note').value, payment: pay,
      });
      cart = {}; saveCart(); renderNav(); await loadProducts();
      if (pay === 'vnpay') { location.href = (await api('/api/orders/' + r.id + '/vnpay', 'POST')).url; return; }
      $('#app').innerHTML = `<div class="panel narrow"><h2>Đặt hàng thành công</h2>
        <p>Mã đơn <b>#${r.id}</b> · Tổng ${vnd(r.total)}. Chúng tôi sẽ gọi xác nhận trong thời gian sớm nhất.</p>
        ${pay === 'bank' ? bankBlock(r.id, r.total) : ''}
        <a class="btn" href="#/orders">Xem đơn hàng</a></div>`;
    } catch (er) { $('#err').textContent = er.message; }
  });
}

async function viewOrders() {
  $('#app').innerHTML = '<p class="empty">Đang tải...</p>';
  const orders = await api('/api/orders');
  $('#app').innerHTML = `<h2 style="margin-top:2rem">Đơn hàng của tôi</h2>` + (orders.length ? orders.map(o => `
    <div class="panel"><p><b>Đơn #${o.id}</b> · ${vnTime(o.created_at)} · <span class="status ${esc(o.status)}">${STATUS[o.status] || esc(o.status)}</span></p>
    ${o.items.map(i => `<p>${esc(i.name)} × ${i.qty} – ${vnd(i.price * i.qty)}</p>`).join('')}
    <p>Tổng: <strong class="price">${vnd(o.total)}</strong> · ${payLabel(o)}${o.shipping ? ` · Phí giao ${vnd(o.shipping)}` : ''}</p>
    <p class="cat">Giao tới: ${esc(o.address)}</p>${o.status === 'pending' ? `<button class="btn ghost sm" data-cancelorder="${o.id}">Hủy đơn</button>` : ''}${o.payment === 'vnpay' && !o.paid && o.status === 'pending' ? `<button class="btn sm" data-payorder="${o.id}">Thanh toán VNPay</button>` : ''}</div>`).join('') : '<p class="empty">Bạn chưa có đơn hàng nào.</p>');
}

// ===== Quản trị =====
let adminTab = 'orders', editing = null;
async function viewAdmin() {
  if (state.user?.role !== 'admin') return $('#app').innerHTML = '<p class="empty">Bạn không có quyền truy cập trang này.</p>';
  $('#app').innerHTML = `<h2 style="margin-top:2rem">Quản trị</h2>
    <div class="tabs"><button data-tab="orders" class="${adminTab === 'orders' ? 'on' : ''}">Đơn hàng</button><button data-tab="products" class="${adminTab === 'products' ? 'on' : ''}">Sản phẩm</button><button data-tab="customers" class="${adminTab === 'customers' ? 'on' : ''}">Khách hàng</button><button data-tab="messages" class="${adminTab === 'messages' ? 'on' : ''}">Liên hệ</button></div><div id="adm"></div>`;
  if (adminTab === 'orders') {
    const orders = await api('/api/admin/orders');
    $('#adm').innerHTML = `<div class="panel scroll"><table class="tbl"><thead><tr><th>Mã</th><th>Khách</th><th>Sản phẩm</th><th>Tổng</th><th>Trạng thái</th></tr></thead><tbody>
      ${orders.map(o => `<tr><td>#${o.id}<br><span class="cat">${vnTime(o.created_at)}</span></td>
        <td>${esc(o.name)}<br>${esc(o.phone)}<br><span class="cat">${esc(o.address)}</span><br><span class="cat">Tài khoản: ${esc(o.user_email)}</span>${o.note ? `<br><i>${esc(o.note)}</i>` : ''}</td>
        <td>${o.items.map(i => `${esc(i.name)} × ${i.qty}`).join('<br>')}</td><td>${vnd(o.total)}<br><span class="cat">${payLabel(o)}</span></td>
        <td><select data-order="${o.id}">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === o.status ? 'selected' : ''}>${v}</option>`).join('')}</select></td></tr>`).join('')}
      </tbody></table></div>`;
  } else if (adminTab === 'customers') {
    const cs = await api('/api/admin/customers');
    $('#adm').innerHTML = `<div class="panel scroll"><table class="tbl"><thead><tr><th>Khách hàng</th><th>Liên hệ</th><th>Đăng ký lúc</th><th>Số đơn</th><th>Đã mua</th><th>Đặt gần nhất</th></tr></thead><tbody>
      ${cs.map(c => `<tr><td>${esc(c.name)}</td><td>${esc(c.email)}<br><a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></td><td>${vnTime(c.created_at)}</td><td>${c.order_count}</td><td>${vnd(c.spent)}</td><td>${vnTime(c.last_order) || '—'}</td></tr>`).join('') || '<tr><td colspan="6">Chưa có khách đăng ký.</td></tr>'}</tbody></table></div>`;
  } else if (adminTab === 'messages') {
    const ms = await api('/api/admin/messages');
    $('#adm').innerHTML = `<div class="panel scroll"><table class="tbl"><thead><tr><th>Thời gian</th><th>Khách</th><th>Nội dung</th></tr></thead><tbody>
      ${ms.map(m => `<tr><td>${vnTime(m.created_at)}</td><td>${esc(m.name)}<br><a href="tel:${esc(m.phone)}">${esc(m.phone)}</a></td><td>${esc(m.content)}</td></tr>`).join('') || '<tr><td colspan="3">Chưa có tin nhắn.</td></tr>'}</tbody></table></div>`;
  } else {
    const ps = await api('/api/admin/products'), e = editing || { name: '', category: '', description: '', price: 0, stock: 0, image: '', active: 1 };
    $('#adm').innerHTML = `<form class="panel" id="pf" novalidate><h3>${editing ? 'Sửa sản phẩm #' + e.id : 'Thêm sản phẩm'}</h3>
      <div class="row"><div><label for="pn">Tên</label><input id="pn" value="${esc(e.name)}"></div><div><label for="pc">Danh mục</label><input id="pc" value="${esc(e.category)}"></div></div>
      <div class="row"><div><label for="pp">Giá (đ)</label><input id="pp" type="number" min="0" value="${e.price}"></div><div><label for="ps">Tồn kho</label><input id="ps" type="number" min="0" value="${e.stock}"></div></div>
      <label for="pi">Đường dẫn ảnh (vd: /img/mai1.jpg hoặc https://...)</label><input id="pi" value="${esc(e.image)}">
      <label for="pf2">Hoặc tải ảnh lên (JPG, PNG, WEBP, tối đa 3MB)</label><input id="pf2" type="file" accept="image/jpeg,image/png,image/webp">
      <label for="pd">Mô tả</label><textarea id="pd" rows="3">${esc(e.description)}</textarea>
      <label style="font-weight:400"><input id="pa" type="checkbox" style="width:auto" ${e.active ? 'checked' : ''}> Đang bán</label>
      <p class="err" id="err"></p><button class="btn">${editing ? 'Lưu thay đổi' : 'Thêm sản phẩm'}</button>
      ${editing ? '<button type="button" class="btn ghost" data-cancel>Hủy</button>' : ''}</form>
      <div class="panel scroll"><table class="tbl"><thead><tr><th>Tên</th><th>Giá</th><th>Kho</th><th>Trạng thái</th><th></th></tr></thead><tbody>
      ${ps.map(p => `<tr><td>${esc(p.name)}<br><span class="cat">${esc(p.category)}</span></td><td>${vnd(p.price)}</td><td>${p.stock}</td><td>${p.active ? 'Đang bán' : 'Đã ẩn'}</td>
        <td><button class="btn ghost sm" data-edit="${p.id}">Sửa</button> ${p.active ? `<button class="btn ghost sm" data-hide="${p.id}">Ẩn</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
    window._ps = ps;
    $('#pf2').addEventListener('change', async ev => {
      const f = ev.target.files[0]; if (!f) return;
      try {
        const r = await fetch('/api/admin/upload', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': f.type, 'X-Requested-With': 'fetch' }, body: f });
        const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Tải ảnh thất bại');
        $('#pi').value = d.url; toast('Đã tải ảnh lên, bấm Lưu để áp dụng');
      } catch (er) { toast(er.message); }
    });
    $('#pf').addEventListener('submit', async ev => {
      ev.preventDefault();
      const body = { name: $('#pn').value, category: $('#pc').value, price: Number($('#pp').value), stock: Number($('#ps').value), image: $('#pi').value, description: $('#pd').value, active: $('#pa').checked };
      try { editing ? await api('/api/admin/products/' + editing.id, 'PUT', body) : await api('/api/admin/products', 'POST', body); editing = null; await loadProducts(); toast('Đã lưu'); viewAdmin(); }
      catch (er) { $('#err').textContent = er.message; }
    });
  }
}

// ===== Sự kiện chung (không dùng onclick trong HTML để tuân thủ CSP) =====
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-add],[data-inc],[data-dec],[data-rm],[data-act],[data-tab],[data-edit],[data-hide],[data-cancel],[data-cancelorder],[data-payorder]');
  if (!t) return;
  const d = t.dataset;
  try {
    if (d.add) {
      const p = state.products.find(x => x.id === Number(d.add));
      if ((cart[d.add] || 0) >= p.stock) return toast('Đã đạt số lượng tối đa trong kho');
      cart[d.add] = (cart[d.add] || 0) + 1; saveCart(); renderNav(); toast('Đã thêm vào giỏ hàng');
    } else if (d.inc || d.dec || d.rm) {
      const id = d.inc || d.dec || d.rm, p = state.products.find(x => x.id === Number(id));
      if (d.inc) { if (cart[id] >= p.stock) return toast('Đã đạt số lượng tối đa trong kho'); cart[id]++; }
      else if (d.dec) { cart[id]--; if (cart[id] < 1) delete cart[id]; } else delete cart[id];
      saveCart(); renderNav(); viewCart();
    } else if (d.act === 'logout') {
      await api('/api/auth/logout', 'POST'); state.user = null; renderNav(); go('#/'); toast('Đã đăng xuất');
    } else if (d.tab) { adminTab = d.tab; editing = null; viewAdmin(); }
    else if (d.edit) { editing = window._ps.find(p => p.id === Number(d.edit)); viewAdmin(); scrollTo(0, 0); }
    else if (d.hide) { if (confirm('Ẩn sản phẩm này khỏi cửa hàng?')) { await api('/api/admin/products/' + d.hide, 'DELETE'); await loadProducts(); viewAdmin(); } }
    else if ('cancel' in d) { editing = null; viewAdmin(); }
    else if (d.payorder) { location.href = (await api('/api/orders/' + d.payorder + '/vnpay', 'POST')).url; }
    else if (d.cancelorder) { if (confirm('Hủy đơn hàng này?')) { await api('/api/orders/' + d.cancelorder + '/cancel', 'POST'); await loadProducts(); viewOrders(); toast('Đã hủy đơn'); } }
  } catch (er) { toast(er.message); }
});
document.addEventListener('change', async e => {
  if (!e.target.dataset.order) return;
  try { await api('/api/admin/orders/' + e.target.dataset.order, 'PATCH', { status: e.target.value }); toast('Đã cập nhật trạng thái'); await loadProducts(); }
  catch (er) { toast(er.message); viewAdmin(); }
});

// ===== Định tuyến =====
async function loadProducts() { state.products = await api('/api/products'); }
async function route() {
  const h = location.hash || '#/', [, page, arg] = h.split('/');
  const needLogin = ['checkout', 'orders', 'account', 'admin'];
  if (needLogin.includes(page) && !state.user) { sessionStorage.setItem('next', h); return go('#/login'); }
  if (h === '#shop') return; // neo trang
  try {
    if (!page) viewShop();
    else if (page === 'product') viewProduct(arg);
    else if (page === 'cart') viewCart();
    else if (page === 'login') viewLogin();
    else if (page === 'register') viewRegister();
    else if (page === 'account') viewAccount();
    else if (page === 'checkout') viewCheckout();
    else if (page === 'orders') await viewOrders();
    else if (page === 'admin') await viewAdmin();
    else if (page === 'contact') viewContact();
    else if (page === 'forgot') viewForgot();
    else if (page === 'reset') viewReset(arg);
    else go('#/');
  } catch (er) {
    if (/đăng nhập/i.test(er.message)) { state.user = null; renderNav(); go('#/login'); } else $('#app').innerHTML = `<p class="empty">${esc(er.message)}</p>`;
  }
  if (page !== undefined) scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
(async () => {
  try { state.user = (await api('/api/auth/me')).user; state.cfg = await api('/api/config'); await loadProducts(); } catch (er) { toast(er.message); }
  renderNav(); route();
})();
