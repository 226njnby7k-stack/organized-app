# Organized App — Self-Hosted Fork

A Google-free, self-hostable backend for the Organized congregation management app
(upstream: https://github.com/sws2apps/organized-app).

This document is the source of truth for the project. Update it at the end of every
working session: what was decided, what was done, what's next.

---

## 1. Goal

Run Organized for our congregation with **no dependency on Google / Firebase**, on
infrastructure we control, while preserving the app's end-to-end encryption and the
ability to pull upstream updates over time.

Stretch goal: build out the roadmap features that are still "awaiting development"
(meeting duties, information board, hall cleaning, territories, etc.) on top of our
self-hosted backend.

---

## 2. Hard constraints

- **No Google services.** No Firestore, no Firebase Auth, no Firebase Functions,
  no Firebase Hosting, no GCP.
- **Privacy & security first.** Server stores only end-to-end encrypted sync data
  plus the minimum auth metadata. Server operator (us) must not be able to read
  congregation **content**. (The operator *can* necessarily see routing/auth
  **metadata** — emails, membership, sessions; and the client's E2E KDF is weak.
  Both are documented as accepted risks in §10, audit M3–M5.)
- **EU data residency** for GDPR alignment (congregation data stays in-region).
- **TypeScript + Node** backend, to mirror upstream's own stack and ease porting
  their future server-side changes.
- **Upstream-mergeable.** Our changes isolated so `git merge upstream/main` stays
  manageable.

---

## 3. Architecture overview

```
  Client (unchanged Organized PWA, React/TS)
        │   local-first: all data in IndexedDB on device
        │   client-side E2E encryption (KEEP AS-IS)
        ▼
  ── HTTPS (Caddy, auto-TLS) ──────────────────────────
        ▼
  Self-hosted Node/TS API  (replaces Firebase)
        ├── Auth:   JWT sessions + TOTP 2FA + invite codes
        ├── Sync:   encrypted-blob storage + delta sync
        └── Realtime: WebSocket push (or polling fallback)
        ▼
  PostgreSQL  (replaces Firestore)
```

Everything in Docker on the VPS. Caddy terminates TLS and reverse-proxies the API.

The client only ever sends the server **already-encrypted** payloads. The server is
a dumb, trusted-as-little-as-possible sync + auth box.

---

## 4. Infrastructure decision

| Environment | Host | Purpose |
|---|---|---|
| **dev / staging** | Home VM behind OPNsense | Build, break, test. No uptime pressure. |
| **production** | Hetzner VPS (EU), 2 vCPU / 4 GB | Real congregation use. EU residency. |

Stack on each: Docker Compose running `postgres`, `api` (Node/TS), `caddy`.

Rationale for not home-hosting production: availability, not capability. Real users
hit the app on meeting nights from phones; production uptime shouldn't depend on home
power/ISP/router. Home is ideal for the dev/staging instance.

---

## 5. The three Google touchpoints to replace

1. **Firestore** → PostgreSQL. Need to map their collection/document model to a
   relational schema. The stored payloads are encrypted blobs + metadata, so most
   tables are (id, owner/congregation, encrypted_blob, version, updated_at).
2. **Firebase Auth** → own JWT session layer + TOTP 2FA + one-time invite codes.
   Highest security surface — design carefully, reuse their client-side 2FA code
   where it isn't Firebase-coupled.
3. **Firebase Functions / Hosting** (if used) → endpoints in our Node API; static
   PWA served by Caddy or any static host.

---

## 6. Milestones (ordered)

- [x] **M0 — Repo hygiene.** Fork BOTH `organized-app` and `sws2apps-api`; add
      `upstream` remotes; `self-hosted` branches on each; `main` stays clean.
- [x] **M1 — Client inventory.** Done — see §8.
- [x] **M2 — Backend inventory + data model.** Done — see §8–9.
- [x] **M3 — Run their API self-hosted.** Get `sws2apps-api` running locally
      (Docker) against the **Firebase emulator suite** first — zero code changes,
      proves we understand it. Then swap `storage_utils.ts` for the disk/MinIO
      adapter. Client `.env` pointed at `localhost:8000`. Done — see §11 session 3.
- [x] **M4 — Auth replacement.** Self-hosted identity module (JWT + argon2 +
      one-time email tokens) replaces Firebase Auth in the API; `decodeUserIdToken`
      now verifies our EdDSA JWTs; client `src/services/firebase/` replaced by
      `src/services/auth/`; OAuth popups dropped. TOTP MFA + sessions reused from
      upstream (invites deferred). Done — see §11 session 4.
- [~] **M5 — Firestore leftovers.** Core done — see §11 session 5.
      - [x] `api_settings_v3` → `v3/api/settings.txt` on the disk adapter; last
            Firestore usage removed. Flags + installations were already migrated.
      - [x] safe `register-password` — `POST /users/:id/register-password` behind
            `visitorChecker` + owner check; security-audited clean.
      - [ ] TOTP recovery codes — audited (absent vs §4), **deferred** with a
            proposed design (see §10). Carried forward.
- [x] **M5.5 — Self-hosted onboarding & congregation directory.** Done (server +
      client, E2E-verified) — see §11 session 7. `SELF_HOSTED`/`VITE_SELF_HOSTED`
      flags gate off the external directory: bundled static country list, no
      directory gate on create (neutral defaults the admin completes in a prompted
      InitialSetup editor). Remaining follow-up (not blocking): deeper entry-point
      routing for congregation-less users (setup vs directory search).
      Sever the external **sws2apps directory** dependency and fix first-run onboarding.
      Today `createCongregation` (`congregation_controller.ts`) refuses to create
      any congregation whose name isn't found in `APP_CONGREGATION_API`
      (`collect-api.sws2apps.com`), and the country list comes from
      `APP_COUNTRY_API` — so a fully self-hosted instance **cannot create its own
      congregation** without sws2apps vouching for it, which conflicts with §2
      (no external dependencies). The onboarding UX is also SaaS-shaped: a
      congregation-less/first-run user is dropped into "search the global
      directory → request access", a dead end on an empty instance (no admin to
      approve). Fix: gate the external validation behind a `SELF_HOSTED` flag (or
      drop it) so congregations are created from user-entered details; lead
      congregation-less users to "set up your congregation" instead of directory
      search. Discovered during M4 E2E — see §10.
