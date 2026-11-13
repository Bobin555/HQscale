// Azure Functions (Node, v4 model) wiring for the results API. Deployed automatically by
// Azure Static Web Apps from the api/ folder. Settings (in the Static Web App's configuration):
//   HQSCALE_STORAGE          connection string of the Storage account that keeps the records
//   HQSCALE_ALLOW_ANONYMOUS  "true" only if the site has no sign-in (records are then unverified)

import { app } from '@azure/functions';
import { handle, readPrincipal } from '../attempts-core.js';
import { storeFromEnv } from '../stores.js';

const store = storeFromEnv();

function route(name) {
  return async (request) => {
    const body = request.method === 'POST' ? await request.json().catch(() => null) : null;
    const res = await handle(
      { method: request.method, route: name, query: Object.fromEntries(request.query), body, principal: readPrincipal(request.headers.get('x-ms-client-principal')) },
      { store, allowAnonymous: process.env.HQSCALE_ALLOW_ANONYMOUS === 'true' },
    );
    return { status: res.status, jsonBody: res.body };
  };
}

app.http('health', { route: 'health', methods: ['GET'], authLevel: 'anonymous', handler: route('health') });
app.http('attempts', { route: 'attempts', methods: ['GET', 'POST'], authLevel: 'anonymous', handler: route('attempts') });
