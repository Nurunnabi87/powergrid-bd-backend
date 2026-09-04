# PowerGrid BD ⚡

> A load-shedding and power-outage management API for a national electricity
> distribution utility — from the distribution hierarchy down to the meter,
> covering scheduled load shedding, unexpected outages, technician dispatch,
> restoration tracking and bKash bill payment.

## 🔗 Links

| | |
|---|---|
| **Live API** | `<add your Vercel URL>` |
| **Swagger docs** | `<live-url>/api/docs` |
| **OpenAPI JSON** | `<live-url>/api/docs/openapi.json` |
| **Postman collection** | [`PowerGrid-BD.postman_collection.json`](./PowerGrid-BD.postman_collection.json) |

## 🔑 Demo Credentials

```
ADMIN       admin@powergrid.bd      Admin@1234
TECHNICIAN  tech1@powergrid.bd      Tech@1234
CUSTOMER    customer1@powergrid.bd  Customer@1234
```

## 🛠️ Tech Stack

| Category | Technology |
|---|---|
| Runtime & Framework | Node.js 24, TypeScript 6 (strict), Express 5 |
| Database & ORM | PostgreSQL, **Prisma 7** with the `@prisma/adapter-pg` driver adapter |
| Validation | Zod 4 (body, params and query) |
| Auth | JWT access + refresh tokens, bcrypt, Google (GCP) ID-token login |
| Caching | Redis (`ioredis`) — optional, degrades to direct queries |
| Security | helmet, CORS allowlist, `express-rate-limit` (+ Redis store) |
| Payments | **bKash Tokenized Checkout** |
| File storage | Multer (memory) + Cloudinary |
| Email | Nodemailer (optional; logs to console when unset) |
| Docs | OpenAPI 3.0.3 + Swagger UI, generated Postman collection |
| Tooling | ESLint 9 flat config, Prettier, tsx |
| Deployment | Vercel serverless |

## 🏛️ Domain Model

The schema mirrors how a real distribution network is organised:

```
DistributionZone → Substation → Feeder → Area → Connection (customer meter)
                                   │       │
                                   │       └── Outage ── OutageAssignment ── Technician
                                   └── LoadSheddingSchedule
```

Every area carries a **priority tier**. `CRITICAL` areas — hospitals, water
pumping stations — are structurally exempt from load shedding, which is what
makes automatic schedule generation safe to run.

## 📊 Outage Lifecycle

```
                                  ┌──────────────────────────┐
                                  ▼                          │
REPORTED ──► ACKNOWLEDGED ──► ASSIGNED ──► IN_PROGRESS ──► RESOLVED ──► CLOSED
    │              │              │             │
    └──────────────┴──────────────┴─────────────┴──────────► CANCELLED
```

The graph lives in a single `assertTransition()` helper, so an illegal jump
(`ACKNOWLEDGED → RESOLVED`, say) returns a clear `400` instead of silently
corrupting the record.

## ✨ Features by Role

### Customer
- Register / log in with email+password or a Google ID token
- View the load-shedding schedule for their own areas (Redis-cached)
- Report unexpected outages, with an optional photo uploaded to Cloudinary
- Track their reports through to restoration
- View bills and outstanding balance; pay via bKash
- In-app notifications for schedules, restoration and payments

### Technician
- See only the jobs assigned to them
- Accept a job and move it `ASSIGNED → IN_PROGRESS → RESOLVED`
- Restore power, which records downtime and notifies the whole affected area
- Cannot touch outages they are not assigned to

### Admin
- Full CRUD over zones, substations, feeders, areas and connections
- Create load-shedding slots manually, or auto-generate a day for a whole zone
- Acknowledge outages and dispatch technicians
- Generate monthly bills and apply overdue late fees
- Manage users (roles, bans), read the audit log, view analytics

## 🧠 Notable Backend Work

**Automatic schedule generation.** Each feeder inherits the most protective
priority tier among the areas it serves. Feeders touching a `CRITICAL` area
are excluded outright; the rest are shed `LOW → NORMAL → HIGH` in consecutive
slots until the requested MW deficit is covered. Everything — slots, customer
notifications, the audit entry — is written in one transaction.

**Conflict detection.** Overlap uses the standard interval test
(`start < other.end AND end > other.start`), so an adjacent 12:00–14:00 slot is
allowed while an overlapping 11:00–13:00 slot is rejected with `409`. The check
is repeated *inside* the generation transaction so a concurrent manual create
cannot slip through the gap between planning and writing.

**Race-safe technician dispatch.** Assignment claims the outage with a
conditional update that only matches while it is still `REPORTED` or
`ACKNOWLEDGED`:

```ts
const claimed = await tx.outage.updateMany({
  where: { id, status: { in: ['REPORTED', 'ACKNOWLEDGED'] } },
  data:  { status: 'ASSIGNED' },
});
if (claimed.count === 0) throw new AppError(409, 'Already assigned');
```

That is a compare-and-swap: if two admins dispatch at the same instant, the
loser sees `count === 0`. Verified with four parallel requests — one `200`,
three rejections, exactly one assignment row, `activeJobCount === 1`.

**Payment verification without a webhook.** bKash Tokenized Checkout has no
webhook, so the server is the only party that can confirm a charge. After the
payer returns to `/payments/bkash/callback`, the API calls bKash's *Execute
Payment* and falls back to *Query Payment Status*, and settles the bill **only**
on a verified `transactionStatus: "Completed"`. A forged success callback on an
unpaid session is rejected and the bill returns to `UNPAID`. `fulfill()` is
idempotent, so the callback and the manual verify endpoint can both run it.

## 🚀 Getting Started

```bash
# 1. install
npm install

# 2. configure
cp .env.example .env      # fill in DATABASE_URL and DIRECT_URL

# 3. database
npx prisma generate       # Prisma 7 no longer generates implicitly
npx prisma migrate dev
npx prisma db seed        # Prisma 7 no longer seeds automatically

# 4. run
npm run dev               # http://localhost:5000
```

Open `http://localhost:5000/api/docs` for Swagger, or import the Postman
collection and hit **Send** on anything — a pre-request script logs in as all
three roles and caches the tokens for you.

> **Windows note:** this project's folder name contains an `&`, which `cmd.exe`
> treats as a command separator and which breaks every `npm`/`npx` shim. A
> committed `.npmrc` sets `script-shell=bash` to work around it, and the Prisma
> seed command invokes `tsx`'s entry file through `node` directly for the same
> reason.

## 📡 API Endpoints (75 operations, `/api/v1`)

### Auth
| Method | Endpoint | Access |
|---|---|---|
| POST | `/auth/register` | Public |
| POST | `/auth/login` | Public |
| POST | `/auth/google` | Public |
| POST | `/auth/refresh-token` | Public |
| POST | `/auth/logout` | Public |
| POST | `/auth/change-password` | Authenticated |

### User
| Method | Endpoint | Access |
|---|---|---|
| GET | `/users/me` | Authenticated |
| PATCH | `/users/me` | Authenticated |
| PATCH | `/users/me/avatar` | Authenticated |
| GET | `/users/me/connections` | Authenticated |

### Distribution hierarchy
`zones`, `substations`, `feeders`, `areas`, `connections` each expose the same
five routes — reads for any signed-in user, writes for `ADMIN`:

| Method | Endpoint | Notes |
|---|---|---|
| GET | `/{resource}` | `?page&limit&search&sortBy&sortOrder` + per-resource filters |
| POST | `/{resource}` | ADMIN |
| GET | `/{resource}/:id` | Nested children included |
| PATCH | `/{resource}/:id` | ADMIN |
| DELETE | `/{resource}/:id` | ADMIN, soft delete; `409` while children remain |

### Load-shedding schedules
| Method | Endpoint | Access |
|---|---|---|
| GET | `/schedules` | Authenticated, filter by feeder/area/zone/date/status |
| POST | `/schedules` | ADMIN, conflict-checked |
| POST | `/schedules/generate` | ADMIN, priority-based auto-generation |
| GET | `/schedules/my` | CUSTOMER, Redis-cached |
| GET | `/schedules/:id` | Authenticated |
| PATCH | `/schedules/:id/status` | ADMIN |
| DELETE | `/schedules/:id` | ADMIN |

### Outages
| Method | Endpoint | Access |
|---|---|---|
| POST | `/outages/report` | CUSTOMER, optional photo |
| GET | `/outages` | ADMIN, TECHNICIAN |
| GET | `/outages/my-reports` | CUSTOMER |
| GET | `/outages/my-assignments` | TECHNICIAN |
| GET | `/outages/:id` | Authenticated (ownership enforced) |
| PATCH | `/outages/:id/acknowledge` | ADMIN |
| POST | `/outages/:id/assign` | ADMIN |
| PATCH | `/outages/:id/status` | ADMIN, TECHNICIAN |
| POST | `/outages/:id/restore` | ADMIN, TECHNICIAN |
| DELETE | `/outages/:id` | ADMIN |