- [ ] **M6 — Kill the Firebase dependency.** Remove `firebase` /
      `firebase-admin` from both package.json files; both apps build and run with
      no Google packages installed.
- [ ] **M7 — Production deploy.** Hetzner VPS, Docker Compose (api + caddy +
      volume), backups + restore drill, hardening pass (§M8 old list absorbed here).
- [ ] **M8 — Roadmap features.** Begin "awaiting development" items.

Rule: each vertical slice goes fully end-to-end before widening.

---

## 7. Git workflow for staying upstream-mergeable

```bash
# one-time
git clone git@github.com:<you>/organized-app.git
cd organized-app
git remote add upstream https://github.com/sws2apps/organized-app.git
git checkout -b self-hosted

# keep main clean, tracking upstream
git checkout main
git fetch upstream
git merge upstream/main          # fast-forward, no local changes on main
git push origin main

# absorb upstream into our work
git checkout self-hosted
git merge main                   # resolve conflicts where our backend meets theirs
```

Discipline that keeps merges sane:
- **Never** edit `main`. All our work lives on `self-hosted`.
- Prefer **new files/modules** over rewriting their existing files in place.
- Isolate the backend swap behind an interface, so the client calls
  `syncClient.x()` not `firebase.x()`. The implementation behind the interface is
  ours; the call sites stay close to theirs.
- Their sync layer is being actively refactored upstream (as of Feb 2026), so expect
  churn there and keep our seam thin.

---

