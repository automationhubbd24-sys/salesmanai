const axios = require('axios');
const FormData = require('form-data');

async function run() {
  const base = process.env.TEST_BACKEND_URL || 'http://localhost:3001';
  const userId = process.env.TEST_USER_ID || '45b7647f-8ee0-44c6-a230-ae82943ab6a6';
  const fbPageId = process.env.TEST_FB_PAGE_ID || '1018705751321580';
  const waSession = process.env.TEST_WA_SESSION || 'bottow_wh03lz';

  const metadata = {
    user_id: userId,
    name: 'AI Test Product',
    description: 'test',
    keywords: 'ai,test',
    price: 0,
    currency: 'USD',
    stock: 0,
    is_active: true,
    allowed_messenger_ids: [fbPageId],
    allowed_wa_sessions: [waSession],
    is_combo: false,
    combo_items: [],
    allow_description: false,
    page_id: fbPageId,
    variants: [{ name: 'Standard', price: '0', currency: 'USD', available: true }]
  };

  const fd = new FormData();
  fd.append('metadata', JSON.stringify(metadata));
  fd.append('user_id', metadata.user_id);
  fd.append('name', metadata.name);
  fd.append('description', metadata.description);
  fd.append('allowed_messenger_ids', JSON.stringify(metadata.allowed_messenger_ids));
  fd.append('allowed_wa_sessions', JSON.stringify(metadata.allowed_wa_sessions));
  fd.append('page_id', String(metadata.page_id));

  const createRes = await axios.post(`${base}/api/products`, fd, { headers: fd.getHeaders() });
  const product = createRes.data;
  console.log('CREATE_ID', product.id);

  const delParams = new URLSearchParams();
  delParams.set('user_id', userId);
  delParams.set('page_id', fbPageId);
  let delRes = await axios.delete(`${base}/api/products/${product.id}?${delParams.toString()}`);
  console.log('UNASSIGN_FB', delRes.data && delRes.data.message);

  delParams.set('page_id', waSession);
  delRes = await axios.delete(`${base}/api/products/${product.id}?${delParams.toString()}`);
  console.log('DELETE_LAST', delRes.data && delRes.data.message);
}

run().catch(err => {
  console.error('TEST_ERR', err.response ? err.response.data : err.message);
  process.exit(1);
});