### Bills & payments
| Method | Endpoint | Access |
|---|---|---|
| POST | `/bills/generate` | ADMIN |
| POST | `/bills/apply-overdue` | ADMIN |
| GET | `/bills` | ADMIN |
| GET | `/bills/my` | CUSTOMER |
| GET | `/bills/:id` | Authenticated (ownership enforced) |
| POST | `/payments/initiate` | CUSTOMER |
| GET | `/payments/bkash/callback` | Public (bKash redirect) |
| POST | `/payments/:id/verify` | CUSTOMER, ADMIN |
| GET | `/payments/my` | CUSTOMER |
| GET | `/payments` | ADMIN |
| GET | `/payments/:id` | Authenticated |

### Notifications, admin & analytics
| Method | Endpoint | Access |
|---|---|---|
| GET | `/notifications/my` | Authenticated |
| PATCH | `/notifications/read-all` | Authenticated |
| PATCH | `/notifications/:id/read` | Authenticated |
| GET | `/admin/users` | ADMIN |
| PATCH | `/admin/users/:id/role` | ADMIN |
| PATCH | `/admin/users/:id/status` | ADMIN |
| GET | `/admin/dashboard-stats` | ADMIN, cached |
| GET | `/admin/audit-logs` | ADMIN |
| POST | `/admin/cache/clear` | ADMIN |
| GET | `/analytics/outages` | ADMIN |
| GET | `/analytics/load-shedding` | ADMIN |
| GET | `/analytics/technicians` | ADMIN |

## 📦 Response Format

```jsonc
// success
{
  "success": true,
  "message": "Outages retrieved successfully",
  "meta": { "page": 1, "limit": 10, "total": 42, "totalPages": 5 },
  "data": []
}

// error
{
  "success": false,
  "message": "Validation failed",
  "errors": [{ "field": "email", "message": "Invalid email address" }]
}
```

## 💳 Testing Payments

1. Log in as a customer and `GET /bills/my` to pick an unpaid bill.
2. `POST /payments/initiate` with `{ "billId": "<id>" }` → returns `bkashURL`.
3. Open that URL in a browser and pay with the bKash sandbox wallet:

   | Field | Value |
   |---|---|
   | Wallet (success) | `01770618575` |
   | Wallet (insufficient balance) | `01823074817` |
   | OTP | `123456` |
   | PIN | `12121` |

4. bKash redirects to `/payments/bkash/callback`, which executes and verifies
   the payment and marks the bill `PAID`.
5. `POST /payments/:id/verify` re-runs the same verified path — it returns
   "already verified" rather than charging twice.

To watch the callback as JSON instead of a redirect, append `&raw=true`.

## 🔒 Security

- Passwords hashed with bcrypt (12 rounds) and never selected in any query
- Refresh tokens stored as SHA-256 digests, revocable on logout, password
  change or ban
- Role re-read from the database on every request, so bans apply instantly
- `helmet`, an explicit CORS origin allowlist, and rate limiting (300/15 min
  globally, 10/15 min on credential routes keyed by IP+email)
- `sortBy` validated against a per-module whitelist so no arbitrary column can
  reach Prisma's `orderBy`
- Soft deletes everywhere; audit log for every role change, status transition,
  dispatch and payment

## 🗄️ Database

15 tables with foreign keys, composite unique constraints
(`(connectionId, billingPeriod)` for re-runnable billing,
`(outageId, technicianId)` against duplicate dispatch) and indexes backing
every filtered or sorted list endpoint. Multi-record operations —
generation, dispatch, restoration, payment settlement — run inside
`prisma.$transaction`.

## 📂 Project Structure

```
src/
├── app.ts                  # helmet, CORS, rate limit, /api/v1, error handling
├── server.ts               # listen + graceful shutdown
├── config/                 # typed env loader
├── errors/AppError.ts
├── middlewares/            # auth, validateRequest, globalErrorHandler, upload, rateLimiter
├── shared/                 # prisma, jwt, redis, bkash, cloudinary, mailer, auditLog, queryBuilder
├── docs/                   # OpenAPI spec + Swagger UI
├── generated/prisma/       # Prisma 7 client (gitignored)
└── modules/
    └── <name>/<name>.{routes,controller,service,validation}.ts
api/index.ts                # Vercel serverless entry
prisma.config.ts            # Prisma 7 config
prisma/{schema.prisma,migrations,seed.ts}
scripts/build-postman.ts
```

Request flow: **routes → validation → auth → controller → service → Prisma**.
Controllers stay thin; all business rules live in services.

## 📤 Submission

```
Project Name    : PowerGrid BD - Load Shedding & Power Outage Management System
Backend Repo    : <repo url>
Live API        : <vercel url>
API Docs        : <vercel url>/api/docs
Demo Video      : <video url>
Admin Email     : admin@powergrid.bd
Admin Password  : Admin@1234
```