## 8. Inventory — COMPLETED (M1 + M2)

### Ecosystem map (all repos reviewed)

| Repo | Role | Google dependency |
|---|---|---|
| `organized-app` | Client PWA (React/TS, Vite) | Firebase **Auth only** (client SDK) |
| `sws2apps-api` | Backend (Node/TS, **Express 5**) | Firebase Admin: Auth + **Cloud Storage as datastore** + small Firestore use |
| `firebase-deployment` / `render-deployment` | Their hosting glue (GitHub Actions) | Replaced entirely by our Docker/Caddy setup — ignore |
| `sws2apps-console` | Their admin console | Optional; skip initially |
| `meeting-schedules-parser` | EPUB/JWPUB parser library | No Google — keep as-is |

### Client (`organized-app`) findings

- Firebase = **auth only**. No Firestore in the client. Core surface is just
  `src/services/firebase/` (2 small files: init + auth helpers).
- Login methods: OAuth popups (Google/GitHub/Microsoft/Yahoo) + passwordless
  email link (Firebase custom token paired with API `user-passwordless-login`/`verify`).
- The seam: `apiDefault()` in `src/services/api/common.ts` attaches the Firebase
  ID token + uid to every API request. ~26 files import the auth helpers, almost
  all trivially.
- **All congregation data sync goes to their own REST API** (`api.organized-app.com`,
  `localhost:8000` in dev) via plain fetch in `src/services/api/*.ts`.
- Congregation master key / access code encryption is client-side and
  **not Firebase-coupled**. AUTH_DESIGN.md §0 assumption confirmed.

### Backend (`sws2apps-api`) findings

- Express 5 + TypeScript, API under `src/v3/`. Already uses `express-rate-limit`
  and `express-validator`.
- **Datastore is NOT a database.** Congregation/user data lives as **encrypted text
  files in a Firebase Cloud Storage bucket** (`v3/users/{id}/...`,
  `v3/congregations/{id}/...`, `v3/api/...`), loaded into in-memory `Users` /
  `Congregation` classes at boot.
- File-level at-rest encryption: `crypto-es` AES with server key from
  `SEC_ENCRYPT_KEY` env (`src/v3/services/encryption/encryption.ts`).
- Firestore usage is tiny: `api_settings_v3` collection + flags + installations.
- Auth verification: `middleware/visitor_checker.ts` → `decodeUserIdToken()` →
  Firebase Admin `verifyIdToken`. Custom tokens minted for passwordless flow
  (`auth_controller.ts`).
- Total Firebase-touching code: ~1,100 lines in `src/v3/services/firebase/`
  (mostly `congregations.ts` 566 + `users.ts` 321) + config + auth controller.

### Replacement targets (complete list)

1. **Storage adapter** — `storage_utils.ts` (96 lines, 4 functions:
   upload/get/metadata/delete-ish). Swap GCS bucket → local disk volume (Docker
   volume, host encrypted) or MinIO (S3-compatible, self-hosted) behind the same
   4-function interface. This alone de-Googles the datastore.
2. **Auth layer** — replace Firebase Admin `verifyIdToken` + custom tokens with
   AUTH_DESIGN.md (JWT sessions + TOTP + invite codes). Client
   `src/services/firebase/` replaced by a small auth client speaking to our endpoints.
   OAuth popups (Google/etc.) dropped or replaced with email+password+TOTP.
3. **Firestore leftovers** — `api_settings_v3`, flags, installations → JSON file
   via the storage adapter, or a small Postgres table.
4. **Deployment** — ignore their render/firebase deployment repos; ours is
   Docker Compose + Caddy per §3.

---

## 9. Data model map — COMPLETED (M2)

Not a relational model. It is **encrypted blob files + in-memory classes**:

```
GCS bucket (theirs) → our disk/MinIO volume
  v3/users/{user_id}/<files>          (profile, settings, sessions...)
  v3/congregations/{cong_id}/<files>  (persons, schedules, speakers...)
  v3/api/<files>                      (api settings)
```

