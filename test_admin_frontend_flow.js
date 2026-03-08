async function requestJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, json };
}

async function main() {
  const baseUrl = process.env.BACKEND_URL || 'http://localhost:3001';
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123';

  const login = await requestJson(`${baseUrl}/api/auth/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!login.ok || !login.json || !login.json.token) {
    console.log('LOGIN FAILED', login.status);
    console.log(JSON.stringify(login.json, null, 2));
    process.exit(1);
  }

  const token = login.json.token;
  const headers = { Authorization: `Bearer ${token}` };

  const targets = [
    `${baseUrl}/api/db-admin/cache-configs`,
    `${baseUrl}/api/db-admin/embedding-config`,
    `${baseUrl}/api/db-admin/tables`,
    `${baseUrl}/api/api-engine/config`,
    `${baseUrl}/api/api-engine/stats?page=1&limit=1`,
    `${baseUrl}/api/api-list/config`,
    `${baseUrl}/api/auth/admin/transactions`,
    `${baseUrl}/api/auth/admin/coupons`,
  ];

  for (const url of targets) {
    const r = await requestJson(url, { headers });
    const summary = (() => {
      if (typeof r.json === 'object' && r.json) {
        if (Array.isArray(r.json.configs)) return `configs=${r.json.configs.length}`;
        if (Array.isArray(r.json.tables)) return `tables=${r.json.tables.length}`;
        if (Array.isArray(r.json.transactions)) return `transactions=${r.json.transactions.length}`;
        if (Array.isArray(r.json.coupons)) return `coupons=${r.json.coupons.length}`;
        if (Array.isArray(r.json.keys)) return `keys=${r.json.keys.length}`;
        if (Array.isArray(r.json)) return `items=${r.json.length}`;
      }
      return 'ok';
    })();
    console.log(`${r.status} ${url} -> ${summary}`);
    if (!r.ok) {
      console.log(JSON.stringify(r.json, null, 2));
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

