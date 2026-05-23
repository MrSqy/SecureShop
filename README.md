# 🔒 SecureShop — Security-Hardened E-Commerce Demo

SecureShop is a Node.js/Express based e-commerce demo application that has been hardened against common web application security risks.

This project is **not presented as a fully production-ready e-commerce platform**. Instead, it demonstrates how an existing e-commerce demo can be improved through practical security hardening, regression tests, safer authentication flow, checkout integrity controls, and production configuration guardrails.

---

## 🎯 Project Goal

The goal of this project is to demonstrate security-focused development practices on a realistic e-commerce flow:

- User registration and login
- WhatsApp OTP verification
- Product listing and search
- Cart management
- Checkout and stock validation
- Order history and order details
- Security regression tests
- Production misconfiguration safeguards

The main focus is not only adding features, but reducing the attack surface and validating security behavior with automated tests.

---

## ✅ Current Status

Final local verification result:

```text
Test Suites: 3 passed, 3 total
Tests:       56 passed, 56 total
npm audit --audit-level=high: passed
```

Known remaining audit findings:

```text
2 low      csurf -> cookie
1 moderate uuid
```

These are documented as future migration work because the suggested fixes require breaking dependency upgrades.

---

## 🧱 Tech Stack

- Node.js
- Express.js
- MySQL / mock in-memory DB for local demo
- express-session
- Helmet
- CSRF protection
- bcryptjs
- express-validator
- Winston logger
- Jest
- Supertest
- WhatsApp Cloud API style notifier with local mock mode

---

## 🔐 Implemented Security Features

### 1. Frontend XSS Hardening

The frontend was refactored to avoid unsafe dynamic HTML rendering.

Implemented controls:

- Removed unsafe dynamic `innerHTML` rendering
- Removed inline dynamic event handlers
- Replaced dynamic UI rendering with `document.createElement`, `textContent`, and `addEventListener`
- CSP `script-src-attr` tightened to `'none'`
- Product, cart, and order rendering use safer DOM construction

Verification:

```bash
grep -n "innerHTML\|onclick=\|onkeydown=" public/index.html
```

Expected result:

```text
No unsafe matches
```

---

### 2. CSRF Protection

State-changing routes are protected with CSRF validation.

Protected flows include:

- Register
- Login
- OTP verification
- Logout
- Checkout
- Product/state-changing API routes where applicable

Example test:

```bash
curl -i -X POST http://localhost:3000/api/auth/logout
```

Expected result:

```text
403 CSRF_INVALID
```

---

### 3. Session and Cookie Hardening

Session handling was strengthened for safer local and production behavior.

Implemented controls:

- `SESSION_SECRET` is required in production
- Production `SESSION_SECRET` must be at least 32 characters
- Development/test may use a local fallback with warning
- Session cookie name is centralized as `sid`
- Logout clears the correct `sid` cookie
- Production sets `trust proxy`
- Production refuses unsafe default MemoryStore unless explicitly overridden for short-lived demos

Production guard examples:

```bash
env -u SESSION_SECRET NODE_ENV=production npm start
```

Expected:

```text
SESSION_SECRET is required in production.
```

```bash
NODE_ENV=production SESSION_SECRET="weak" npm start
```

Expected:

```text
SESSION_SECRET must be at least 32 characters in production.
```

---

### 4. Production Mock DB Prevention

The project supports a local mock database for demo/testing, but production mode is guarded.

Implemented controls:

- `DB_MOCK=true` is rejected in production
- Missing production DB environment variables fail fast
- `localhost`, `127.0.0.1`, and `::1` DB hosts are blocked in production unless explicitly allowed for short-lived demo use
- Real DB connection failure in production does not silently fall back to mock DB
- Local demo admin exists only in mock mode

Local mock admin:

```text
username: admin
password: Admin@123!
phoneNumber: +905555555555
```

---

### 5. WhatsApp OTP Login

Authentication is now a two-step flow.

Registration uses:

```text
username
phoneNumber
password
```

Login flow:

```text
1. User enters username + password
2. If credentials are valid, server generates a 6-digit OTP
3. OTP is sent through WhatsApp notifier
4. Session is NOT created yet
5. User verifies OTP via /api/auth/verify-otp
6. Session is created only after successful OTP verification
```

OTP security properties:

- 6 digits
- bcrypt-hashed server-side
- expires after 5 minutes
- single-use
- not returned in frontend response
- not logged in production
- local development mock mode can print OTP for manual testing

Local mock OTP log example:

```text
LOCAL MOCK WhatsApp OTP code {"purpose":"otp-login","to":"+905...","otpCode":"241414"}
```

Real WhatsApp delivery requires Meta WhatsApp Cloud API credentials and proper production setup.

---

### 6. Brute-Force Protection

In addition to rate limiting, the project includes username-based progressive lockout.

Password step:

- 5 wrong password attempts trigger lockout

OTP step:

- 3 wrong OTP attempts trigger lockout

Progressive lock durations:

```text
1st lock: 30 seconds
2nd lock: 1 minute
3rd lock: 5 minutes
4th+ lock: 30 minutes
```

While locked, even the correct password or OTP is rejected until the lock expires.

Implementation:

```text
src/services/authLockout.js
```

Production note:

The current lockout store is in-memory and suitable for this demo. Multi-instance production deployments should use Redis or a database-backed lockout store.

---

### 7. Checkout Integrity

The checkout flow calculates totals server-side and validates product stock.

Security improvements:

- Server-side total calculation
- Stock validation
- Transaction-based checkout flow
- `SELECT ... FOR UPDATE`
- Duplicate `productId` quantities are aggregated before stock validation and stock decrement

Example fixed issue:

```json
{
  "items": [
    { "productId": 4, "quantity": 40 },
    { "productId": 4, "quantity": 40 }
  ]
}
```

If product 4 has stock 75, the combined quantity is 80 and the order is rejected.

---

### 8. IDOR-Protected Order Details

Users can view their own order details, but cannot access another user's order details.

Endpoint:

```text
GET /api/checkout/orders/:id
```

Security control:

```sql
WHERE id = ? AND user_id = ?
```

Tested behavior:

- unauthenticated detail request returns `401`
- user can view own order details
- another user cannot view someone else’s order details
- invalid order id fails validation
- non-existing order returns safe error

---

### 9. WhatsApp Order Notification

After successful checkout, the backend can send an optional WhatsApp notification.

Behavior:

- Runs only after transaction commit
- Does not rollback order if notification fails
- Does not expose WhatsApp errors to frontend
- Does not expose tokens
- Supports local mock mode

---

## 🧪 Test Coverage

Run:

```bash
npm test
```

Expected:

```text
Test Suites: 3 passed, 3 total
Tests:       56 passed, 56 total
```

Current coverage highlights:

```text
All files:        ~80% statements
auth.js:          ~87% statements
checkout.js:      ~91% statements
authLockout.js:   100% statements
whatsappNotifier: ~91% statements
validation.js:    100% statements
```

Test suites cover:

- CSRF behavior
- Auth flow
- WhatsApp OTP login
- OTP single-use behavior
- OTP expiration
- Password brute-force lockout
- OTP brute-force lockout
- Checkout validation
- Stock validation
- Duplicate product aggregation
- Order details IDOR protection
- WhatsApp notification mock behavior
- Production guardrails

---

## 🚀 Local Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Start local development server

For local mock/demo mode:

```bash
NODE_ENV=development \
SESSION_SECRET="dev-secret-please-change-123456789" \
WHATSAPP_MOCK_SEND=true \
npm start
```

Then open:

```text
http://localhost:3000
```

### 3. Local mock login

You can register a new user with:

```text
username
phoneNumber
password
```

Or use the local demo admin:

```text
username: admin
password: Admin@123!
phoneNumber: +905555555555
```

During login, the OTP code is printed in the terminal only in local development mock mode.

---

## ⚙️ Environment Variables

Example environment variables are documented in:

```text
.env.example
```

Important variables:

```env
NODE_ENV=development
PORT=3000
SESSION_SECRET=dev-secret-please-change-123456789

DB_MOCK=true
DB_HOST=
DB_NAME=
DB_USER=
DB_PASSWORD=

WHATSAPP_NOTIFICATIONS_ENABLED=false
WHATSAPP_GRAPH_API_VERSION=v20.0
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_TO_PHONE_NUMBER=
WHATSAPP_MOCK_SEND=true
```

Security notes:

- Do not commit real `.env` files
- Do not commit WhatsApp tokens
- Do not use development secrets in production
- Production requires a strong `SESSION_SECRET`
- Production requires a real session store
- Production should not use mock DB

---

## 🔍 Useful Security Checks

### XSS grep check

```bash
grep -n "innerHTML\|onclick=\|onkeydown=" public/index.html
```

Expected:

```text
No matches
```

### Old email registration flow check

```bash
grep -n "email" src/routes/auth.js src/middleware/validation.js src/models/db.js public/index.html aws/schema.sql
```

Expected:

```text
No old email registration flow
```

### Test suite

```bash
npm test
```

Expected:

```text
3 test suites passed
56 tests passed
```

### High severity audit gate

```bash
npm audit --audit-level=high
```

Expected:

```text
Exit 0
```

### Backup/env cleanup check

```bash
find . \( -name "*.bak" -o -name "*.patch*.bak" \) -type f
find . \( -name ".env" -o -name ".env.*" \) -type f
```

Expected:

```text
No backup files
Only .env.example is allowed
```

---

## 📁 Project Structure

```text
ecommerce-secure-hardened/
├── src/
│   ├── app.js
│   ├── config/
│   │   └── session.js
│   ├── middleware/
│   │   ├── errorHandler.js
│   │   ├── rateLimiter.js
│   │   └── validation.js
│   ├── models/
│   │   └── db.js
│   ├── routes/
│   │   ├── auth.js
│   │   ├── checkout.js
│   │   └── products.js
│   ├── services/
│   │   ├── authLockout.js
│   │   └── whatsappNotifier.js
│   └── utils/
│       └── logger.js
├── public/
│   └── index.html
├── aws/
│   └── schema.sql
├── tests/
│   ├── security.test.js
│   ├── checkout.test.js
│   └── whatsappNotifier.test.js
├── docs/
│   ├── FINAL_LOCAL_VALIDATION.md
│   ├── GIT_TRANSFER_PREP.md
│   ├── LOCAL_DEPENDENCY_AUDIT.md
│   └── LOCAL_TESTING_CHECKLIST.md
├── .github/
│   └── workflows/
│       └── security-ci.yml
├── .env.example
├── package.json
├── package-lock.json
└── README.md
```

---

## 🧭 Known Limitations

This is a security-hardened demo, not a fully production-ready platform.

Known limitations:

- `csurf` is deprecated and should be replaced in a focused future migration
- `uuid` audit finding remains; breaking upgrade was not applied
- CSP still uses `script-src 'unsafe-inline'` because inline script blocks remain
- Production session store is not implemented
- In-memory lockout store should be replaced with Redis/DB in production
- Real WhatsApp delivery requires Meta WhatsApp Cloud API credentials and template setup
- Real cloud deployment is not included in this local demo
- Secrets management is not implemented
- Payment processing is not integrated
- Order management is still demo-level

---

## ☁️ Optional Cloud Architecture Note

The project can be extended toward a production-style architecture using:

- AWS WAF
- Application Load Balancer
- Private EC2 instances
- RDS MySQL
- Multi-AZ deployment
- Redis session store
- CI/CD pipeline
- Centralized logging and monitoring

However, this repository currently demonstrates the application-level security hardening and local testable behavior. It should not be claimed as a fully deployed cloud-native production platform unless that infrastructure is actually implemented.

---

## 🧾 Summary

This project demonstrates practical security improvements on an e-commerce application:

- XSS-safe frontend rendering
- CSRF-protected state-changing routes
- hardened session/cookie behavior
- production misconfiguration fail-fast behavior
- WhatsApp OTP login
- progressive brute-force lockout
- checkout business logic protection
- IDOR-protected order details
- automated security regression testing
- local CI-ready workflow

The project is suitable as a security hardening case study and educational DevSecOps demo.
