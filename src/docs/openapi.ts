import config from '../config';

/** Reusable response bodies so every path stays terse. */
const ok = (description: string) => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/SuccessResponse' },
    },
  },
});

const err = (description: string) => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ErrorResponse' },
    },
  },
});

const COMMON_ERRORS = {
  400: err('Validation failed or invalid state transition'),
  401: err('Missing, invalid or expired token'),
  403: err('Authenticated but not allowed for this role'),
  404: err('Resource not found'),
};

const uuidParam = (name: string, description: string) => ({
  name,
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
  description,
});

const listParams = (extra: Record<string, string> = {}) => [
  { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
  {
    name: 'limit',
    in: 'query',
    schema: { type: 'integer', default: 10, maximum: 100 },
  },
  { name: 'sortBy', in: 'query', schema: { type: 'string' } },
  {
    name: 'sortOrder',
    in: 'query',
    schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
  },
  { name: 'search', in: 'query', schema: { type: 'string' } },
  ...Object.entries(extra).map(([name, description]) => ({
    name,
    in: 'query',
    schema: { type: 'string' },
    description,
  })),
];

/** Builds the five standard CRUD paths for a hierarchy resource. */
const crudPaths = (
  resource: string,
  tag: string,
  singular: string,
  filters: Record<string, string> = {}
) => ({
  [`/${resource}`]: {
    get: {
      tags: [tag],
      summary: `List ${resource} (paginated, filterable, searchable)`,
      security: [{ bearerAuth: [] }],
      parameters: listParams(filters),
      responses: { 200: ok(`Paginated ${resource}`), ...COMMON_ERRORS },
    },
    post: {
      tags: [tag],
      summary: `Create a ${singular} (ADMIN)`,
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: `#/components/schemas/${tag}Create` },
          },
        },
      },
      responses: {
        201: ok(`${singular} created`),
        409: err('Duplicate code'),
        ...COMMON_ERRORS,
      },
    },
  },
  [`/${resource}/{id}`]: {
    get: {
      tags: [tag],
      summary: `Get one ${singular}`,
      security: [{ bearerAuth: [] }],
      parameters: [uuidParam('id', `${singular} id`)],
      responses: { 200: ok(`${singular} detail`), ...COMMON_ERRORS },
    },
    patch: {
      tags: [tag],
      summary: `Update a ${singular} (ADMIN)`,
      security: [{ bearerAuth: [] }],
      parameters: [uuidParam('id', `${singular} id`)],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { type: 'object' } } },
      },
      responses: { 200: ok(`${singular} updated`), ...COMMON_ERRORS },
    },
    delete: {
      tags: [tag],
      summary: `Soft-delete a ${singular} (ADMIN)`,
      description:
        'Sets isDeleted = true. Refused with 409 while active children still reference it.',
      security: [{ bearerAuth: [] }],
      parameters: [uuidParam('id', `${singular} id`)],
      responses: {
        200: ok(`${singular} deleted`),
        409: err('Active children still reference this record'),
        ...COMMON_ERRORS,
      },
    },
  },
});

