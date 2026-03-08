async function requestJson(url, token) {
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
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
  const token = process.env.AUTH_TOKEN || process.env.TOKEN || '';

  const targets = [
    `${baseUrl}/api/db-admin/cache-configs`,
    `${baseUrl}/api/db-admin/embedding-config`,
    `${baseUrl}/api/api-engine/config`,
    `${baseUrl}/api/api-engine/stats?page=1&limit=1`,
    `${baseUrl}/api/api-list/config`,
  ];

  for (const url of targets) {
    const r = await requestJson(url, token);
    const summary = (() => {
      if (typeof r.json === 'object' && r.json) {
        if (Array.isArray(r.json.configs)) return `configs=${r.json.configs.length}`;
        if (Array.isArray(r.json.keys)) return `keys=${r.json.keys.length}`;
        if (Array.isArray(r.json.data)) return `data=${r.json.data.length}`;
        if (Array.isArray(r.json.stats)) return `stats=${r.json.stats.length}`;
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

