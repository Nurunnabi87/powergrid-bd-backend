/**
 * Generates PowerGrid-BD.postman_collection.json from the OpenAPI document.
 *
 * Keeping the collection generated rather than hand-maintained means it can
 * never drift from the spec: re-run `npm run postman` after adding a route.
 */
import fs from 'fs';
import path from 'path';
import openapiSpec from '../src/docs/openapi';

type TOperation = {
  tags?: string[];
  summary?: string;
  description?: string;
  security?: unknown[];
  parameters?: { name: string; in: string; schema?: { type?: string } }[];
  requestBody?: {
    content?: Record<string, { schema?: Record<string, unknown> }>;
  };
};

const BASE_URL = '{{baseUrl}}';

/** Chooses the token variable a request should send. */
const tokenFor = (summary: string, folder: string): string => {
  const text = `${summary} ${folder}`.toUpperCase();
  if (text.includes('(CUSTOMER)') || text.includes('MY BILLS')) return '{{customerToken}}';
  if (text.includes('(TECHNICIAN)')) return '{{technicianToken}}';
  if (text.includes('(ADMIN')) return '{{adminToken}}';
  // Endpoints open to any signed-in user default to the admin token, which
  // can see everything.
  return '{{adminToken}}';
};

/** Builds a sample body from the operation's JSON schema examples. */
const sampleBody = (op: TOperation): string | null => {
  const schema = op.requestBody?.content?.['application/json']?.schema as
    | { properties?: Record<string, { example?: unknown; enum?: unknown[]; type?: string }> }
    | undefined;

  if (!schema?.properties) return null;

  const body: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(schema.properties)) {
    if (prop.example !== undefined) body[key] = prop.example;
    else if (prop.enum?.length) body[key] = prop.enum[0];
    else if (prop.type === 'number' || prop.type === 'integer') body[key] = 0;
    else if (prop.type === 'boolean') body[key] = false;
    else body[key] = `{{${key}}}`;
  }

  return JSON.stringify(body, null, 2);
};

const buildRequest = (
  method: string,
  routePath: string,
  op: TOperation,
  folder: string
) => {
  // Turn /outages/{id} into /outages/:id with a Postman path variable.
  const postmanPath = routePath.replace(/\{(\w+)\}/g, ':$1');
  const segments = postmanPath.split('/').filter(Boolean);

  const queryParams = (op.parameters ?? [])
    .filter((p) => p.in === 'query')
    .map((p) => ({ key: p.name, value: '', disabled: true }));

  const pathVars = (op.parameters ?? [])
    .filter((p) => p.in === 'path')
    .map((p) => ({ key: p.name, value: `{{${p.name}}}` }));

  const body = sampleBody(op);
  const needsAuth = Boolean(op.security?.length);

  return {
    name: op.summary ?? `${method.toUpperCase()} ${routePath}`,
    request: {
      method: method.toUpperCase(),
      header: [
        ...(body ? [{ key: 'Content-Type', value: 'application/json' }] : []),
        ...(needsAuth
          ? [
              {
                key: 'Authorization',
                value: `Bearer ${tokenFor(op.summary ?? '', folder)}`,
              },
            ]
          : []),
      ],
      ...(body && { body: { mode: 'raw', raw: body } }),
      url: {
        raw: `${BASE_URL}${postmanPath}`,
        host: [BASE_URL],
        path: segments,
        ...(queryParams.length && { query: queryParams }),
        ...(pathVars.length && { variable: pathVars }),
      },
      description: op.description ?? '',
    },
    response: [],
  };
};

const main = (): void => {
  const folders = new Map<string, ReturnType<typeof buildRequest>[]>();

  for (const [routePath, methods] of Object.entries(openapiSpec.paths)) {
    for (const [method, operation] of Object.entries(
      methods as Record<string, TOperation>
    )) {
      const folder = operation.tags?.[0] ?? 'Other';
      if (!folders.has(folder)) folders.set(folder, []);
      folders.get(folder)!.push(buildRequest(method, routePath, operation, folder));
    }
  }

  const collection = {
    info: {
      name: 'PowerGrid BD - Load Shedding & Power Outage Management API',
      description: openapiSpec.info.description,
      schema:
        'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    // Logs in as all three roles once per run and caches the tokens, so any
    // request in the collection can be fired on its own.
    event: [
      {
        listen: 'prerequest',
        script: {
          type: 'text/javascript',
          exec: [
            'const base = pm.collectionVariables.get("baseUrl");',
            '',
            'const accounts = [',
            '  { key: "adminToken",      email: "admin@powergrid.bd",     password: "Admin@1234" },',
            '  { key: "technicianToken", email: "tech1@powergrid.bd",     password: "Tech@1234" },',
            '  { key: "customerToken",   email: "customer1@powergrid.bd", password: "Customer@1234" },',
            '];',
            '',
            'const missing = accounts.filter((a) => !pm.collectionVariables.get(a.key));',
            'if (missing.length === 0) { return; }',
            '',
            'let pending = missing.length;',
            'missing.forEach((account) => {',
            '  pm.sendRequest({',
            '    url: base + "/auth/login",',
            '    method: "POST",',
            '    header: { "Content-Type": "application/json" },',
            '    body: { mode: "raw", raw: JSON.stringify({ email: account.email, password: account.password }) },',
            '  }, (err, res) => {',
            '    if (!err && res.code === 200) {',
            '      const data = res.json().data;',
            '      pm.collectionVariables.set(account.key, data.accessToken);',
            '      if (account.key === "customerToken") {',
            '        pm.collectionVariables.set("customerRefreshToken", data.refreshToken);',
            '      }',
            '    }',
            '    pending -= 1;',
            '  });',
            '});',
          ],
        },
      },
    ],
    variable: [
      { key: 'baseUrl', value: 'http://localhost:5000/api/v1' },
      { key: 'adminToken', value: '' },
      { key: 'technicianToken', value: '' },
      { key: 'customerToken', value: '' },
      { key: 'customerRefreshToken', value: '' },
      { key: 'id', value: '' },
      { key: 'zoneId', value: '' },
      { key: 'substationId', value: '' },
      { key: 'feederId', value: '' },
      { key: 'areaId', value: '' },
      { key: 'customerId', value: '' },
      { key: 'technicianId', value: '' },
      { key: 'billId', value: '' },
      { key: 'paymentID', value: '' },
    ],
    item: [
      {
        name: 'Health',
        item: [
          {
            name: 'Health check',
            request: {
              method: 'GET',
              header: [],
              url: { raw: '{{baseUrl}}/../../health', host: ['{{baseUrl}}'] },
            },
            response: [],
          },
        ],
      },
      ...[...folders.entries()].map(([name, item]) => ({ name, item })),
    ],
  };

  const outPath = path.join(process.cwd(), 'PowerGrid-BD.postman_collection.json');
  fs.writeFileSync(outPath, JSON.stringify(collection, null, 2));

  const count = [...folders.values()].reduce((sum, reqs) => sum + reqs.length, 0);
  console.log(`[postman] wrote ${count} requests across ${folders.size} folders`);
  console.log(`[postman] ${outPath}`);
};

main();