**Decision consequence: Postgres is NOT required for parity.** Their design is
file-blob storage. Phase 1 keeps their architecture exactly and swaps only the
bucket for a local volume — smallest possible diff, easiest upstream merges.
Postgres remains an option later for auth/session tables (AUTH_DESIGN.md) and/or
migrating blobs, but is no longer a Phase 1 dependency.

---

## 10. Open questions / decisions log

- [decided] Backend language: **Node + TypeScript** (mirror upstream).
- [decided] Production host: **Hetzner VPS, EU**. Dev/staging: **home VM**.
- [decided] DB: **PostgreSQL**. TLS: **Caddy**. Orchestration: **Docker Compose**.
- [decided] **No Supabase, no new backend.** Their own open-source Express API
  is the backend; we fork it and excise Firebase.
- [decided] **Postgres not required for Phase 1** — file-blob storage adapter
  (disk or MinIO) preserves their architecture. Revisit for auth tables at M4.
- [decided, M4] **No Postgres for auth.** Identity lives on the M3 disk adapter
  behind a 5-function interface (findUidByEmail / getCredentials / createIdentity
  / updateIdentityEmail / deleteIdentity). Swap-to-Postgres later = reimplement
  those 5 functions only. Triggers to revisit: multi-process API, append-only
  audit log requirement, refresh-token families.
- [decided, M4] **No Supabase.** Its bundles (GoTrue, Postgres, realtime, RLS)
  map to needs this codebase doesn't have; ~12 containers of attack surface vs
  our 2; would fork us from upstream. Plain Postgres remains the future option.
- [decided, M4] **register-password deferred** — an unauthenticated version is an
  account-takeover primitive. Ship in M5 with a proper guard.
- [decided, M4] **Refresh tokens not built** — upstream visitorid session +
  silent JWT re-issue via `/session-token` verified in E2E (13 live refreshes).
- [audited, M5] **TOTP recovery codes: absent, implementation DEFERRED.** Audit of
  `mfa_controller.ts` + `User.ts` found ZERO recovery-code support (no generation
  at enrollment, no hashed storage, no login acceptance, no consumed state) vs
  AUTH_DESIGN §4. Deferred (not built this session). Proposed design when built:
  `User.generateRecoveryCodes()` (N one-time codes, hashed, in profile) called
  from `enableMFA()`; `POST /mfa/verify-recovery-code` accepts + consumes a code
  as a TOTP alternative at login. Layerable without changing existing TOTP logic,
  but touches `User.ts` + a new route + the login gate → its own audit when built.
- [accepted-risk, audit M3–M5] **Weak client E2E key-derivation (upstream crypto).**
  The client encrypts with crypto-es `AES.encrypt(data, passphrase)` passing a
  *string* passphrase (`src/services/encryption/index.ts`), so the AES key is
  derived by OpenSSL **EVP_BytesToKey — MD5, a single iteration, 8-byte salt**.
  The user-typed master key / access code is used (via that weak KDF) to *wrap*
  the real random 256-bit data key (`useMasterKeyChange` / `useAccessCodeChange`:
  `encryptData(remoteKey, confirmPassphrase)`). Consequence: anyone holding the
  stored wrapped-key blob — **including us, the operator** — can mount a cheap
  offline brute-force against a weak, human-chosen passphrase (no key stretching)
  to unwrap the data key and decrypt everything under it. **Not patched inline:**
  it is upstream client crypto shared with the entire Organized userbase, and
  changing the KDF changes the ciphertext envelope, so *every* existing encrypted
  field for *every* congregation would become undecryptable without a full
  re-encryption migration — and it would hard-fork us from upstream's on-disk
  format (breaks `git merge upstream`). Correct fix is **upstream**: a versioned
  envelope (kdf-id + per-cong random salt + high iteration count, e.g. PBKDF2/
  argon2) plus a migration, contributed back — tracked for an upstream PR / M8, not
  a unilateral fork. Interim mitigations (already true): the master key is 256-bit
  random when generated, so *private*-scoped fields are safe regardless of KDF;
  advise congregations to set a **high-entropy access code** (not a short word) so
  the *shared* scope isn't dictionary-brute-forceable; server-side at-rest AES
  (`SEC_ENCRYPT_KEY`) is a second layer any *external* (non-operator) attacker must
  also defeat.