export const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'PowerGrid BD API',
    version: '1.0.0',
    description: `
REST API for a national **load-shedding and power-outage management system**.

### Roles
| Role | Can do |
|---|---|
| \`CUSTOMER\` | Report outages, view their area's load-shedding schedule, pay electricity bills |
| \`TECHNICIAN\` | See assigned jobs, move them through the repair lifecycle, restore power |
| \`ADMIN\` | Manage the distribution hierarchy, generate schedules, dispatch technicians, view analytics and audit logs |

### Authentication
Send \`Authorization: Bearer <accessToken>\` from \`POST /auth/login\`.
The role is re-read from the database on every request, so a ban or a
demotion takes effect immediately rather than at token expiry.

### Payments
bKash Tokenized Checkout. bKash has **no webhook** - after the payer is
redirected back to \`/payments/bkash/callback\`, the server calls bKash's
Execute Payment and Query Payment Status APIs to confirm the charge.
A payment is only ever marked COMPLETED on a verified
\`transactionStatus: "Completed"\` from bKash.

### Demo credentials
\`admin@powergrid.bd / Admin@1234\` · \`tech1@powergrid.bd / Tech@1234\` ·
\`customer1@powergrid.bd / Customer@1234\`
`.trim(),
  },
  servers: [
    { url: `${config.api_base_url}/api/v1`, description: 'Current environment' },
  ],
  tags: [
    { name: 'Auth', description: 'Registration, login, Google login, tokens' },
    { name: 'User', description: 'Profile and own connections' },
    { name: 'Zone', description: 'Distribution zones' },
    { name: 'Substation', description: 'Substations' },
    { name: 'Feeder', description: 'Feeders' },
    { name: 'Area', description: 'Areas and priority tiers' },
    { name: 'Connection', description: 'Customer meters' },
    { name: 'Schedule', description: 'Load-shedding schedules' },
    { name: 'Outage', description: 'Outage lifecycle and technician dispatch' },
    { name: 'Bill', description: 'Electricity billing' },
    { name: 'Payment', description: 'bKash payments' },
    { name: 'Notification', description: 'In-app notifications' },
    { name: 'Admin', description: 'User management, dashboard, audit logs' },
    { name: 'Analytics', description: 'Historical reporting' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      SuccessResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string', example: 'Operation successful' },
          meta: {
            type: 'object',
            nullable: true,
            properties: {
              page: { type: 'integer', example: 1 },
              limit: { type: 'integer', example: 10 },
              total: { type: 'integer', example: 42 },
              totalPages: { type: 'integer', example: 5 },
            },
          },
          data: { type: 'object' },
        },
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          message: { type: 'string', example: 'Validation failed' },
          errors: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                field: { type: 'string', example: 'email' },
                message: { type: 'string', example: 'Invalid email address' },
              },
            },
          },
        },
      },
      ZoneCreate: {
        type: 'object',
        required: ['name', 'code', 'city'],
        properties: {
          name: { type: 'string', example: 'Dhaka North' },
          code: { type: 'string', example: 'DHK-N' },
          city: { type: 'string', example: 'Dhaka' },
          district: { type: 'string', example: 'Dhaka' },
        },
      },
      SubstationCreate: {
        type: 'object',
        required: ['name', 'code', 'zoneId', 'capacityMva'],
        properties: {
          name: { type: 'string', example: 'Mirpur 33/11kV' },
          code: { type: 'string', example: 'SS-MIR-01' },
          zoneId: { type: 'string', format: 'uuid' },
          capacityMva: { type: 'number', example: 50 },
          status: {
            type: 'string',
            enum: ['OPERATIONAL', 'MAINTENANCE', 'OFFLINE'],
          },
        },
      },
      FeederCreate: {
        type: 'object',
        required: ['name', 'code', 'substationId', 'voltageLevel', 'loadKw'],
        properties: {
          name: { type: 'string', example: 'Mirpur Feeder 1' },
          code: { type: 'string', example: 'FD-MIR-01' },
          substationId: { type: 'string', format: 'uuid' },
          voltageLevel: { type: 'string', example: '11kV' },
          loadKw: { type: 'number', example: 1200 },
        },
      },
      AreaCreate: {
        type: 'object',
        required: ['name', 'code', 'feederId'],
        properties: {
          name: { type: 'string', example: 'Mirpur 10' },
          code: { type: 'string', example: 'AR-MIR-10' },
          feederId: { type: 'string', format: 'uuid' },
          population: { type: 'integer', example: 45000 },
          priorityTier: {
            type: 'string',
            enum: ['CRITICAL', 'HIGH', 'NORMAL', 'LOW'],
            description:
              'CRITICAL areas (hospitals, water pumping) are never load-shed.',
          },
        },
      },
      ConnectionCreate: {
        type: 'object',
        required: ['meterNo', 'customerId', 'areaId'],
        properties: {
          meterNo: { type: 'string', example: 'MTR-100001' },
          customerId: { type: 'string', format: 'uuid' },
          areaId: { type: 'string', format: 'uuid' },
          connectionType: {
            type: 'string',
            enum: ['RESIDENTIAL', 'COMMERCIAL', 'INDUSTRIAL'],
          },
          tariffRate: { type: 'number', example: 7.5 },
        },
      },
    },
  },
  paths: {
    // ---------- AUTH ----------
    '/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Register a new customer account',
        description:
          'Always creates a CUSTOMER. Elevating a role is an admin-only operation.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'email', 'password'],
                properties: {
                  name: { type: 'string', example: 'Ayesha Rahman' },
                  email: { type: 'string', example: 'ayesha@example.com' },
                  password: {
                    type: 'string',
                    example: 'Passw0rd123',
                    description: 'Min 8 chars, at least one letter and one number',
                  },
                  phone: { type: 'string', example: '01712345678' },
                  address: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          201: ok('Account created, tokens returned'),
          400: err('Validation failed'),
          409: err('Email already registered'),
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Log in with email and password',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', example: 'admin@powergrid.bd' },
                  password: { type: 'string', example: 'Admin@1234' },
                },
              },
            },
          },
        },
        responses: {
          200: ok('Access and refresh tokens'),
          401: err('Invalid email or password'),
          403: err('Account banned'),
        },
      },
    },
    '/auth/google': {
      post: {
        tags: ['Auth'],
        summary: 'Log in with a Google (GCP) ID token',
        description:
          'The ID token is verified against GOOGLE_CLIENT_ID. An existing password account with the same email is linked rather than duplicated.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['idToken'],
                properties: { idToken: { type: 'string' } },
              },
            },
          },
        },
        responses: { 200: ok('Logged in'), 401: err('Invalid Google ID token') },
      },
    },
    '/auth/refresh-token': {
      post: {
        tags: ['Auth'],
        summary: 'Exchange a refresh token for a new access token',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['refreshToken'],
                properties: { refreshToken: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          200: ok('New access token'),
          401: err('Refresh token invalid or revoked'),
        },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Revoke a refresh token',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['refreshToken'],
                properties: { refreshToken: { type: 'string' } },
              },
            },
          },
        },
        responses: { 200: ok('Token revoked') },
      },
    },
    '/auth/change-password': {
      post: {
        tags: ['Auth'],
        summary: 'Change your password (revokes all sessions)',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['oldPassword', 'newPassword'],
                properties: {
                  oldPassword: { type: 'string' },
                  newPassword: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { 200: ok('Password changed'), ...COMMON_ERRORS },
      },
    },

    // ---------- USER ----------
    '/users/me': {
      get: {
        tags: ['User'],
        summary: 'Get my profile',
        security: [{ bearerAuth: [] }],
        responses: { 200: ok('Profile'), ...COMMON_ERRORS },
      },
      patch: {
        tags: ['User'],
        summary: 'Update my name, phone or address',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  phone: { type: 'string', example: '01712345678' },
                  address: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { 200: ok('Profile updated'), ...COMMON_ERRORS },
      },
    },
    '/users/me/avatar': {
      patch: {
        tags: ['User'],
        summary: 'Upload a profile picture (multipart/form-data)',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: { avatar: { type: 'string', format: 'binary' } },
              },
            },
          },
        },
        responses: {
          200: ok('Avatar updated'),
          503: err('Cloudinary not configured'),
          ...COMMON_ERRORS,
        },
      },
    },
    '/users/me/connections': {
      get: {
        tags: ['User'],
        summary: 'List my electricity connections',
        security: [{ bearerAuth: [] }],
        responses: { 200: ok('Connections'), ...COMMON_ERRORS },
      },
    },

    // ---------- HIERARCHY CRUD ----------
    ...crudPaths('zones', 'Zone', 'zone', { city: 'Filter by city' }),
    ...crudPaths('substations', 'Substation', 'substation', {
      zoneId: 'Filter by zone',
      status: 'OPERATIONAL | MAINTENANCE | OFFLINE',
    }),
    ...crudPaths('feeders', 'Feeder', 'feeder', {
      substationId: 'Filter by substation',
      zoneId: 'Filter by zone (two levels up)',
    }),
    ...crudPaths('areas', 'Area', 'area', {
      feederId: 'Filter by feeder',
      zoneId: 'Filter by zone',
      priorityTier: 'CRITICAL | HIGH | NORMAL | LOW',
    }),
    ...crudPaths('connections', 'Connection', 'connection', {
      areaId: 'Filter by area',
      customerId: 'Filter by customer',
      connectionType: 'RESIDENTIAL | COMMERCIAL | INDUSTRIAL',
      status: 'ACTIVE | SUSPENDED | DISCONNECTED',
    }),

    // ---------- SCHEDULES ----------
    '/schedules': {
      get: {
        tags: ['Schedule'],
        summary: 'List load-shedding schedules',
        security: [{ bearerAuth: [] }],
        parameters: listParams({
          feederId: 'Filter by feeder',
          areaId: 'Filter by area',
          zoneId: 'Filter by zone',
          date: 'YYYY-MM-DD',
          status: 'PLANNED | ACTIVE | COMPLETED | CANCELLED',
        }),
        responses: { 200: ok('Paginated schedules'), ...COMMON_ERRORS },
      },
      post: {
        tags: ['Schedule'],
        summary: 'Create a schedule manually (ADMIN)',
        description:
          'Rejected with 409 when the window overlaps an existing PLANNED or ACTIVE slot on the same feeder.',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['feederId', 'date', 'startTime', 'endTime'],
                properties: {
                  feederId: { type: 'string', format: 'uuid' },
                  date: { type: 'string', example: '2026-09-10' },
                  startTime: { type: 'string', example: '2026-09-10T10:00:00Z' },
                  endTime: { type: 'string', example: '2026-09-10T12:00:00Z' },
                  reason: { type: 'string', example: 'Peak demand' },
                },
              },
            },
          },
        },
        responses: {
          201: ok('Schedule created'),
          409: err('Overlaps an existing schedule on this feeder'),
          ...COMMON_ERRORS,
        },
      },
    },
    '/schedules/generate': {
      post: {
        tags: ['Schedule'],
        summary: 'Auto-generate a day of load shedding for a zone (ADMIN)',
        description: `
Ranks every feeder by the worst priority tier among the areas it serves.
Feeders supplying a **CRITICAL** area are excluded entirely; the rest are
shed LOW -> NORMAL -> HIGH in consecutive slots until the requested
deficit is covered. Conflicts are re-checked inside the transaction.
`.trim(),
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['zoneId', 'date', 'totalDeficitMw'],
                properties: {
                  zoneId: { type: 'string', format: 'uuid' },
                  date: { type: 'string', example: '2026-09-12' },
                  totalDeficitMw: { type: 'number', example: 2 },
                  slotHours: { type: 'integer', example: 2 },
                  startHour: { type: 'integer', example: 10 },
                },
              },
            },
          },
        },
        responses: {
          201: ok('Slots generated and customers notified'),
          409: err('An overlapping schedule blocks generation'),
          ...COMMON_ERRORS,
        },
      },
    },
    '/schedules/my': {
      get: {
        tags: ['Schedule'],
        summary: 'My upcoming load shedding (CUSTOMER, Redis-cached)',
        security: [{ bearerAuth: [] }],
        responses: { 200: ok('Upcoming slots'), ...COMMON_ERRORS },
      },
    },
    '/schedules/{id}': {
      get: {
        tags: ['Schedule'],
        summary: 'Get one schedule',
        security: [{ bearerAuth: [] }],
        parameters: [uuidParam('id', 'Schedule id')],
        responses: { 200: ok('Schedule'), ...COMMON_ERRORS },
      },
      delete: {
        tags: ['Schedule'],
        summary: 'Soft-delete a schedule (ADMIN)',
        security: [{ bearerAuth: [] }],
        parameters: [uuidParam('id', 'Schedule id')],
        responses: {
          200: ok('Deleted'),
          409: err('An ACTIVE schedule must be cancelled or completed first'),
          ...COMMON_ERRORS,
        },
      },
    },
    '/schedules/{id}/status': {
      patch: {
        tags: ['Schedule'],
        summary: 'Move a schedule through its lifecycle (ADMIN)',
        description: 'PLANNED -> ACTIVE -> COMPLETED, or CANCELLED from either.',
        security: [{ bearerAuth: [] }],
        parameters: [uuidParam('id', 'Schedule id')],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['status'],
                properties: {
                  status: {
                    type: 'string',
                    enum: ['PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED'],
                  },
                },
              },
            },
          },
        },
        responses: {
          200: ok('Status updated'),
          ...COMMON_ERRORS,
          400: err('Illegal transition'),
        },
      },
    },

    // ---------- OUTAGES ----------
    '/outages/report': {
      post: {
        tags: ['Outage'],
        summary: 'Report an unexpected outage (CUSTOMER)',
        description:
          'Accepts JSON, or multipart/form-data with an optional "photo" field uploaded to Cloudinary.',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['areaId', 'title', 'description'],
                properties: {
                  areaId: { type: 'string', format: 'uuid' },
                  title: { type: 'string', example: 'Transformer sparking' },
                  description: { type: 'string' },
                  severity: {
                    type: 'string',
                    enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
                  },
                },
              },
            },
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  areaId: { type: 'string', format: 'uuid' },
                  title: { type: 'string' },
                  description: { type: 'string' },
                  severity: { type: 'string' },
                  photo: { type: 'string', format: 'binary' },
                },
              },
            },
          },
        },
        responses: { 201: ok('Outage reported'), ...COMMON_ERRORS },
      },
    },
    '/outages': {
      get: {
        tags: ['Outage'],
        summary: 'List outages (ADMIN, TECHNICIAN)',
        security: [{ bearerAuth: [] }],
        parameters: listParams({
          status: 'REPORTED | ACKNOWLEDGED | ASSIGNED | IN_PROGRESS | RESOLVED | CLOSED | CANCELLED',
          severity: 'LOW | MEDIUM | HIGH | CRITICAL',
          type: 'SCHEDULED | UNEXPECTED',
          areaId: 'Filter by area',
          zoneId: 'Filter by zone',
        }),
        responses: { 200: ok('Paginated outages'), ...COMMON_ERRORS },
      },
    },
    '/outages/my-reports': {
      get: {
        tags: ['Outage'],
        summary: 'Outages I reported (CUSTOMER)',
        security: [{ bearerAuth: [] }],
        parameters: listParams(),
        responses: { 200: ok('My reports'), ...COMMON_ERRORS },
      },
    },
    '/outages/my-assignments': {
      get: {
        tags: ['Outage'],
        summary: 'Outages assigned to me (TECHNICIAN)',
        security: [{ bearerAuth: [] }],
        parameters: listParams(),
        responses: { 200: ok('My jobs'), ...COMMON_ERRORS },
      },
    },
    '/outages/{id}': {
      get: {
        tags: ['Outage'],
        summary: 'Get one outage',
        security: [{ bearerAuth: [] }],
        parameters: [uuidParam('id', 'Outage id')],
        responses: { 200: ok('Outage detail'), ...COMMON_ERRORS },
      },
      delete: {
        tags: ['Outage'],
        summary: 'Soft-delete an outage (ADMIN)',
        security: [{ bearerAuth: [] }],
        parameters: [uuidParam('id', 'Outage id')],
        responses: { 200: ok('Deleted'), ...COMMON_ERRORS },
      },
    },
    '/outages/{id}/acknowledge': {
      patch: {
        tags: ['Outage'],
        summary: 'Acknowledge a reported outage (ADMIN)',
        security: [{ bearerAuth: [] }],
        parameters: [uuidParam('id', 'Outage id')],
        responses: { 200: ok('Acknowledged'), ...COMMON_ERRORS },
      },
    },
    '/outages/{id}/assign': {
      post: {
        tags: ['Outage'],
        summary: 'Dispatch a technician (ADMIN)',
        description: `
Claims the outage with a conditional update that only matches while it is
still REPORTED or ACKNOWLEDGED. Two admins dispatching at the same instant
means the loser receives **409**, so one outage can never be handed to two
technicians. Also checks availability, the concurrent-job cap and zone.
`.trim(),
        security: [{ bearerAuth: [] }],
        parameters: [uuidParam('id', 'Outage id')],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['technicianId'],
                properties: {
                  technicianId: { type: 'string', format: 'uuid' },
                  notes: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: ok('Technician assigned'),
          409: err('Already assigned, technician unavailable or at job limit'),
          ...COMMON_ERRORS,
        },
      },
    },
    '/outages/{id}/status': {
      patch: {
        tags: ['Outage'],
        summary: 'Advance the outage lifecycle (ADMIN, TECHNICIAN)',
        description:
          'REPORTED -> ACKNOWLEDGED -> ASSIGNED -> IN_PROGRESS -> RESOLVED -> CLOSED. A technician may only move outages they are assigned to.',
        security: [{ bearerAuth: [] }],
        parameters: [uuidParam('id', 'Outage id')],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['status'],
                properties: {
                  status: {
                    type: 'string',
                    enum: [
                      'ACKNOWLEDGED',
                      'ASSIGNED',
                      'IN_PROGRESS',
                      'RESOLVED',
                      'CLOSED',
                      'CANCELLED',
                    ],
                  },
                  note: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: ok('Status updated'),
          ...COMMON_ERRORS,
          400: err('Illegal transition'),
        },
      },
    },
    '/outages/{id}/restore': {
      post: {
        tags: ['Outage'],
        summary: 'Restore power and close out the job (ADMIN, TECHNICIAN)',
        description:
          'One transaction: resolves the outage, stores downtimeMinutes for MTTR, completes the assignment, frees the technician slot and notifies every customer in the area.',
        security: [{ bearerAuth: [] }],
        parameters: [uuidParam('id', 'Outage id')],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { note: { type: 'string' } },
              },
            },
          },
        },
        responses: { 200: ok('Power restored'), ...COMMON_ERRORS },
      },
    },

    // ---------- BILLS ----------
    '/bills/generate': {
      post: {
        tags: ['Bill'],
        summary: 'Generate bills for a billing period (ADMIN)',
        description:
          'Re-runnable: the (connectionId, billingPeriod) unique constraint means a repeated run tops up missing rows instead of double-billing.',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['billingPeriod', 'dueDate'],
                properties: {
                  billingPeriod: { type: 'string', example: '2026-09' },
                  dueDate: { type: 'string', example: '2026-09-25' },
                  areaId: { type: 'string', format: 'uuid' },
                  defaultUnits: { type: 'number' },
                },
              },
            },
          },
        },
        responses: { 201: ok('Bills generated'), ...COMMON_ERRORS },
      },
    },
    '/bills/apply-overdue': {
      post: {
        tags: ['Bill'],
        summary: 'Mark past-due bills OVERDUE and apply the late fee (ADMIN)',
        security: [{ bearerAuth: [] }],
        responses: { 200: ok('Bills updated'), ...COMMON_ERRORS },
      },
    },
    '/bills': {
      get: {
        tags: ['Bill'],
        summary: 'List all bills (ADMIN)',
        security: [{ bearerAuth: [] }],
        parameters: listParams({
          status: 'UNPAID | PENDING | PAID | OVERDUE',
          billingPeriod: 'YYYY-MM',
          customerId: 'Filter by customer',
        }),
        responses: { 200: ok('Paginated bills'), ...COMMON_ERRORS },
      },
    },
    '/bills/my': {
      get: {
        tags: ['Bill'],
        summary: 'My bills and outstanding balance (CUSTOMER)',
        security: [{ bearerAuth: [] }],
        parameters: listParams({ status: 'UNPAID | PENDING | PAID | OVERDUE' }),
        responses: { 200: ok('My bills'), ...COMMON_ERRORS },
      },
    },
    '/bills/{id}': {
      get: {
        tags: ['Bill'],
        summary: 'Get one bill with its payment history',
        security: [{ bearerAuth: [] }],
        parameters: [uuidParam('id', 'Bill id')],
        responses: { 200: ok('Bill detail'), ...COMMON_ERRORS },
      },
    },

    // ---------- PAYMENTS ----------
    '/payments/initiate': {
      post: {
        tags: ['Payment'],
        summary: 'Start a bKash payment for a bill (CUSTOMER)',
        description:
          'Returns a bkashURL to open in a browser. Sandbox wallet 01770618575, OTP 123456, PIN 12121.',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['billId'],
                properties: { billId: { type: 'string', format: 'uuid' } },
              },
            },
          },
        },
        responses: {
          201: ok('Payment session created'),
          ...COMMON_ERRORS,
          400: err('Bill already paid'),
          502: err('bKash unreachable or rejected the request'),
        },
      },
    },
    '/payments/bkash/callback': {
      get: {
        tags: ['Payment'],
        summary: 'bKash redirect target (public)',
        description: `
bKash redirects the payer's browser here. On \`status=success\` the server
calls Execute Payment and, if needed, Query Payment Status, and only then
settles the bill. Add \`raw=true\` to receive JSON instead of a redirect,
which is how the flow is demonstrated in Postman.
`.trim(),
        parameters: [
          { name: 'paymentID', in: 'query', required: true, schema: { type: 'string' } },
          {
            name: 'status',
            in: 'query',
            schema: { type: 'string', enum: ['success', 'failure', 'cancel'] },
          },
          { name: 'raw', in: 'query', schema: { type: 'boolean' } },
        ],
        responses: {
          200: ok('Callback processed (raw=true)'),
          302: { description: 'Redirect to the frontend result page' },
          400: err('bKash did not complete the payment'),
          404: err('Unknown paymentID'),
        },
      },
    },
    '/payments/{id}/verify': {
      post: {
        tags: ['Payment'],
        summary: 'Re-verify a payment against bKash (CUSTOMER, ADMIN)',
        description:
          'Idempotent safety net for when the payer never returns from the redirect. An already-settled payment short-circuits instead of being processed twice.',
        security: [{ bearerAuth: [] }],
        parameters: [uuidParam('id', 'Payment id')],
        responses: { 200: ok('Payment verified'), ...COMMON_ERRORS },
      },
    },
    '/payments/my': {
      get: {
        tags: ['Payment'],
        summary: 'My payment history (CUSTOMER)',
        security: [{ bearerAuth: [] }],
        parameters: listParams({ status: 'INITIATED | COMPLETED | FAILED | CANCELLED' }),
        responses: { 200: ok('My payments'), ...COMMON_ERRORS },
      },
    },
    '/payments': {
      get: {
        tags: ['Payment'],
        summary: 'List all payments (ADMIN)',
        security: [{ bearerAuth: [] }],
        parameters: listParams({ status: 'Filter by status' }),
        responses: { 200: ok('Paginated payments'), ...COMMON_ERRORS },
      },
    },
    '/payments/{id}': {
      get: {
        tags: ['Payment'],
        summary: 'Get one payment',
        security: [{ bearerAuth: [] }],
        parameters: [uuidParam('id', 'Payment id')],
        responses: { 200: ok('Payment detail'), ...COMMON_ERRORS },
      },
    },

    // ---------- NOTIFICATIONS ----------
    '/notifications/my': {
      get: {
        tags: ['Notification'],
        summary: 'My notifications with unread count',
        security: [{ bearerAuth: [] }],
        parameters: listParams({ isRead: 'true | false', type: 'Notification type' }),
        responses: { 200: ok('Notifications'), ...COMMON_ERRORS },
      },
    },
    '/notifications/read-all': {
      patch: {
        tags: ['Notification'],
        summary: 'Mark every notification read',
        security: [{ bearerAuth: [] }],
        responses: { 200: ok('All marked read'), ...COMMON_ERRORS },
      },
    },
    '/notifications/{id}/read': {
      patch: {
        tags: ['Notification'],
        summary: 'Mark one notification read',
        security: [{ bearerAuth: [] }],
        parameters: [uuidParam('id', 'Notification id')],
        responses: { 200: ok('Marked read'), ...COMMON_ERRORS },
      },
    },

    // ---------- ADMIN ----------
    '/admin/users': {
      get: {
        tags: ['Admin'],
        summary: 'List users (ADMIN)',
        security: [{ bearerAuth: [] }],
        parameters: listParams({
          role: 'CUSTOMER | TECHNICIAN | ADMIN',
          status: 'ACTIVE | BANNED',
        }),
        responses: { 200: ok('Paginated users'), ...COMMON_ERRORS },
      },
    },
    '/admin/users/{id}/role': {
      patch: {
        tags: ['Admin'],
        summary: 'Change a user role (ADMIN)',
        description:
          'Promoting to TECHNICIAN creates the technician profile needed for dispatch. An admin cannot change their own role.',
        security: [{ bearerAuth: [] }],
        parameters: [uuidParam('id', 'User id')],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['role'],
                properties: {
                  role: {
                    type: 'string',
                    enum: ['CUSTOMER', 'TECHNICIAN', 'ADMIN'],
                  },
                },
              },
            },
          },
        },
        responses: { 200: ok('Role changed'), ...COMMON_ERRORS },
      },
    },
    '/admin/users/{id}/status': {
      patch: {
        tags: ['Admin'],
        summary: 'Ban or reinstate a user (ADMIN)',
        description: 'Banning revokes every active refresh token immediately.',
        security: [{ bearerAuth: [] }],
        parameters: [uuidParam('id', 'User id')],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['status'],
                properties: {
                  status: { type: 'string', enum: ['ACTIVE', 'BANNED'] },
                },
              },
            },
          },
        },
        responses: { 200: ok('Status changed'), ...COMMON_ERRORS },
      },
    },
    '/admin/dashboard-stats': {
      get: {
        tags: ['Admin'],
        summary: 'System-wide statistics (ADMIN, Redis-cached 60s)',
        security: [{ bearerAuth: [] }],
        responses: { 200: ok('Dashboard statistics'), ...COMMON_ERRORS },
      },
    },
    '/admin/audit-logs': {
      get: {
        tags: ['Admin'],
        summary: 'Audit trail of every critical action (ADMIN)',
        security: [{ bearerAuth: [] }],
        parameters: listParams({
          entityType: 'e.g. Outage, User, Payment',
          entityId: 'Filter by record id',
          actorId: 'Filter by who acted',
          action: 'e.g. OUTAGE_ASSIGNED',
        }),
        responses: { 200: ok('Paginated audit log'), ...COMMON_ERRORS },
      },
    },
    '/admin/cache/clear': {
      post: {
        tags: ['Admin'],
        summary: 'Drop cached dashboards and schedules (ADMIN)',
        security: [{ bearerAuth: [] }],
        responses: { 200: ok('Caches cleared'), ...COMMON_ERRORS },
      },
    },

    // ---------- ANALYTICS ----------
    '/analytics/outages': {
      get: {
        tags: ['Analytics'],
        summary: 'MTTR, resolution rate, worst areas, monthly trend (ADMIN)',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'from', in: 'query', schema: { type: 'string' } },
          { name: 'to', in: 'query', schema: { type: 'string' } },
        ],
        responses: { 200: ok('Outage analytics'), ...COMMON_ERRORS },
      },
    },
    '/analytics/load-shedding': {
      get: {
        tags: ['Analytics'],
        summary: 'Shedding hours per zone and feeder (ADMIN)',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'from', in: 'query', schema: { type: 'string' } },
          { name: 'to', in: 'query', schema: { type: 'string' } },
        ],
        responses: { 200: ok('Load-shedding analytics'), ...COMMON_ERRORS },
      },
    },
    '/analytics/technicians': {
      get: {
        tags: ['Analytics'],
        summary: 'Per-technician workload and restoration times (ADMIN)',
        security: [{ bearerAuth: [] }],
        responses: { 200: ok('Technician performance'), ...COMMON_ERRORS },
      },
    },
  },
};

export default openapiSpec;
