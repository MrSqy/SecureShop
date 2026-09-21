const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createContext, runInContext } = require('node:vm');
const { randomUUID } = require('node:crypto');

// A small DOM double exercises the shipped script's requests and UI state.
// This is not a browser layout, focus or accessibility test.
function element() {
  return {
    textContent: '', value: '', children: [],
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    addEventListener() {}, setAttribute() {}, removeAttribute() {}, focus() {}, reset() {},
    contains() { return false; }, querySelectorAll() { return []; },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
  };
}
async function frontend(checkoutReplies) {
  const html = readFileSync(join(__dirname, '../public/index.html'), 'utf8');
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => [id, element()]));
  const product = { id: 1, name: 'Deneme ürünü', price: 12.50, stock: 4 };
  const requests = [];
  const context = createContext({
    document: { getElementById: id => elements.get(id), createElement: element, activeElement: null },
    crypto: { randomUUID }, AbortController,
    // No real waits: deadlines and DOM timing are covered separately.
    setTimeout() {}, clearTimeout() {}, setInterval() {},
    fetch: async (path, options) => {
      let status = 200, data;
      if (path === '/api/checkout') {
        requests.push({ key: options.headers['Idempotency-Key'], body: options.body });
        const reply = checkoutReplies.shift();
        if (!reply) throw new Error('Unexpected checkout request');
        if (reply instanceof Error) throw reply;
        ({ status, data } = reply);
      } else if (path === '/api/auth/me') data = { id: 1, username: 'Demo' };
      else if (path === '/api/csrf-token') data = { csrfToken: 'test-csrf-token' };
      else if (path === '/api/products/1') data = { ...product, stock: 1 };
      else if (path.startsWith('/api/products?')) data = { products: [product] };
      else throw new Error('Unexpected endpoint: ' + path);
      return { ok: status >= 200 && status < 300, status, json: async () => data };
    },
  });
  await runInContext(readFileSync(join(__dirname, '../public/app.js'), 'utf8'), context);
  runInContext('addToCart(products[0])', context);
  elements.get('shippingStreet').value = 'Örnek Sokak 12';
  elements.get('shippingCity').value = 'İstanbul';
  return { elements, requests, run: source => runInContext(source, context) };
}
const success = () => ({ status: 200, data: { orderId: 7, totalAmount: 12.50, replayed: true } });

describe('checkout retry in the shipped frontend script', () => {
  test.each([
    [429, 'RATE_LIMIT_EXCEEDED'], [403, 'ORIGIN_REJECTED'],
    [409, 'IDEMPOTENCY_CONFLICT'], [404, 'NOT_FOUND'], [400, 'BAD_REQUEST'],
  ])('keeps the original request after a lost response followed by %i %s', async (status, code) => {
    const ui = await frontend([new Error('Response lost after commit'), { status, data: { code } }, success()]);
    await ui.run('checkout()');
    expect(ui.elements.get('shippingStreet').readOnly).toBe(true);
    await ui.run('checkout()');
    expect(ui.elements.get('shippingStreet').readOnly).toBe(true);
    expect(ui.elements.get('clearCartBtn').disabled).toBe(true);
    expect(ui.elements.get('checkoutBtn').textContent).toBe('Aynı siparişi tekrar dene');
    await ui.run('checkout()');
    expect(ui.requests).toHaveLength(3);
    expect(ui.requests[1]).toEqual(ui.requests[0]);
    expect(ui.requests[2]).toEqual(ui.requests[0]);
    expect(ui.elements.get('checkoutMsg').textContent).toContain('Sipariş #7 kaydedildi');
    expect(ui.elements.get('shippingStreet').readOnly).toBe(false);
    expect(ui.elements.get('checkoutBtn').disabled).toBe(true);
  });

  test('retains the key across automatic CSRF refresh and a later user retry', async () => {
    const csrfError = { status: 403, data: { code: 'CSRF_INVALID' } };
    const ui = await frontend([{ status: 502, data: {} }, csrfError, csrfError, success()]);
    await ui.run('checkout()');
    await ui.run('checkout()');
    await ui.run('checkout()');
    expect(ui.requests).toHaveLength(4);
    for (const request of ui.requests) expect(request).toEqual(ui.requests[0]);
  });

  test('allows corrected input and a new attempt after explicit validation rejection', async () => {
    const ui = await frontend([{ status: 400, data: { code: 'VALIDATION_FAILED' } }, success()]);
    await ui.run('checkout()');
    expect(ui.elements.get('shippingStreet').readOnly).toBe(false);
    ui.elements.get('shippingStreet').value = 'Düzeltilmiş Sokak 24';
    await ui.run('checkout()');
    expect(ui.requests[1].key).not.toBe(ui.requests[0].key);
    expect(JSON.parse(ui.requests[1].body).shippingAddress.street).toBe('Düzeltilmiş Sokak 24');
  });

  test('refreshes stock and permits cart changes after a definitive stock rejection', async () => {
    const ui = await frontend([{ status: 400, data: { code: 'INSUFFICIENT_STOCK' } }]);
    ui.run('addToCart(products[0])');
    await ui.run('checkout()');
    expect(ui.elements.get('shippingStreet').readOnly).toBe(false);
    expect(ui.elements.get('clearCartBtn').disabled).toBe(false);
    expect(ui.elements.get('cartCount').textContent).toBe(1);
  });
});