- [accepted-risk, audit M3–M5] **Operator can read sync metadata (structural).**
  The §2 "operator must not read congregation data" guarantee holds for encrypted
  **content** (persons, schedules, reports — E2E blobs the server has no keys for)
  but **not for metadata**. The server necessarily sees, in cleartext at use-time:
  user email addresses (auth/login), congregation membership + roles, the
  user↔congregation graph, session/device details (IP, browser, last-seen —
  `visitor_details`), file sizes, and sync/access timing. This is inherent to any
  server that authenticates users by email and routes each user's data to the
  right congregation; eliminating it needs a fundamentally different (blind /
  oblivious / metadata-minimizing) architecture, out of scope for a fork of this
  codebase. **Accepted** as a design property, not a bug. Partial mitigations
  already in place: metadata is AES-encrypted **at rest** (`SEC_ENCRYPT_KEY`), so a
  stolen disk alone doesn't reveal it; third-party geo-IP enrichment is now
  **opt-in / off by default** (session 6) so we don't *add* location metadata via
  external providers; EU residency keeps what metadata exists in-region. Revisit
  only if the threat model changes to "operator is actively hostile" — which
  self-hosting for one's own congregation does not assume.
- [open] Realtime transport: WebSocket vs. polling. Decide at M5/M6.
- [open] Backup strategy and where backups live (must stay EU + encrypted).
- [resolved, session 6] **MFA on pocket sessions.** `pocketVisitorChecker` keys
  off the `visitorid` cookie only and performs no TOTP check, so a pre-MFA regular
  (vip/admin) user's cookie could reach the pocket endpoints, bypassing both the
  JWT and MFA gates. Fixed on the api `self-hosted` branch (commit `5f618fb`):
  `pocketVisitorChecker` now rejects any account whose `role !== 'pocket'`, so the
  cookie-only path is reachable only by genuine pocket accounts. Surfaced by the
  M4 re-audit, closed in the M3–M5 consolidation audit.
- [decided, M5.5] **Congregation directory model for self-hosted: dropped.**
  Upstream gated congregation creation on the external sws2apps directory
  (`APP_CONGREGATION_API`) + sourced countries from `APP_COUNTRY_API`, which broke
  "no external deps" and blocked creating a congregation not in their list. Decision:
  **drop the directory for self-hosted** — behind `SELF_HOSTED`/`VITE_SELF_HOSTED`,
  countries come from a bundled static list and admins enter congregation details
  directly (no external validation; neutral defaults completed in settings). Shipped
  + E2E-verified in session 7. The wider entry-point routing (congregation-less
  users → "set up" vs directory search) remains a non-blocking follow-up.
- [reference] **E2E regression test exists** for the self-hosted onboarding flow:
  `organized-app/cypress/e2e/selfhosted.cy.ts` (`npm run test:e2e`, ports via
  `CYPRESS_BASE_URL`/`CYPRESS_API_URL`; needs a `SELF_HOSTED=true` API +
  `VITE_SELF_HOSTED=true` client). It drives passwordless login → create → master
  key → access code → the InitialSetup prompt. **It already caught a genuine
  production bug** — the token-login CORS regression (api `cc2e375`), which only
  manifested on the single credentialed call in the flow and would likely have
  slipped past a manual click-through. Argues for exercising at least this one
  solid E2E path before each release, especially **before M7's production deploy**
  (real congregation data). Not yet in CI — run it manually before merging
  `self-hosted` → `main`.

