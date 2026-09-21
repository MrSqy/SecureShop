> **Tarihsel kayıt (23 Mayıs 2026).** Aşağıdaki metin eski sürümü anlatır; güncel komut, test veya üretim kanıtı değildir. Son kod için [Türkçe rehberi](../PROJE_REHBERI.md) ve [21 Eylül doğrulamasını](DOGRULAMA.md) okuyun. Eski test sayıları, bağımlılık bulguları ve dosya adları bilerek tarihsel kayıt olarak korunmuştur.

# Local Transfer Preparation

Date: 2026-05-23  
Project: ecommerce-secure-hardened

This document prepares the project for a later manual GitHub transfer by the user. It intentionally contains no upload commands and no remote-management steps.

---

## 1. Current State

The local project has completed security hardening and demo-polish patches 1 through 13.

Final local verification:

```text
Test Suites: 3 passed, 3 total
Tests:       56 passed, 56 total
npm audit --audit-level=high: passed
```

Known dependency audit findings remain documented:

```text
2 low      csurf -> cookie
1 moderate uuid
```

These require focused future migration work because the suggested fixes involve breaking dependency upgrades.

---

## 2. Patch Summary

### Patch 1 — Frontend XSS Hardening

- Removed unsafe dynamic rendering.
- Removed inline dynamic event handlers.
- Switched to safer DOM rendering APIs.

### Patch 2 — Session and Cookie Hardening

- Added production session secret requirements.
- Centralized cookie name as `sid`.
- Fixed logout cookie clearing.
- Added production proxy and MemoryStore guardrails.

### Patch 3 — Production Mock Database Prevention

- Blocked production mock DB fallback.
- Added production DB environment validation.
- Blocked localhost DB hosts in production unless explicitly allowed.

### Patch 4A — CSRF Coverage

- Brought auth routes under CSRF protection.
- Kept CSRF token bootstrap route working.

### Patch 5A — Backend Security Regression Tests

- Added security tests.
- Made app importable for Supertest.

### Patch 5B — Checkout Regression Tests

- Added checkout auth, CSRF, validation, stock, and user ownership tests.

### Patch 6 — Checkout Duplicate Product Aggregation

- Aggregated duplicate product quantities before stock validation and decrement.

### Patch 7 — Local Dependency/Audit Cleanup

- Updated safe test dependencies.
- Documented remaining audit findings.

### Patch 8 — Documentation

- Updated README and local security/testing docs.

### Patch 9 — WhatsApp Notification + OTP Login

- Added WhatsApp OTP login.
- Kept WhatsApp order notification.
- Replaced email registration with phone-number registration.

### Patch 9 Correction — Local Mock OTP Visibility

- Development mock mode prints OTP code for manual testing.
- Production does not log OTP.

### Patch 10 — Final Local Validation Report

- Created local validation documentation.

### Patch 10B — Production Guardrail Restoration

- Restored and verified session and DB production guardrails.

### Patch 11 — Local GitHub Transfer Preparation

- Added local GitHub Actions workflow.
- Added transfer preparation notes.
- Updated `.gitignore`.

### Patch 12 — Final UI/UX Polish

- Fixed logout UI reset behavior.
- Added cart product visuals.
- Added order details UI and endpoint.
- Expanded demo product catalog.

### Patch 13 — Progressive Brute-Force Lockout

- Added password lockout after repeated wrong password attempts.
- Added OTP lockout after repeated wrong OTP attempts.
- Added progressive lock durations:
  - 30 seconds
  - 1 minute
  - 5 minutes
  - 30 minutes
- Added tests for lockout behavior.

---

## 3. Likely Changed Areas

- `src/app.js`
  - session secret validation
  - shared session cookie name
  - production proxy and MemoryStore guardrails

- `src/config/session.js`
  - shared session cookie name/config

- `src/models/db.js`
  - mock DB seed data
  - phone-number user model
  - production database configuration validation
  - mock fallback prevention
  - expanded demo product catalog

- `src/routes/auth.js`
  - phone-number registration
  - WhatsApp OTP login
  - OTP verification
  - lockout checks
  - shared logout cookie clearing

- `src/routes/checkout.js`
  - checkout validation
  - duplicate product aggregation
  - order notification integration
  - IDOR-safe order details endpoint

- `src/routes/products.js`
  - product listing/search behavior

- `src/middleware/validation.js`
  - phone number validation
  - OTP validation
  - checkout/order validation

- `src/services/whatsappNotifier.js`
  - WhatsApp order notification
  - WhatsApp OTP delivery
  - local mock OTP logging boundary

- `src/services/authLockout.js`
  - progressive password/OTP lockout service

