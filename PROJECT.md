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
  congregation data.
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
- [ ] **M5.5 — Self-hosted onboarding & congregation directory.** Sever the
      external **sws2apps directory** dependency and fix first-run onboarding.
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
- [open] Realtime transport: WebSocket vs. polling. Decide at M5/M6.
- [open] Backup strategy and where backups live (must stay EU + encrypted).
- [open] **MFA on pocket sessions.** `pocketVisitorChecker` keys off the
  `visitorid` cookie only and performs no TOTP check (pre-existing upstream; not
  changed by M4). A pre-MFA regular user's cookie would pass it. Low priority /
  pocket accounts are a distinct type, but worth revisiting when hardening auth.
  Surfaced by the M4 re-audit.
- [open] **Congregation directory model for self-hosted (→ M5.5).** Upstream
  gates congregation creation on the external sws2apps directory
  (`APP_CONGREGATION_API`) and sources countries from `APP_COUNTRY_API`. For a
  self-hosted instance this both breaks the "no external deps" goal and blocks
  creating a congregation not in their list. Decide: keep a (self-hosted) global
  directory concept, or drop it and let admins enter congregation details
  directly? Leaning drop-it for self-hosted (invite gating already controls who
  can register). Found during M4 E2E.

---

## 11. Session log

> Newest first. One short entry per working session.

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
  now versioned in this (client) repo. Commits (Mister, no email): client
  `023bceff`; api `fbb503b` (api_settings) + `43fb5dc` (register-password).
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
  Commits (pushed): api `152e970` (auth) + `90595a7` (storage race fix);
  client `643058cf`.
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
    (commit `90595a7`). Follow-up: concurrent read-modify-write of one file is
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
  never created. Committed (with fix) as `54a78d6` on `self-hosted`.
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