---

## 11. Session log

> Newest first. One short entry per working session.

- **(session 7, 2026-07-08)** **M5.5 — self-hosted onboarding**, shipped + verified
  end-to-end in a real browser. Server (api `4a5d5c8`): `SELF_HOSTED=true` serves a
  bundled static ISO country list (`constant/countries.ts`, 267 entries, shape
  matches the client so no client change needed), disables directory search, and
  `createCongregation` skips the external "is this congregation authentic" gate,
  building the congregation from user-entered details with neutral defaults
  (Tue/Sat 00:00 meetings, blank circuit/location the admin fills later). Client
  (`543246d4`): `VITE_SELF_HOSTED` swaps the directory-search autocomplete (which
  gated the submit button on an empty instance) for a plain congregation-name text
  field, and the post-creation `InitialSetup` dialog now clearly prompts for the
  blank fields + embeds the existing `CongregationBasic` editor so they're editable
  right after creation. **CORS regression found + fixed** (`cc2e375`): session-6's
  CORS consolidation (`3429305`) had dropped the header reflection the `cors()`
  package provided, hardcoding `Allow-Headers: Content-Type, Authorization` and so
  silently blocking `token-login` (the one credentialed call — the client also
  sends `appclient`/`appversion`/`language`/`metadata`); now reflects the requested
  headers. **In-browser E2E (Cypress)** drove the whole flow: passwordless login →
  create with the self-hosted name field → 267 static countries → `PUT 200` →
  neutral defaults confirmed on disk (decrypted) → `InitialSetup` prompt + editable
  Number/Circuit/KH-address fields visually confirmed. This closed the earlier
  "missing congregation fields" worry with visual proof, not just logic (§10 had
  already shown the create flow is byte-identical to upstream — never a regression).
  E2E test lives at `cypress/e2e/selfhosted.cy.ts` (needs `SELF_HOSTED=true` API +
  `VITE_SELF_HOSTED=true` client; not wired into CI).
