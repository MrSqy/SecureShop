'use strict';
const byId = id => document.getElementById(id);
let csrfToken = '', currentUser = null, pendingUsername = '', otpTimes = null;
let cart = [], products = [], pendingOrder = null, checkoutBusy = false, authBusy = false;
let productRequest = 0, orderRequest = 0, toastTimer;
const money = value => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'USD' }).format(value);
const errors = {
  INVALID_CREDENTIALS: 'Kullanıcı adı veya şifre yanlış.', OTP_INVALID: 'Kod geçersiz veya süresi dolmuş. Yeniden giriş yapabilirsin.',
  OTP_DELIVERY_FAILED: 'Kod gönderilemedi. Biraz sonra yeniden giriş yap.', OTP_LOCKED: 'Çok fazla hatalı kod denemesi.', LOGIN_LOCKED: 'Çok fazla hatalı giriş denemesi.',
  OTP_COOLDOWN: 'Yeni kod için biraz bekle.', OTP_SEND_LIMIT: 'Kod gönderme sınırına ulaştın.', ACCOUNT_EXISTS: 'Bu kullanıcı adı veya telefonla kayıt oluşturulamadı.',
  AUTH_REQUIRED: 'Oturumun sona ermiş. Lütfen yeniden giriş yap.', CSRF_INVALID: 'Oturum doğrulanamadı. Sayfayı yenileyip tekrar dene.',
  FORBIDDEN: 'Bu işlem için yetkin yok.', ORIGIN_REJECTED: 'Bu adresten yapılan istek kabul edilmedi.',
  PRODUCT_NOT_FOUND: 'Ürün artık bulunamıyor.', ORDER_NOT_FOUND: 'Sipariş bulunamadı.', INSUFFICIENT_STOCK: 'Yeterli stok yok. Sepet güncellendi; adetleri kontrol et.', STOCK_CHANGED: 'Stok değişti. Adetleri kontrol edip tekrar dene.',
  TOTAL_LIMIT: 'Sipariş tutarı sınırı aşıldı.', IDEMPOTENCY_CONFLICT: 'Bu deneme başka bir siparişle eşleşiyor. Siparişlerini kontrol et.',
  SERVICE_UNAVAILABLE: 'Veritabanına şu anda ulaşılamıyor.', INTERNAL_ERROR: 'İşlem tamamlanamadı. Biraz sonra tekrar dene.',
};
function node(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
function button(text, action, className = 'btn') { const el = node('button', text, className); el.type = 'button'; el.addEventListener('click', action); return el; }
function message(id, text = '', error = false) { const el = byId(id); el.textContent = text; el.className = (id.endsWith('Msg') && ['productsMsg', 'ordersMsg'].includes(id) ? 'status-message' : 'msg') + (text ? error ? ' error' : ' success' : ''); }
function toast(text, error = false) { clearTimeout(toastTimer); const el = byId('toast'); el.textContent = text; el.className = 'toast show ' + (error ? 'error' : 'success'); toastTimer = setTimeout(() => { el.className = 'toast'; }, 5000); }
function errorText(error) {
  let text = errors[error.code] || (error.status === 429 ? 'Çok fazla istek gönderdin.' : error.status === 403 ? 'İstek doğrulanamadı.' : error.status >= 500 ? 'Sunucuya şu anda ulaşılamıyor.' : error.message || 'İşlem başarısız.');
  if (error.details?.length) text = 'İşaretli alanları kontrol et. ' + error.details.map(d => d.message === 'Invalid value' ? 'Alan biçimi geçersiz.' : d.message).join(' ');
  if (error.retryAfter) text += ' ' + Math.ceil(error.retryAfter) + ' saniye sonra tekrar dene.';
  return text;
}
function clearFields(formId) {
  const form = byId(formId);
  for (const input of form.querySelectorAll('input')) { input.removeAttribute('aria-invalid'); const hint = byId(input.id + 'Error'); if (hint) hint.textContent = ''; }
}
function formError(formId, messageId, error) {
  message(messageId, errorText(error), true);
  const inputs = [...byId(formId).querySelectorAll('input')]; let first;
  for (const detail of error.details || []) {
    const input = inputs.find(el => el.name === detail.field); if (!input) continue;
    input.setAttribute('aria-invalid', 'true'); const hint = byId(input.id + 'Error');
    if (hint) { hint.textContent = detail.message === 'Invalid value' ? 'Alan biçimi geçersiz.' : detail.message; input.setAttribute('aria-describedby', hint.id + (input.id === 'regPassword' ? ' passwordHint' : '')); }
    first ||= input;
  }
  if (first) setTimeout(() => first.focus(), 0);
}
async function api(path, { method = 'GET', body, key, retry = true, quiet401 = false } = {}) {
  if (method !== 'GET' && !csrfToken) csrfToken = (await api('/api/csrf-token')).csrfToken;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
  let response, data;
  try {
    response = await fetch(path, { method, credentials: 'same-origin', signal: controller.signal,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'X-CSRF-Token': csrfToken } : {}), ...(key ? { 'Idempotency-Key': key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    data = await response.json();
  } catch { throw new Error('Sunucudan yanıt alınamadı. Bağlantını kontrol edip tekrar dene.'); }
  finally { clearTimeout(timer); }
  if (!response.ok) {
    if (response.status === 403 && data.code === 'CSRF_INVALID' && retry && method !== 'GET') { csrfToken = ''; return api(path, { method, body, key, retry: false, quiet401 }); }
    if (response.status === 401 && currentUser && !quiet401) { resetAccount(); toast('Oturumun sona erdi. Yeniden giriş yap.', true); }
    throw Object.assign(new Error('İstek tamamlanamadı.'), data, { status: response.status });
  }
  return data;
}
function authTab(tab) {
  if (authBusy) return;
  byId('loginForm').classList.toggle('hidden', tab !== 'login'); byId('registerForm').classList.toggle('hidden', tab !== 'register'); byId('otpForm').classList.add('hidden');
  for (const name of ['login', 'register']) { byId(name + 'Tab').classList.toggle('active', name === tab); byId(name + 'Tab').setAttribute('aria-pressed', String(name === tab)); }
}
function updateAuth() {
  byId('authPanel').classList.toggle('hidden', !!currentUser); byId('userPanel').classList.toggle('hidden', !currentUser); byId('logoutBtn').classList.toggle('hidden', !currentUser);
  byId('authStatus').textContent = currentUser ? currentUser.username : 'Giriş yapılmadı'; byId('welcomeUser').textContent = currentUser ? 'Merhaba, ' + currentUser.username : '';
}
function resetAccount() {
  currentUser = null; cart = []; pendingOrder = null; pendingUsername = ''; otpTimes = null; csrfToken = ''; orderRequest++;
  byId('ordersList').replaceChildren(); byId('checkoutForm').reset(); byId('otpForm').reset(); byId('loginPassword').value = ''; byId('regPassword').value = '';
  if (byId('cartPanel').open) byId('cartPanel').close();
  updateAuth(); renderCart(); authTab('login'); showSection('products');
}
async function busyForm(formId, messageId, action) {
  if (authBusy) return;
  authBusy = true; const form = byId(formId); form.querySelector('fieldset').disabled = true; form.setAttribute('aria-busy', 'true');
  byId('loginTab').disabled = true; byId('registerTab').disabled = true; clearFields(formId); message(messageId);
  try { await action(); } catch (error) { formError(formId, messageId, error); }
  finally { authBusy = false; form.querySelector('fieldset').disabled = false; form.removeAttribute('aria-busy'); byId('loginTab').disabled = false; byId('registerTab').disabled = false; updateOtpTimer(); }
}
function showOtp(data) {
  otpTimes = data; byId('loginForm').classList.add('hidden'); byId('otpForm').classList.remove('hidden'); byId('otpCode').value = '';
  message('otpMsg', 'Kod gönderildi. Yerel denemede kod sunucunun terminalinde görünür.'); updateOtpTimer();
  // Run after the form fieldset is re-enabled by busyForm.
  setTimeout(() => byId('otpCode').focus(), 0);
}
function updateOtpTimer() {
  if (!otpTimes) return;
  const remaining = Math.max(0, Math.ceil((otpTimes.expiresAt - Date.now()) / 1000)), wait = Math.max(0, Math.ceil((otpTimes.resendAt - Date.now()) / 1000));
  byId('otpTimer').textContent = remaining ? 'Kod süresi: ' + Math.floor(remaining / 60) + ':' + String(remaining % 60).padStart(2, '0') : 'Kodun süresi doldu. Girişe dönerek yeni kod al.';
  byId('resendOtpBtn').disabled = authBusy || wait > 0 || !remaining; byId('verifyOtpBtn').disabled = authBusy || !remaining;
  byId('resendOtpBtn').textContent = wait ? 'Yeniden gönder (' + wait + ' sn)' : 'Yeniden gönder';
}
async function login() {
  await busyForm('loginForm', 'loginMsg', async () => {
    const username = byId('loginUsername').value.trim(); const data = await api('/api/auth/login', { method: 'POST', body: { username, password: byId('loginPassword').value } });
    pendingUsername = username; byId('loginPassword').value = ''; showOtp(data);
  });
}
async function verifyOtp() {
  await busyForm('otpForm', 'otpMsg', async () => {
    const data = await api('/api/auth/verify-otp', { method: 'POST', body: { username: pendingUsername, otpCode: byId('otpCode').value.trim() } });
    currentUser = data.user; pendingUsername = ''; otpTimes = null; csrfToken = ''; byId('otpForm').reset(); updateAuth(); toast('Giriş başarılı.'); byId('productsTab').focus();
  });
}
async function register() {
  let success = false;
  await busyForm('registerForm', 'registerMsg', async () => {
    await api('/api/auth/register', { method: 'POST', body: { username: byId('regUsername').value.trim(), phoneNumber: byId('regPhoneNumber').value.trim(), password: byId('regPassword').value } });
    byId('loginUsername').value = byId('regUsername').value.trim(); byId('registerForm').reset(); success = true;
  });
  if (success) { authTab('login'); message('loginMsg', 'Kayıt tamamlandı. Şifrenle giriş yapabilirsin.'); byId('loginPassword').focus(); }
}
async function logout() {
  if (checkoutBusy || authBusy) return;
  byId('logoutBtn').disabled = true; byId('logoutPanelBtn').disabled = true;
  try { await api('/api/auth/logout', { method: 'POST', body: {} }); resetAccount(); toast('Çıkış yapıldı.'); byId('loginUsername').focus(); }
  catch (error) { toast(errorText(error), true); }
  finally { byId('logoutBtn').disabled = false; byId('logoutPanelBtn').disabled = false; }
}
function showSection(section) {
  for (const name of ['products', 'orders']) { byId(name + 'Section').classList.toggle('hidden', name !== section); byId(name + 'Tab').classList.toggle('active', name === section); byId(name + 'Tab').setAttribute('aria-pressed', String(name === section)); }
  if (section === 'orders') loadOrders();
}
async function loadProducts() {
  const serial = ++productRequest; byId('searchBtn').disabled = true; message('productsMsg', 'Ürünler yükleniyor…');
  try {
    const data = await api('/api/products?q=' + encodeURIComponent(byId('searchInput').value.trim())); if (serial !== productRequest) return;
    products = data.products; renderProducts(); message('productsMsg', products.length ? '' : 'Aramana uygun ürün bulunamadı.');
  } catch (error) { if (serial === productRequest) { byId('productsGrid').replaceChildren(); message('productsMsg', errorText(error), true); } }
  finally { if (serial === productRequest) byId('searchBtn').disabled = false; }
}
function renderProducts() {
  const grid = byId('productsGrid'); grid.replaceChildren();
  for (const product of products) {
    const card = node('article', undefined, 'product-card'), visual = node('div', product.image_url || '📦', 'product-img'); visual.setAttribute('aria-hidden', 'true');
    card.append(visual, node('h2', product.name, 'product-name'), node('p', money(product.price), 'product-price'), node('p', 'Stok: ' + product.stock, 'muted'));
    const add = button(product.stock ? 'Sepete ekle' : 'Tükendi', () => addToCart(product), 'btn btn-primary'); add.disabled = !product.stock; add.setAttribute('aria-label', product.name + ' — sepete ekle'); card.append(add); grid.append(card);
  }
}
function addToCart(product) {
  if (!currentUser) { toast('Sepete eklemek için giriş yap.', true); byId('loginUsername').focus(); return; }
  if (pendingOrder || checkoutBusy) { toast('Bekleyen sipariş denemesini önce tamamla.', true); return; }
  const item = cart.find(i => i.id === product.id), max = Math.min(product.stock, 99);
  if (item && item.quantity >= max) { toast('Bu ürünün adet sınırına ulaştın.', true); return; }
  if (!max) return;
  if (item) item.quantity++; else cart.push({ ...product, quantity: 1 });
  message('checkoutMsg'); renderCart(); toast(product.name + ' sepete eklendi.');
}
function renderCart() {
  const focusedLabel = byId('cartItems').contains(document.activeElement) ? document.activeElement.getAttribute('aria-label') : null;
  byId('cartCount').textContent = cart.reduce((sum, item) => sum + item.quantity, 0);
  byId('cartTotal').textContent = money(cart.reduce((sum, item) => sum + Math.round(item.price * 100) * item.quantity, 0) / 100);
  const list = byId('cartItems'); list.replaceChildren();
  if (!cart.length) list.append(node('p', 'Sepetin boş.', 'muted'));
  for (const item of cart) {
    const row = node('div', undefined, 'cart-item'), body = node('div', undefined, 'cart-item-body'), controls = node('div', undefined, 'qty-controls');
    body.append(node('strong', item.name), node('p', money(item.price) + ' × ' + item.quantity));
    const change = delta => { item.quantity += delta; if (!item.quantity) cart = cart.filter(i => i !== item); message('checkoutMsg'); renderCart(); };
    const minus = button('−', () => change(-1), 'icon-btn'), plus = button('+', () => change(1), 'icon-btn'), remove = button('Kaldır', () => { cart = cart.filter(i => i !== item); renderCart(); }, 'link-btn');
    minus.setAttribute('aria-label', item.name + ' adedini azalt'); plus.setAttribute('aria-label', item.name + ' adedini artır'); remove.setAttribute('aria-label', item.name + ' ürününü kaldır');
    for (const el of [minus, plus, remove]) el.disabled = checkoutBusy || !!pendingOrder;
    plus.disabled ||= item.quantity >= Math.min(item.stock, 99);
    controls.append(minus, node('span', item.quantity), plus, remove); body.append(controls); row.append(body); list.append(row);
  }
  if (focusedLabel) {
    const controls = [...list.querySelectorAll('button')];
    const previous = controls.find(el => el.getAttribute('aria-label') === focusedLabel);
    (previous?.disabled ? controls.find(el => !el.disabled) : previous)?.focus();
  }
  byId('checkoutBtn').disabled = checkoutBusy || !cart.length;
  byId('checkoutBtn').textContent = checkoutBusy ? 'Sipariş işleniyor…' : pendingOrder ? 'Aynı siparişi tekrar dene' : 'Siparişi tamamla';
  byId('clearCartBtn').disabled = checkoutBusy || !!pendingOrder || !cart.length;
  for (const id of ['shippingStreet', 'shippingCity']) byId(id).readOnly = checkoutBusy || !!pendingOrder;
}
async function refreshCartStock() {
  const refreshed = await Promise.all(cart.map(async item => {
    try { return { ...item, ...await api('/api/products/' + item.id) }; }
    catch (error) { if (error.status === 404) return null; throw error; }
  }));
  cart = refreshed.filter(item => item && item.stock > 0).map(item => ({ ...item, quantity: Math.min(item.quantity, item.stock, 99) })); renderCart();
}
async function checkout() {
  if (checkoutBusy || !cart.length) return;
  if (!currentUser) { message('checkoutMsg', 'Önce giriş yap.', true); return; }
  clearFields('checkoutForm'); message('checkoutMsg');
  pendingOrder ||= { key: crypto.randomUUID(), body: { items: cart.map(item => ({ productId: item.id, quantity: item.quantity })), shippingAddress: { street: byId('shippingStreet').value.trim(), city: byId('shippingCity').value.trim() } } };
  checkoutBusy = true; renderCart(); byId('checkoutForm').setAttribute('aria-busy', 'true');
  try {
    const result = await api('/api/checkout', { method: 'POST', ...pendingOrder });
    cart = []; pendingOrder = null; byId('checkoutForm').reset();
    message('checkoutMsg', 'Sipariş #' + result.orderId + ' kaydedildi. Toplam: ' + money(result.totalAmount) + '. Ödeme alınmadı.');
    await loadProducts();
  } catch (error) {
    // A lost response or server error may follow a commit: retain both body and key.
    if (error.status && error.status < 500) pendingOrder = null;
    formError('checkoutForm', 'checkoutMsg', error);
    if (pendingOrder) message('checkoutMsg', errorText(error) + ' Sonuç kesinleşmedi. Aynı siparişi tekrar dene; ikinci kayıt oluşturulmaz. Sayfayı yenilemeden bu denemeyi tamamla.', true);
    if (['INSUFFICIENT_STOCK', 'STOCK_CHANGED', 'PRODUCT_NOT_FOUND'].includes(error.code)) {
      try { await refreshCartStock(); } catch { message('checkoutMsg', 'Stok bilgisi yenilenemedi. Biraz sonra tekrar dene.', true); }
    }
  } finally { checkoutBusy = false; renderCart(); byId('checkoutForm').removeAttribute('aria-busy'); }
}
const statusText = status => ({ pending: 'Alındı', confirmed: 'Onaylandı', shipped: 'Kargoda', delivered: 'Teslim edildi', cancelled: 'İptal edildi' })[status] || 'Bilinmiyor';
async function loadOrders() {
  const serial = ++orderRequest, list = byId('ordersList'); list.replaceChildren();
  if (!currentUser) { message('ordersMsg', 'Siparişlerini görmek için giriş yap.'); return; }
  byId('refreshOrdersBtn').disabled = true; message('ordersMsg', 'Siparişler yükleniyor…');
  try {
    const orders = await api('/api/checkout/orders'); if (serial !== orderRequest) return;
    message('ordersMsg', orders.length ? 'Son ' + orders.length + ' siparişin' : 'Henüz siparişin yok.');
    for (const order of orders) {
      const item = node('article', undefined, 'order-item'), row = node('div', undefined, 'order-row'), details = node('div', undefined, 'order-details hidden');
      details.id = 'order-' + order.id;
      const toggle = button('Detayları göster', async () => {
        if (!details.classList.contains('hidden')) { details.classList.add('hidden'); toggle.setAttribute('aria-expanded', 'false'); toggle.textContent = 'Detayları göster'; return; }
        toggle.disabled = true;
        try {
          const data = await api('/api/checkout/orders/' + order.id); if (serial !== orderRequest) return;
          details.replaceChildren();
          for (const part of data.items) { const line = node('div', undefined, 'order-detail-row'); line.append(node('span', part.product_name + ' × ' + part.quantity), node('span', money(part.unit_price * part.quantity))); details.append(line); }
          details.append(node('p', data.shipping_address.street + '\n' + data.shipping_address.city, 'order-address'));
          details.classList.remove('hidden'); toggle.setAttribute('aria-expanded', 'true'); toggle.textContent = 'Detayları gizle';
        } catch (error) { message('ordersMsg', errorText(error), true); } finally { toggle.disabled = false; }
      });
      toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-controls', details.id);
      row.append(node('strong', '#' + order.id + ' · ' + money(order.total_amount)), node('span', statusText(order.status)), toggle);
      item.append(row, node('p', new Date(order.created_at).toLocaleString('tr-TR'), 'muted'), details); list.append(item);
    }
  } catch (error) { if (serial === orderRequest) message('ordersMsg', errorText(error), true); }
  finally { byId('refreshOrdersBtn').disabled = false; }
}
for (const [form, handler] of [['loginForm', login], ['registerForm', register], ['otpForm', verifyOtp], ['searchForm', loadProducts], ['checkoutForm', checkout]]) byId(form).addEventListener('submit', event => { event.preventDefault(); handler(); });
byId('loginTab').addEventListener('click', () => authTab('login')); byId('registerTab').addEventListener('click', () => authTab('register'));
byId('productsTab').addEventListener('click', () => showSection('products')); byId('ordersTab').addEventListener('click', () => showSection('orders'));
byId('logoutBtn').addEventListener('click', logout); byId('logoutPanelBtn').addEventListener('click', logout);
byId('cartToggleBtn').addEventListener('click', () => { renderCart(); byId('cartPanel').showModal(); });
byId('closeCartBtn').addEventListener('click', () => byId('cartPanel').close());
byId('clearCartBtn').addEventListener('click', () => { if (pendingOrder || checkoutBusy) return; cart = []; renderCart(); message('checkoutMsg'); });
byId('refreshOrdersBtn').addEventListener('click', loadOrders);
byId('resendOtpBtn').addEventListener('click', () => busyForm('otpForm', 'otpMsg', async () => showOtp(await api('/api/auth/resend-otp', { method: 'POST', body: {} }))));
byId('backLoginBtn').addEventListener('click', async () => {
  let done = false;
  await busyForm('otpForm', 'otpMsg', async () => { await api('/api/auth/logout', { method: 'POST', body: {} }); pendingUsername = ''; otpTimes = null; csrfToken = ''; done = true; });
  if (done) { authTab('login'); byId('loginPassword').focus(); }
});
setInterval(updateOtpTimer, 1000);
async function boot() {
  renderCart();
  try { currentUser = await api('/api/auth/me', { quiet401: true }); } catch (error) { if (error.status !== 401) message('loginMsg', errorText(error), true); }
  updateAuth(); await loadProducts();
}
boot();