- `public/index.html`
  - XSS-safe rendering
  - phone registration UI
  - OTP UI
  - cart visuals
  - order details UI
  - logout reset behavior

- `tests/`
  - security tests
  - checkout tests
  - WhatsApp notifier tests
  - lockout tests

- `aws/schema.sql`
  - phone-number user schema
  - expanded demo product catalog

- `docs/`
  - validation and transfer documentation

- `.github/workflows/security-ci.yml`
  - local CI workflow definition

- `.env.example`
  - documented session, DB, WhatsApp, and production guard variables

- `.gitignore`
  - ignores backup, env, generated, and local files

---

## 4. Known Remaining Risks

- `csurf` is deprecated and should be replaced in a focused future migration.
- `npm audit` still reports low `csurf -> cookie` findings and a moderate `uuid` finding.
- `script-src` still includes `'unsafe-inline'` because inline script blocks remain.
- A real production session store is not implemented.
- In-memory brute-force lockout state should be replaced with Redis/DB-backed state in production.
- Real WhatsApp Cloud API credentials and template setup are not configured locally.
- Real cloud deployment is not included in this local demo.
- Payment processing is not integrated.
- Order management is still demo-level.
- This repository should be presented as a security-hardened demo, not a fully production-ready platform.

---

## 5. Local Validation Commands

Run these commands locally before any manual transfer step:

```bash
npm install
npm test
npm audit --audit-level=high
node --check src/app.js
node --check src/routes/auth.js
node --check src/routes/checkout.js
node --check src/middleware/validation.js
node --check src/models/db.js
node --check src/services/whatsappNotifier.js
node --check src/services/authLockout.js
```

Either `npm install` or `npm ci` can be used in a clean local setup. `npm ci` is preferred when `package-lock.json` should be respected exactly.

---

## 6. Safety Checks Before Transfer

### Backup file check

```bash
find . \( -name "*.bak" -o -name "*.patch*.bak" \) -type f
```

Expected:

```text
No output
```

### Real environment file check

```bash
find . \( -name ".env" -o -name ".env.*" \) -type f
```

Expected:

```text
Only .env.example is allowed
```

### XSS unsafe pattern check

```bash
grep -n "innerHTML\|onclick=\|onkeydown=" public/index.html
```

Expected:

```text
No output
```

### Old email registration flow check

```bash
grep -n "email" src/routes/auth.js src/middleware/validation.js src/models/db.js public/index.html aws/schema.sql
```

Expected:

```text
No old email registration flow
```

---

## 7. Suggested Review Grouping

Suggested logical review groups:

1. Frontend XSS and safe rendering changes
2. Session, cookie, production proxy, and MemoryStore guardrails
3. Production database configuration and mock fallback prevention
4. CSRF coverage and auth route hardening
5. WhatsApp OTP login and local mock testing visibility
6. Progressive brute-force lockout
7. Checkout validation, duplicate item aggregation, stock handling, and order authorization
8. Order details endpoint and IDOR protection
9. UI/UX polish and expanded demo catalog
10. Regression tests and local documentation
11. Local CI workflow and transfer preparation notes

---

## 8. Suggested PR Text

Title:

```text
Harden e-commerce demo auth, checkout, OTP, and local security validation
```

Description:

```text
This update hardens the local security-focused e-commerce demo across frontend rendering, session/cookie handling, production database guardrails, CSRF-protected authentication, WhatsApp OTP login, progressive brute-force lockout, checkout validation, order detail authorization, and automated regression tests.

The demo also includes UI/UX improvements such as cart visuals, order details, logout state reset, and an expanded product catalog.

Automated local validation passes with 3 test suites and 56 tests. The remaining npm audit findings are documented and limited to known low/moderate advisories that require focused future dependency migration.
```

---

## 9. Transfer Warnings

Do not transfer local-only or generated files.

Do not transfer:

- `.env`
- `.env.local`
- `.env.production`
- `.env.staging`
- `*.bak`
- `*.patch*.bak`
- `node_modules/`
- `coverage/`
- `logs/`
- `cookies.txt`
- `npm-debug.log*`
- `.DS_Store`

Allowed:

- `.env.example`
- `package-lock.json`
- `.github/workflows/security-ci.yml`
- `docs/`
- `tests/`

---

## 10. Final Transfer Readiness

The project is ready for manual Git/GitHub transfer if these conditions remain true:

- `npm test` passes with 56 tests.
- `npm audit --audit-level=high` exits successfully.
- No backup files are present.
- No real `.env` files are present.
- No unsafe frontend grep matches exist.
- No old email registration flow exists.
- `.gitignore` excludes generated/local files.
- README positions the project as a security-hardened demo, not a full production platform.

This document intentionally does not include upload commands.