- **(session 6, 2026-07-07)** M3–M5 consolidation **security audit + hardening**.
  Ran an adversarial multi-angle audit over everything built in M3–M5 (de-Googling
  seam: disk storage, self-hosted identity, api_settings, register-password),
  verified each finding in code, then shipped **8 hardening commits** on the api
  `self-hosted` branch (all build-clean, re-audited):
  `5f618fb` object-level authz on `/users/:id` (IDOR — `GET /users/{victim}/2fa/disable`
  disabled *any* user's MFA; `/sessions` leaked device info) + pocket-only pocket
  endpoints; `3429305` CORS — dropped reflect-any-origin-with-credentials (was
  unconditional, all envs), single allowlist handler; `b3ecd05` MFA TOTP replay
  block + `/verify-token` rate limit; `7cb96ee` removed account-enumeration oracle
  + prod sign-in-link leak (fail closed when mail off); `636ae50` fail-fast on
  missing `SEC_ENCRYPT_KEY`/`AUTH_JWT_*` + dropped dev encryption-key fallback
  (lazy `getServerKey()` throws); `cf6a8bb` per-key async lock serializing
  identity/token read-modify-write (fixes the M4-noted lost-update); `b672655`
  cong_role only for own-congregation members; `5f31ac2` third-party geo-IP made
  opt-in (default off) + non-blocking. Re-audit pass clean; two minor observations
  folded in (lazy encryption key; cross-ref comment so the CORS allowlist and the
  narrower sign-in-link allowlist aren't merged). Closed the prior open item "MFA
  on pocket sessions" (§10). **Two findings accepted as risk, NOT patched** and
  now documented in §10: (1) weak client E2E KDF — upstream `crypto-es` string
  passphrase → MD5/1-iter EVP_BytesToKey; fixing it forks the ciphertext format
  and belongs upstream; (2) operator can read sync **metadata** — structural to an
  email-auth + per-congregation-routing sync server. Commits are local (api
  `self-hosted`), not pushed. Docs (this file) updated in the client repo.
- **(session 5, 2026-07-07)** M5 core + docs reconciliation. Migrated
  `api_settings_v3` (minimum client version) off Firestore to
  `v3/api/settings.txt` on the disk adapter — **the last Firestore usage is now
  gone** (only the inert `firebase-admin/app` initializeApp remains, → M6). Flags
  + installations were already on the adapter (M3). Shipped the guarded
  `POST /users/:id/register-password` (behind `visitorChecker` + owner check,
  reusing `updateIdentityPassword`/argon2 `hashPassword`) — the safe form of the
  endpoint deferred in M4; security-audited clean (no account-takeover, JWT+session
  required, blocked pre-MFA, never logs the password). Audited MFA recovery codes
  vs AUTH_DESIGN §4: entirely absent — **deferred** with a proposed design (§10).
  Docs reconciled: AUTH_DESIGN rewritten as v2; both PROJECT.md + AUTH_DESIGN.md
  now versioned in this (client) repo. Commits: client
  `7cdbd9a8`; api `bd531f2` (api_settings) + `8590d6e` (register-password).
  Also this session: proved the M4 "lost congregation fields" report was NOT a
  regression — `createCongregation` still auto-populates address/circuit/meeting
  times from the directory (demoed live with a real congregation); the blank
  fields were on a congregation created via a temporary dev bypass, since reverted.
- **(session 4, 2026-07-06)** M4 auth replacement — completed. Forked
  `sws2apps/organized-app` (client) to github.com/226njnby7k-stack, `self-hosted`
  branch. Server: self-hosted identity module (jose EdDSA JWTs + argon2id +
  one-time email tokens via the M3 disk adapter), all 11 firebase-admin/auth call
  sites removed, API boots with no Firebase emulator. Client: `src/services/auth`
  replaces `src/services/firebase`, OAuth removed, JWT wired into `apiDefault`,
  silent refresh via `/session-token`, Firebase Installations → local UUID.
  Security-audited (F1 origin-header ATO fixed + EdDSA alg pin). Full E2E passed
  in-browser with a real authenticator: passwordless login → JWT → session →
  congregation create/master-key/access-code/sync, MFA enroll+verify, MFA gate on
  email login, session revoke from a 2nd device, silent refresh live.
  Commits (pushed): api `d11dbe6` (auth) + `91c985c` (storage race fix);
  client `fdd2e0ca`.
  Findings:
  - Upstream `verify-email-token` sets `mfaVerified: true` unconditionally (no
    TOTP gate) — so with OAuth removed and email-OTP the primary login, enabled
    TOTP 2FA was NOT enforced on login. **TOTP gate added on our branch**:
    `verify-email-token` now returns the same `MFA_VERIFY` contract `/user-login`
    uses and the client OTP flow routes to the existing verify-MFA screen. This
    divergence from upstream is a candidate to contribute back (the gap likely
    affects their users too whenever email-OTP is used with 2FA on). Documented
    here for future merges.
  - **Disk-adapter concurrency bug (latent since M3):** `saveObject` used a
    `${pid}-${Date.now()}` temp filename; two writes to the same object in one ms
    collided → second `rename` threw ENOENT → 500 → frozen client. M4's write
    concurrency (silent refresh + per-request last-seen + 2 sessions on one
    `sessions.txt`) exposed it. Fixed with a monotonic counter + random suffix
    (commit `91c985c`). Follow-up: concurrent read-modify-write of one file is
    still last-writer-wins (lost-update); fine for single-process, revisit if the
    API is scaled out.
  - Self-hosted congregation-create depends on the external sws2apps directory →
    logged as M5.5 (see §6, §10).
  - Deferred within M4: password-login UI form (endpoint exists, verified via
    API); CORS reflect-any-origin tightening (pre-existing, flagged).
  - AUTH_DESIGN.md rewritten as **v2** (post-M4): §2/§3/§5 marked superseded by
    upstream-reuse; §0/§6/§7/§8/§11 remain live principles; v2 header records what
    was actually built, the real endpoint paths (auth router mounts at `/`), the
    hardening done, and the deferrals. Docs now versioned in the client repo.
- **(session 3, 2026-07-06)** M3 completed. Forked `sws2apps/sws2apps-api` to
  github.com/226njnby7k-stack (fork + local clone created this session; repo lives at
  `sws2apps-api/` in this directory, remotes `origin` + `upstream`, work on
  `self-hosted`). Applied M3_GUIDE.md: new `src/v3/services/storage/disk.ts`,
  replaced `storage_utils.ts`, patched direct bucket call sites, added
  `STORAGE_PATH`, Dockerfile + docker-compose + Caddyfile. Full Step 6 checklist
  verified against the live client (congregation create, person add/edit/delete
  across two browser profiles, restart persistence, delete-path via AP
  applications) — all encrypted blobs on local disk, `firebase-admin/storage`
  usage zero. Security-audited before finalizing: found + fixed a HIGH path
  traversal in the delivered `disk.ts` — `safeResolve` only checked the final
  resolved path stayed under STORAGE_ROOT, so a `..`-laden `person_uid` in a
  `POST /users/:id/backup` body could cross tenant subtrees and overwrite another
  congregation's/user's files (new surface vs GCS, which treated object names as
  opaque literals). Hardened `safeResolve` to reject any `..` path segment
  (semantics-preserving; legit keys are fixed `v3/<kind>/<id>/<file>.txt`
  shapes). Verified: legit keys read/write, attack payload throws, victim file
  never created. Committed (with fix) as `b7b9a85` on `self-hosted`.
  Deviations from guide (upstream drift): (1) SIXTH direct bucket call site
  `Congregation.ts getPersons()` — patched same as `getCongPersons`; (2) upstream
  now reads `metadata.timeCreated` (`User.ts`, `getCongCreatedAt`) — disk adapter
  exposes it from file birthtime; (3) person deletion upstream is now a soft
  delete (files rewritten in place, never removed) — checklist item 6 verified
  via auxiliary-applications delete instead; (4) Dockerfile adapted to
  `node:24-alpine` (engines) + `COPY public` (favicon needed at boot).
  Local-dev notes: Node 24 via nvm, user-local JRE at `~/.local/jre` +
  firebase-tools for emulators (`storage.rules`/`.firebaserc` copied from
  examples, gitignored); client from `organized-app-3_38_0.zip` at
  `client-tmp/` — remove `VITE_APP_MODE="TEST"` from its `.env` or the app runs
  in offline demo mode; client default sync interval locally set to 0.5 min
  (schema.ts) for testing, re-apply on the real client fork at M4 if wanted.
  Next: M4 auth replacement per AUTH_DESIGN.md.
- **(session 2)** M1 + M2 completed against uploaded source (client v3.38.0 +
  full ecosystem). Key discoveries: Firebase is auth-only in the client; backend
  datastore is encrypted blobs in Cloud Storage, not Firestore; their Express
  API becomes our backend. Milestones rewritten. Next: M3.
- **(session 1)** Founding design agreed. Stack, infra, milestones, git workflow set.

---

## 12. Known guide errata / gotchas (for future sessions)

- **M4_GUIDE endpoint paths were wrong**: the auth router mounts at `/`, so the
  real paths are `/api/v3/password-login`, `/api/v3/token-login`,
  `/api/v3/session-token` — NOT `/api/v3/auth/...`.
- **jose v6** removed the `KeyLike` type → use the global `CryptoKey`.
- **`deleteFileFromStorage` does not handle type `'api'`** — it falls through to
  prefix `v3/` (i.e. would delete ALL data). NEVER call it for api-type paths; the
  identity/settings code calls the disk adapter (`deleteObjectsByPrefix`) directly.
  Keep it that way.
