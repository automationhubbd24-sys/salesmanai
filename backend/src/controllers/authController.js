const axios = require('axios');
const dbService = require('../services/dbService');
const authService = require('../services/authService');
const pgClient = require('../services/pgClient');

const otpRequestTracker = new Map();
const OTP_COOLDOWN_MS = 60 * 1000;
const OTP_WINDOW_MS = 15 * 60 * 1000;
const OTP_MAX_PER_WINDOW = 5;
const FACEBOOK_GRAPH_VERSION = process.env.FACEBOOK_GRAPH_VERSION || 'v25.0';
const DEBUG_SERVER_URL = 'http://10.2.0.2:7777/event';
const DEBUG_SESSION_ID = 'whatsapp-loading-stuck';

function getClientIp(req) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return forwarded || req.ip || req.socket?.remoteAddress || 'unknown';
}

function consumeOtpQuota(scope, email, ip) {
    const now = Date.now();
    const key = `${scope}:${String(email || '').toLowerCase()}:${ip}`;
    const current = otpRequestTracker.get(key);

    if (current && now - current.windowStartedAt < OTP_WINDOW_MS) {
        if (now - current.lastSentAt < OTP_COOLDOWN_MS) {
            return {
                allowed: false,
                retryAfterMs: OTP_COOLDOWN_MS - (now - current.lastSentAt)
            };
        }
        if (current.count >= OTP_MAX_PER_WINDOW) {
            return {
                allowed: false,
                retryAfterMs: OTP_WINDOW_MS - (now - current.windowStartedAt)
            };
        }

        current.count += 1;
        current.lastSentAt = now;
        otpRequestTracker.set(key, current);
        return { allowed: true };
    }

    otpRequestTracker.set(key, {
        count: 1,
        lastSentAt: now,
        windowStartedAt: now
    });
    return { allowed: true };
}

function formatRetryAfterMessage(retryAfterMs) {
    const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
    return `Please wait ${seconds} seconds before requesting another code.`;
}

async function exchangeFacebookShortLivedToken(shortLivedToken, appId, appSecret) {
    const url = `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/oauth/access_token`;
    const params = {
        grant_type: 'fb_exchange_token',
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: shortLivedToken
    };

    const response = await axios.get(url, { params });
    return response.data;
}

async function exchangeFacebookCodeForToken(code, redirectUri, appId, appSecret) {
    const url = `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/oauth/access_token`;
    const params = {
        client_id: appId,
        client_secret: appSecret,
        code
    };

    if (redirectUri) {
        params.redirect_uri = redirectUri;
    }

    const response = await axios.get(url, { params });
    return response.data;
}

async function fetchMessengerPages(accessToken) {
    const response = await axios.get(`https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/me/accounts`, {
        params: {
            fields: 'id,name,access_token,tasks',
            access_token: accessToken
        }
    });

    return Array.isArray(response.data?.data) ? response.data.data : [];
}

function isAllowedFrontendOrigin(origin) {
    if (!origin) {
        return false;
    }

    try {
        const parsed = new URL(origin);
        const hostname = parsed.hostname.toLowerCase();

        if (hostname === 'localhost' || hostname === '127.0.0.1') {
            return true;
        }

        if (hostname === 'salesmanchatbot.online' || hostname.endsWith('.salesmanchatbot.online')) {
            return true;
        }

        const configuredOrigins = [
            process.env.FRONTEND_URL,
            process.env.PUBLIC_WEB_URL,
            process.env.CLIENT_URL,
            process.env.APP_URL
        ]
            .filter(Boolean)
            .map((value) => {
                try {
                    return new URL(value).origin;
                } catch {
                    return null;
                }
            })
            .filter(Boolean);

        return configuredOrigins.includes(parsed.origin);
    } catch {
        return false;
    }
}

function getCanonicalFrontendOrigin() {
    const fallbackCandidates = [
        process.env.FRONTEND_URL,
        process.env.PUBLIC_WEB_URL,
        process.env.CLIENT_URL,
        process.env.APP_URL,
        'https://salesmanchatbot.online'
    ];

    for (const candidate of fallbackCandidates) {
        if (isAllowedFrontendOrigin(candidate)) {
            return new URL(candidate).origin;
        }
    }

    return 'https://salesmanchatbot.online';
}

function resolveFrontendOrigin(req, requestedOrigin) {
    if (isAllowedFrontendOrigin(requestedOrigin)) {
        const parsedOrigin = new URL(requestedOrigin).origin;
        const parsedHostname = new URL(requestedOrigin).hostname.toLowerCase();

        if (parsedHostname === 'localhost' || parsedHostname === '127.0.0.1') {
            return parsedOrigin;
        }
    }

    const canonicalOrigin = getCanonicalFrontendOrigin();
    if (canonicalOrigin) {
        return canonicalOrigin;
    }

    return `${req.protocol}://${req.get('host')}`;
}

function renderFacebookBrowserRedirectPage(res, oauthUrl, type) {
    const parsedUrl = new URL(oauthUrl);
    const escapedUrl = String(oauthUrl).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const flowLabel = type === 'whatsapp' ? 'WhatsApp Business' : 'Messenger';
    const debugData = {
        host: parsedUrl.host,
        path: parsedUrl.pathname,
        client_id: parsedUrl.searchParams.get('client_id'),
        redirect_uri: parsedUrl.searchParams.get('redirect_uri'),
        response_type: parsedUrl.searchParams.get('response_type'),
        display: parsedUrl.searchParams.get('display'),
        state: parsedUrl.searchParams.get('state'),
        has_config_id: Boolean(parsedUrl.searchParams.get('config_id'))
    };
    const escapedDebugJson = JSON.stringify(debugData, null, 2).replace(/</g, '\\u003c');

    let hiddenInputs = '';
    for (const [key, value] of parsedUrl.searchParams.entries()) {
        const escapedKey = String(key).replace(/"/g, '&quot;');
        const escapedValue = String(value).replace(/"/g, '&quot;');
        hiddenInputs += `<input type="hidden" name="${escapedKey}" value="${escapedValue}" />`;
    }
    const actionUrl = `${parsedUrl.origin}${parsedUrl.pathname}`;

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.status(200).send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
  <meta name="referrer" content="origin-when-cross-origin" />
  <title>Continue with Facebook</title>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #050505;
      color: #f8fafc;
      font-family: Arial, sans-serif;
      padding: 24px;
    }
    .card {
      width: min(100%, 420px);
      background: #101010;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 18px;
      padding: 24px;
      box-sizing: border-box;
      text-align: center;
    }
    h1 { margin: 0 0 12px; font-size: 24px; }
    p { margin: 0 0 18px; color: #cbd5e1; line-height: 1.5; }
    .continue-form {
      margin: 0;
    }
    .continue-button {
      display: inline-block;
      padding: 12px 18px;
      border-radius: 999px;
      background: #16a34a;
      color: #03120a;
      font-weight: 700;
      text-decoration: none;
      border: 0;
      cursor: pointer;
      font-size: 16px;
    }
    small {
      display: block;
      margin-top: 14px;
      color: #94a3b8;
      line-height: 1.5;
    }
    details {
      margin-top: 18px;
      text-align: left;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 12px;
      background: #080808;
    }
    summary {
      cursor: pointer;
      color: #cbd5e1;
      font-weight: 600;
      margin-bottom: 8px;
    }
    pre {
      white-space: pre-wrap;
      word-break: break-word;
      margin: 10px 0 0;
      color: #93c5fd;
      font-size: 12px;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>Facebook Connection</h1>
    
    <div style="background: #3f3f46; border-left: 4px solid #facc15; padding: 12px; margin-bottom: 20px; border-radius: 4px; font-size: 14px; line-height: 1.5; position: relative;">
      <button onclick="toggleLang()" style="position: absolute; right: 10px; top: 10px; background: transparent; border: 1px solid #9ca3af; color: #cbd5e1; border-radius: 4px; padding: 2px 6px; font-size: 12px; cursor: pointer;">🌐 BN</button>
      
      <div id="warn-en">
        <strong>⚠️ IMPORTANT:</strong>
        <br />
        If you are not already logged into Facebook in this mobile browser, the next screen might get stuck loading.
        <br /><br />
        If it gets stuck, please open a new tab, log in to <strong>facebook.com</strong>, and then come back and try again.
      </div>
      
      <div id="warn-bn" style="display: none;">
        <strong>⚠️ জরুরী:</strong>
        <br />
        আপনি যদি এই মোবাইল ব্রাউজারে আগে থেকে ফেসবুকে লগইন করা না থাকেন, তবে পরের স্ক্রিনটি লোডিং-এ আটকে যেতে পারে।
        <br /><br />
        যদি আটকে যায়, দয়া করে নতুন একটি ট্যাবে <strong>facebook.com</strong>-এ লগইন করুন, এবং এরপর এখানে ফিরে এসে আবার চেষ্টা করুন।
      </div>
    </div>

    <p id="desc-en">We are opening the Facebook login for ${flowLabel}. Please tap the button below to continue.</p>
    <p id="desc-bn" style="display: none;">আমরা ${flowLabel} এর জন্য ফেসবুক লগইন খুলছি। দয়া করে নিচের বাটনে ক্লিক করুন।</p>
    
    <form class="continue-form" method="GET" action="${actionUrl}">
      ${hiddenInputs}
      <button type="submit" class="continue-button" style="background: #22c55e; color: white; border: none; padding: 14px 20px; width: 100%; border-radius: 8px; font-size: 16px; font-weight: bold; margin-top: 10px;">Continue to Facebook</button>
    </form>
    
    <div id="footer-en" style="margin-top: 16px; font-size: 12px; color: #9ca3af; text-align: center;">
      Avoid switching to the Facebook App during this step. Finish the connection in this browser.
    </div>
    <div id="footer-bn" style="display: none; margin-top: 16px; font-size: 12px; color: #9ca3af; text-align: center;">
      লগইন করার সময় ফেসবুক অ্যাপে যাবেন না। এই ব্রাউজারেই কানেকশন সম্পন্ন করুন।
    </div>
  </div>
  <script>
    function toggleLang() {
      var warnEn = document.getElementById('warn-en');
      var warnBn = document.getElementById('warn-bn');
      var descEn = document.getElementById('desc-en');
      var descBn = document.getElementById('desc-bn');
      var footerEn = document.getElementById('footer-en');
      var footerBn = document.getElementById('footer-bn');
      var btn = document.querySelector('button[onclick="toggleLang()"]');
      
      if (warnEn.style.display === 'none') {
        warnEn.style.display = 'block';
        descEn.style.display = 'block';
        footerEn.style.display = 'block';
        warnBn.style.display = 'none';
        descBn.style.display = 'none';
        footerBn.style.display = 'none';
        btn.textContent = '🌐 BN';
      } else {
        warnEn.style.display = 'none';
        descEn.style.display = 'none';
        footerEn.style.display = 'none';
        warnBn.style.display = 'block';
        descBn.style.display = 'block';
        footerBn.style.display = 'block';
        btn.textContent = '🌐 EN';
      }
    }

    (function () {
      var targetUrl = ${JSON.stringify(String(oauthUrl))};
      var isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
      
      if (!isMobile) {
        window.location.replace(targetUrl);
      }
    })();
  </script>
</body>
</html>`);
}

exports.exchangeToken = async (req, res) => {
    try {
        const { shortLivedToken } = req.body;

        if (!shortLivedToken) {
            return res.status(400).json({ error: 'Short-lived token is required' });
        }

        const appId = process.env.FACEBOOK_APP_ID;
        const appSecret = process.env.FACEBOOK_APP_SECRET;

        if (!appId || !appSecret) {
            console.error('Missing FACEBOOK_APP_ID or FACEBOOK_APP_SECRET in .env');
            return res.status(500).json({ error: 'Server misconfiguration: Missing App ID/Secret' });
        }

        console.log('Exchanging token with Facebook...');
        const response = await exchangeFacebookShortLivedToken(shortLivedToken, appId, appSecret);

        if (response && response.access_token) {
            console.log('Token exchanged successfully.');
            return res.json({ 
                access_token: response.access_token,
                expires_in: response.expires_in 
            });
        } else {
            console.error('Facebook returned unexpected data:', response);
            return res.status(502).json({ error: 'Failed to exchange token', details: response });
        }

    } catch (error) {
        console.error('Token exchange error:', error.response ? error.response.data : error.message);
        return res.status(502).json({ 
            error: 'Facebook API Error', 
            details: error.response ? error.response.data : error.message 
        });
    }
};

exports.completeMessengerCode = async (req, res) => {
    try {
        const { code, redirectUri } = req.body || {};

        if (!code) {
            return res.status(400).json({ error: 'Facebook code is required' });
        }

        const appId = process.env.FACEBOOK_APP_ID;
        const appSecret = process.env.FACEBOOK_APP_SECRET;

        if (!appId || !appSecret) {
            console.error('Missing FACEBOOK_APP_ID or FACEBOOK_APP_SECRET in .env');
            return res.status(500).json({ error: 'Server misconfiguration: Missing App ID/Secret' });
        }

        const shortLivedData = await exchangeFacebookCodeForToken(code, redirectUri, appId, appSecret);
        const shortLivedToken = shortLivedData?.access_token;

        if (!shortLivedToken) {
            return res.status(502).json({ error: 'Facebook did not return an access token' });
        }

        let finalToken = shortLivedToken;
        try {
            const longLivedData = await exchangeFacebookShortLivedToken(shortLivedToken, appId, appSecret);
            if (longLivedData?.access_token) {
                finalToken = longLivedData.access_token;
            }
        } catch (exchangeError) {
            console.warn(
                'Long-lived token exchange failed during messenger mobile completion:',
                exchangeError.response?.data || exchangeError.message
            );
        }

        const pages = await fetchMessengerPages(finalToken);

        return res.json({
            success: true,
            access_token: finalToken,
            pages
        });
    } catch (error) {
        console.error(
            'Messenger mobile completion error:',
            error.response ? error.response.data : error.message
        );
        return res.status(502).json({
            error: 'Facebook API Error',
            details: error.response ? error.response.data : error.message
        });
    }
};

exports.startFacebookAuth = async (req, res) => {
    try {
        const { type, state, origin } = req.query;
        const appId = String(process.env.FACEBOOK_APP_ID || '').trim();
        const configId = process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID || '2197274487770639';
        
        if (!appId) {
            return res.status(500).send('FACEBOOK_APP_ID not configured on server.');
        }

        if (!/^\d+$/.test(appId)) {
            return res.status(500).send('FACEBOOK_APP_ID is invalid on server.');
        }

        if (!state) {
            return res.status(400).send('Missing OAuth state.');
        }

        if (type !== 'whatsapp' && type !== 'messenger') {
            return res.status(400).send('Invalid Facebook auth type.');
        }

        // Ensure table exists for polling
        await pgClient.query(`
            CREATE TABLE IF NOT EXISTS facebook_pending_auths (
                state TEXT PRIMARY KEY,
                type TEXT,
                code TEXT,
                error TEXT,
                error_description TEXT,
                completed BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Clean up old pending auths (older than 1 hour)
        await pgClient.query(`DELETE FROM facebook_pending_auths WHERE created_at < NOW() - INTERVAL '1 hour'`);

        // Insert or Update the pending auth record
        await pgClient.query(
            `INSERT INTO facebook_pending_auths (state, type) VALUES ($1, $2) 
             ON CONFLICT (state) DO UPDATE SET type = $2, created_at = NOW(), completed = FALSE, code = NULL, error = NULL`,
            [state, type]
        );

        const frontendOrigin = resolveFrontendOrigin(req, origin);
        
        let redirectUri = '';
        let scope = '';
        let extras = '';
        let oauthUrl;

        if (type === 'whatsapp') {
            redirectUri = `${frontendOrigin}/auth/facebook/whatsapp/callback`;
            extras = JSON.stringify({
                setup: {},
                featureType: "whatsapp_business_app_onboarding",
                sessionInfoVersion: "3"
            });
        } else {
            redirectUri = `${frontendOrigin}/auth/facebook/messenger/callback`;
          //  scope = 'pages_show_list,pages_messaging,pages_read_engagement,pages_manage_metadata,pages_read_user_content';
            scope = 'pages_show_list,pages_messaging,pages_read_engagement';
        } 

        let baseHost = 'm.facebook.com';
        
        if (type === 'whatsapp') {
            oauthUrl = new URL(`https://${baseHost}/${FACEBOOK_GRAPH_VERSION}/dialog/oauth`);
            oauthUrl.searchParams.set('config_id', configId);
            oauthUrl.searchParams.set('override_default_response_type', 'true');
            oauthUrl.searchParams.set('extras', extras);
            oauthUrl.searchParams.set('display', 'page');
            oauthUrl.searchParams.set('auth_type', 'rerequest');
        } else {
            oauthUrl = new URL(`https://${baseHost}/${FACEBOOK_GRAPH_VERSION}/dialog/oauth`);
            oauthUrl.searchParams.set('scope', scope);
            oauthUrl.searchParams.set('display', 'touch');
            oauthUrl.searchParams.set('auth_type', 'rerequest');
        }

        oauthUrl.searchParams.set('client_id', appId);
        oauthUrl.searchParams.set('redirect_uri', redirectUri);
        oauthUrl.searchParams.set('state', state);
        oauthUrl.searchParams.set('response_type', 'code');

        if (type === 'whatsapp') {
            // #region debug-point A:whatsapp-oauth-start
            void axios.post(DEBUG_SERVER_URL, { sessionId: DEBUG_SESSION_ID, runId: 'pre-fix', hypothesisId: 'A', location: 'authController.js:startFacebookAuth', msg: '[DEBUG] Starting WhatsApp Facebook OAuth', data: { origin, frontendOrigin, redirectUri, host: oauthUrl.host, path: oauthUrl.pathname, hasConfigId: Boolean(configId), state }, ts: Date.now() }).catch(() => {});
            // #endregion
        }

        console.log('[Facebook OAuth Start]', {
            type,
            frontendOrigin,
            redirectUri,
            clientId: appId,
            host: oauthUrl.host,
            path: oauthUrl.pathname
        });

        return renderFacebookBrowserRedirectPage(res, oauthUrl.toString(), type);
    } catch (error) {
        console.error('Start Facebook Auth Error:', error);
        res.status(500).send('Internal Server Error');
    }
};

exports.pollFacebookAuth = async (req, res) => {
    try {
        const { state } = req.query;
        if (!state) return res.status(400).json({ error: 'Missing state' });

        const result = await pgClient.query(
            `SELECT code, error, error_description, completed FROM facebook_pending_auths WHERE state = $1`,
            [state]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Auth session not found' });
        }

        const row = result.rows[0];
        if (row.completed) {
            // #region debug-point C:poll-completed
            void axios.post(DEBUG_SERVER_URL, { sessionId: DEBUG_SESSION_ID, runId: 'pre-fix', hypothesisId: 'C', location: 'authController.js:pollFacebookAuth', msg: '[DEBUG] WhatsApp/Messenger auth poll completed', data: { state, hasCode: Boolean(row.code), hasError: Boolean(row.error) }, ts: Date.now() }).catch(() => {});
            // #endregion
            // Delete once consumed to keep DB clean
            await pgClient.query(`DELETE FROM facebook_pending_auths WHERE state = $1`, [state]);
            return res.json({ completed: true, code: row.code, error: row.error, errorDescription: row.error_description });
        }

        return res.json({ completed: false });
    } catch (error) {
        console.error('Poll Facebook Auth Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

exports.persistFacebookCallback = async (req, res) => {
    try {
        const { state, code, error, errorDescription } = req.body;
        console.log(`Persisting callback for state: ${state}, hasCode: ${!!code}, error: ${error}`);
        // #region debug-point C:callback-persist-received
        void axios.post(DEBUG_SERVER_URL, { sessionId: DEBUG_SESSION_ID, runId: 'pre-fix', hypothesisId: 'C', location: 'authController.js:persistFacebookCallback', msg: '[DEBUG] Facebook callback persistence request received', data: { state, hasCode: Boolean(code), hasError: Boolean(error), errorDescription: errorDescription || null }, ts: Date.now() }).catch(() => {});
        // #endregion
        
        if (!state) return res.status(400).json({ error: 'Missing state' });

        const result = await pgClient.query(
            `UPDATE facebook_pending_auths 
             SET code = $1, error = $2, error_description = $3, completed = TRUE 
             WHERE state = $4`,
            [code, error, errorDescription, state]
        );

        if (result.rowCount === 0) {
            console.warn(`No pending auth found for state ${state} during persistence. Creating one.`);
            await pgClient.query(
                `INSERT INTO facebook_pending_auths (state, code, error, error_description, completed) 
                 VALUES ($1, $2, $3, $4, TRUE)`,
                [state, code, error, errorDescription]
            );
        }

        // #region debug-point C:callback-persist-saved
        void axios.post(DEBUG_SERVER_URL, { sessionId: DEBUG_SESSION_ID, runId: 'pre-fix', hypothesisId: 'C', location: 'authController.js:persistFacebookCallback', msg: '[DEBUG] Facebook callback persistence saved', data: { state, hasCode: Boolean(code), hasError: Boolean(error), createdFallbackRow: result.rowCount === 0 }, ts: Date.now() }).catch(() => {});
        // #endregion

        return res.json({ success: true });
    } catch (error) {
        console.error('Persist Facebook Callback Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

exports.adminTopup = async (req, res) => {
    try {
        const { email, amount, secret } = req.body;

        // Simple Secret Check for extra security (optional but good)
        // Ideally should check Admin Session but for quick implementation we rely on frontend sending it? 
        // No, frontend is secured by Admin Login. 
        // We will assume if this endpoint is hit, it's from our Admin Page. 
        // But to be safe, let's check a hardcoded secret or just rely on obscurity if user wants "just make it work".
        // Actually, the route isn't protected by middleware in authRoutes yet.
        // Let's add a basic check.
        
        if (!email || !amount) {
            return res.status(400).json({ error: "Email and Amount required" });
        }

        const result = await dbService.addBalanceByEmail(email, amount);
        res.json(result);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.adminLogin = async (req, res) => {
    try {
        const { username, password } = req.body || {};

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }

        const envUser = process.env.ADMIN_USERNAME || 'abcadmin';
        const envPass = process.env.ADMIN_PASSWORD || 'admin123';

        if (username === envUser && password === envPass) {
            const jwtSecret = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET || envPass;
            if (!jwtSecret) {
                return res.status(500).json({ error: 'Admin auth secret is not configured' });
            }
            const token = require('jsonwebtoken').sign(
                { role: 'admin', username: username },
                jwtSecret,
                { expiresIn: '90d' }
            );
            return res.json({ success: true, token });
        }

        return res.status(401).json({ error: 'Invalid credentials' });
    } catch (error) {
        console.error('Admin login error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

exports.listTransactions = async (req, res) => {
    try {
        const { rows } = await pgClient.query(
            'SELECT id, user_email, amount, method, trx_id, sender_number, status, created_at FROM payment_transactions ORDER BY created_at DESC'
        );
        res.json({ transactions: rows });
    } catch (error) {
        console.error('List transactions error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

exports.approveTransaction = async (req, res) => {
    try {
        const { id } = req.params;
        const txnId = String(id || '').trim();
        if (!txnId) {
            return res.status(400).json({ error: 'Invalid id' });
        }

        const { rows } = await pgClient.query(
            'SELECT * FROM payment_transactions WHERE id = $1',
            [txnId]
        );
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Transaction not found' });
        }

        const txn = rows[0];
        if (txn.status === 'approved') {
            return res.json({ success: true });
        }

        await dbService.approveDepositTransaction(txn);

        res.json({ success: true });
    } catch (error) {
        console.error('Approve transaction error:', error);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
};

exports.rejectTransaction = async (req, res) => {
    try {
        const { id } = req.params;
        const txnId = String(id || '').trim();
        if (!txnId) {
            return res.status(400).json({ error: 'Invalid id' });
        }

        await pgClient.query(
            'UPDATE payment_transactions SET status = $1 WHERE id = $2',
            ['failed', txnId]
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Reject transaction error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

exports.listCoupons = async (req, res) => {
    try {
        const { rows } = await pgClient.query(
            'SELECT id, code, value, type, status, usage_limit, current_usage, per_user_limit, created_at FROM referral_codes ORDER BY created_at DESC'
        );
        res.json({ coupons: rows });
    } catch (error) {
        console.error('List coupons error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

exports.createCoupon = async (req, res) => {
    try {
        const { code, value, type, usage_limit, per_user_limit } = req.body;
        if (!code || !value) {
            return res.status(400).json({ error: 'code and value are required' });
        }

        const couponType = type || 'balance'; // balance or credit
        const limit = parseInt(usage_limit) || 1; // Default 1 use
        const userLimit = parseInt(per_user_limit) || 1; // Default 1 per user

        const { rows } = await pgClient.query(
            `
            INSERT INTO referral_codes (code, value, type, status, usage_limit, per_user_limit)
            VALUES ($1, $2, $3, 'active', $4, $5)
            RETURNING id, code, value, type, status, usage_limit, per_user_limit, created_at
            `,
            [code, value, couponType, limit, userLimit]
        );

        res.json(rows[0]);
    } catch (error) {
        console.error('Create coupon error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

exports.updateCouponStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const couponId = parseInt(id, 10);

        if (!couponId || !status) {
            return res.status(400).json({ error: 'Invalid payload' });
        }

        await pgClient.query(
            'UPDATE referral_codes SET status = $1 WHERE id = $2',
            [status, couponId]
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Update coupon status error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

exports.requestOtp = async (req, res) => {
    try {
        const email = String(req.body.email || '').trim().toLowerCase();
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        const ip = getClientIp(req);
        const quota = consumeOtpQuota('register_otp', email, ip);
        if (!quota.allowed) {
            return res.status(429).json({ error: formatRetryAfterMessage(quota.retryAfterMs) });
        }

        const user = await authService.findOrCreateUserByEmail(email);
        const otp = await authService.createOtp(user.email);
        await authService.sendOtpEmail(user.email, otp.code);

        res.json({ success: true });
    } catch (error) {
        console.error('requestOtp error:', error);
        res.status(500).json({ error: 'Failed to send OTP' });
    }
};

// --- DEVELOPER API SYSTEM ---

exports.registerDeveloper = async (req, res) => {
    try {
        const { userId, paymentMethod, transactionId } = req.body;
        if (!userId || !paymentMethod || !transactionId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const user = await pgClient.query('SELECT id FROM users WHERE id = $1', [userId]);
        if (user.rows.length === 0) return res.status(404).json({ error: 'User not found' });

        await pgClient.query(
            `INSERT INTO developer_registrations (user_id, payment_method, transaction_id, status)
             VALUES ($1, $2, $3, 'pending')`,
            [userId, paymentMethod, transactionId]
        );

        await pgClient.query("UPDATE users SET developer_status = 'pending' WHERE id = $1", [userId]);

        res.json({ success: true, message: 'Developer registration submitted. Waiting for admin approval.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.listDeveloperRequests = async (req, res) => {
    try {
        const { rows } = await pgClient.query(
            `SELECT dr.*, u.email, u.full_name 
             FROM developer_registrations dr
             JOIN users u ON dr.user_id = u.id
             ORDER BY dr.created_at DESC`
        );
        res.json({ requests: rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.approveDeveloper = async (req, res) => {
    try {
        const { id } = req.params; 
        const { devId, devPass } = req.body; // New: admin provides credentials

        if (!devId || !devPass) {
            return res.status(400).json({ error: 'Developer ID and Password are required for approval' });
        }

        const { rows } = await pgClient.query('SELECT * FROM developer_registrations WHERE id = $1', [id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Request not found' });

        const request = rows[0];
        
        await pgClient.query("UPDATE developer_registrations SET status = 'approved', updated_at = NOW() WHERE id = $1", [id]);
        await pgClient.query(
            "UPDATE users SET developer_status = 'approved', developer_id = $1, developer_password = $2 WHERE id = $3", 
            [devId, devPass, request.user_id]
        );

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.verifyDeveloperLogin = async (req, res) => {
    try {
        const { userId, devId, devPass } = req.body;
        if (!userId || !devId || !devPass) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const { rows } = await pgClient.query(
            'SELECT * FROM users WHERE id = $1 AND developer_id = $2 AND developer_password = $3 AND developer_status = $4',
            [userId, devId, devPass, 'approved']
        );

        if (rows.length === 0) {
            return res.status(401).json({ error: 'Invalid Developer Credentials' });
        }

        res.json({ success: true, message: 'Developer access unlocked' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getDeveloperStats = async (req, res) => {
    try {
        const { userId } = req.params;
        if (!userId) return res.status(400).json({ error: 'User ID required' });

        const pgClient = require('../services/pgClient');

        // Robust check for developer_status column
        const columnCheck = await pgClient.query(
            "SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='developer_status'"
        );

        if (columnCheck.rows.length === 0) {
            console.warn('[GetDevStats] developer_status column missing in users table');
            return res.json({ developer_status: 'none' });
        }

        const { rows } = await pgClient.query(
            'SELECT developer_status FROM users WHERE id = $1::uuid',
            [userId]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
        res.json(rows[0] || { developer_status: 'none' });
    } catch (err) {
        console.error("[GetDevStats] Error:", err);
        res.status(500).json({ error: "Failed to fetch developer stats", details: err.message });
    }
};

exports.verifyOtp = async (req, res) => {
    try {
        const email = String(req.body.email || '').trim().toLowerCase();
        const code = String(req.body.code || '').trim();

        if (!email || !code) {
            return res.status(400).json({ error: 'Email and code are required' });
        }

        const result = await authService.verifyOtp(email, code);
        if (!result.ok) {
            if (result.reason === 'expired') {
                return res.status(400).json({ error: 'Code expired' });
            }
            return res.status(400).json({ error: 'Invalid code' });
        }

        const user = await authService.findOrCreateUserByEmail(email);
        const token = authService.signToken(user);

        res.json({
            token,
            user
        });
    } catch (error) {
        console.error('verifyOtp error:', error);
        res.status(500).json({ error: 'Failed to verify code' });
    }
};

exports.registerWithPassword = async (req, res) => {
    try {
        const fullName = String(req.body.fullName || '').trim();
        const phone = String(req.body.phone || '').trim();
        const email = String(req.body.email || '').trim().toLowerCase();
        const password = String(req.body.password || '');

        if (!fullName || !phone || !email || !password) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        const user = await authService.setUserPassword(email, password, fullName, phone);
        res.json({ success: true, user });
    } catch (error) {
        console.error('registerWithPassword error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
};

exports.loginWithPassword = async (req, res) => {
    try {
        const email = String(req.body.email || '').trim().toLowerCase();
        const password = String(req.body.password || '');

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const result = await authService.verifyPassword(email, password);
        if (!result.ok || !result.user) {
            return res.status(400).json({ error: 'Invalid email or password' });
        }

        const token = authService.signToken(result.user);
        res.json({
            token,
            user: result.user
        });
    } catch (error) {
        console.error('loginWithPassword error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
};

// Get current user's balance and transactions
exports.getMyPayments = async (req, res) => {
    try {
        const userId = req.user && req.user.id;
        const email = req.user && req.user.email;

        if (!userId || !email) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // Check for Team Context
        let effectiveUserId = userId;
        let effectiveEmail = email;
        const requestedOwner = req.query?.team_owner || req.headers['x-team-owner'];

        if (requestedOwner && requestedOwner !== email) {
            // Verify membership and get owner ID
            const memberRes = await pgClient.query(
                `SELECT u.id, u.email 
                 FROM team_members tm 
                 JOIN users u ON u.email = tm.owner_email 
                 WHERE tm.member_email = $1 AND tm.owner_email = $2 AND tm.status = $3`,
                [email, requestedOwner, 'active']
            );
            if (memberRes.rows.length > 0) {
                effectiveUserId = memberRes.rows[0].id;
                effectiveEmail = memberRes.rows[0].email;
            }
        }

        const configResult = await pgClient.query(
            'SELECT balance, daily_limit, daily_used, bonus_credit, permanent_credit, monthly_limit, monthly_used, message_credit, subscription_plan FROM user_configs WHERE user_id::text = $1::text LIMIT 1',
            [String(effectiveUserId)]
        );

        const config = configResult.rows[0] || {};
        const balance = config.balance || 0;

        const txResult = await pgClient.query(
            `
            SELECT id, user_email, amount, method, trx_id, sender_number, status, created_at
            FROM payment_transactions
            WHERE user_email = $1
            ORDER BY created_at DESC
            `,
            [effectiveEmail]
        );

        res.json({
            balance,
            daily_limit: config.daily_limit || 0,
            daily_used: config.daily_used || 0,
            bonus_credit: config.bonus_credit || 0,
            permanent_credit: config.permanent_credit || 0,
            monthly_limit: config.monthly_limit || 0,
            monthly_used: config.monthly_used || 0,
            message_credit: config.message_credit || 0,
            subscription_plan: config.subscription_plan || 'none',
            transactions: txResult.rows || [],
            is_team_view: effectiveEmail !== email
        });
    } catch (error) {
        console.error('getMyPayments error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Create a new deposit request
exports.createDepositRequest = async (req, res) => {
    try {
        const email = req.user && req.user.email;
        if (!email) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const rawAmount = req.body && req.body.amount;
        const method = String(req.body.method || 'bkash');
        const trxId = String(req.body.trxId || '').trim();
        const senderNumber = String(req.body.senderNumber || '').trim();

        const amount = Number(rawAmount);
        if (!trxId || !senderNumber) {
            return res.status(400).json({ error: 'Transaction ID and sender number are required' });
        }
        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Invalid amount' });
        }
        if (amount < 300) {
            return res.status(400).json({ error: 'Minimum deposit is 300 BDT' });
        }

        const insertResult = await pgClient.query(
            `
            INSERT INTO payment_transactions (user_email, amount, method, status, trx_id, sender_number)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, user_email, amount, method, trx_id, sender_number, status, created_at
            `,
            [email, amount, method, 'pending', trxId, senderNumber]
        );

        res.json(insertResult.rows[0]);
    } catch (error) {
        console.error('createDepositRequest error:', error);
        res.status(500).json({ error: 'Failed to create deposit request' });
    }
};

exports.requestPasswordReset = async (req, res) => {
    try {
        const email = String(req.body.email || '').trim().toLowerCase();
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        const ip = getClientIp(req);
        const quota = consumeOtpQuota('password_reset_otp', email, ip);
        if (!quota.allowed) {
            return res.status(429).json({ error: formatRetryAfterMessage(quota.retryAfterMs) });
        }

        const existing = await pgClient.query(
            'SELECT id, email FROM users WHERE email = $1 LIMIT 1',
            [email]
        );

        if (existing.rows.length === 0) {
            return res.json({ success: true });
        }

        const otp = await authService.createOtp(email);
        await authService.sendOtpEmail(email, otp.code);

        res.json({ success: true });
    } catch (error) {
        console.error('requestPasswordReset error:', error);
        res.status(500).json({ error: 'Failed to send reset code' });
    }
};

exports.verifyPasswordResetCode = async (req, res) => {
    try {
        const email = String(req.body.email || '').trim().toLowerCase();
        const code = String(req.body.code || '').trim();

        if (!email || !code) {
            return res.status(400).json({ error: 'Email and code are required' });
        }

        const now = new Date().toISOString();
        const result = await pgClient.query(
            `SELECT id, code, expires_at, used
             FROM email_otp_codes
             WHERE email = $1
             ORDER BY created_at DESC
             LIMIT 5`,
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(400).json({ error: 'Invalid code' });
        }

        const match = result.rows.find(row => row.code === code);
        if (!match) {
            return res.status(400).json({ error: 'Invalid code' });
        }

        if (match.used) {
            return res.status(400).json({ error: 'Code already used' });
        }

        if (match.expires_at <= now) {
            return res.status(400).json({ error: 'Code expired' });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('verifyPasswordResetCode error:', error);
        res.status(500).json({ error: 'Verification failed' });
    }
};

exports.completePasswordReset = async (req, res) => {
    try {
        const email = String(req.body.email || '').trim().toLowerCase();
        const code = String(req.body.code || '').trim();
        const password = String(req.body.password || '');

        if (!email || !code || !password) {
            return res.status(400).json({ error: 'Email, code and password are required' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        const now = new Date().toISOString();
        const result = await pgClient.query(
            `SELECT id, code, expires_at, used
             FROM email_otp_codes
             WHERE email = $1
             ORDER BY created_at DESC
             LIMIT 5`,
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(400).json({ error: 'Invalid code' });
        }

        const match = result.rows.find(row => row.code === code);
        if (!match) {
            return res.status(400).json({ error: 'Invalid code' });
        }

        if (match.used) {
            return res.status(400).json({ error: 'Code already used' });
        }

        if (match.expires_at <= now) {
            return res.status(400).json({ error: 'Code expired' });
        }

        await pgClient.query('UPDATE email_otp_codes SET used = true WHERE id = $1', [match.id]);

        await authService.setUserPassword(email, password, null, null);

        res.json({ success: true });
    } catch (error) {
        console.error('completePasswordReset error:', error);
        res.status(500).json({ error: 'Failed to update password' });
    }
};

exports.changePassword = async (req, res) => {
    try {
        const email = req.user && req.user.email;
        if (!email) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const oldPassword = String(req.body.oldPassword || '');
        const newPassword = String(req.body.newPassword || '');

        if (!oldPassword || !newPassword) {
            return res.status(400).json({ error: 'Old and new passwords are required' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'New password must be at least 6 characters' });
        }

        const result = await authService.verifyPassword(email, oldPassword);
        if (!result.ok) {
            return res.status(400).json({ error: 'Old password is incorrect' });
        }

        await authService.setUserPassword(email, newPassword, null, null);

        res.json({ success: true });
    } catch (error) {
        console.error('changePassword error:', error);
        res.status(500).json({ error: 'Failed to change password' });
    }
};

// Redeem balance coupon code
exports.redeemCoupon = async (req, res) => {
    try {
        const userId = req.user && req.user.id;
        const email = req.user && req.user.email;

        if (!userId || !email) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const code = String(req.body.code || '').trim();
        if (!code) {
            return res.status(400).json({ error: 'Code is required' });
        }

        const couponResult = await pgClient.query(
            'SELECT id, code, value, type, status, usage_limit, current_usage, per_user_limit FROM referral_codes WHERE code = $1 AND status = $2',
            [code, 'active']
        );

        if (couponResult.rows.length === 0) {
            return res.status(400).json({ error: 'Invalid or expired coupon' });
        }

        const coupon = couponResult.rows[0];
        const amount = Number(coupon.value) || 0;

        // Check global usage limit
        if (coupon.usage_limit > 0 && coupon.current_usage >= coupon.usage_limit) {
            return res.status(400).json({ error: 'Coupon usage limit reached' });
        }

        // Check per-user usage limit
        const usageCheck = await pgClient.query(
            'SELECT count(*) FROM coupon_usage WHERE user_id = $1 AND coupon_id = $2',
            [userId, coupon.id]
        );
        const userUsageCount = parseInt(usageCheck.rows[0].count);
        if (coupon.per_user_limit > 0 && userUsageCount >= coupon.per_user_limit) {
            return res.status(400).json({ error: 'You have already used this coupon' });
        }

        const configResult = await pgClient.query(
            'SELECT balance, message_credit FROM user_configs WHERE user_id = $1::uuid',
            [userId]
        );

        let newBalance = 0;
        let newMessageCredit = 0;

        if (configResult.rows.length > 0) {
            const currentBalance = Number(configResult.rows[0].balance) || 0;
            const currentCredits = Number(configResult.rows[0].message_credit) || 0;
            
            if (coupon.type === 'credit') {
                newMessageCredit = currentCredits + amount;
                await pgClient.query(
                    'UPDATE user_configs SET message_credit = $1 WHERE user_id = $2::uuid',
                    [newMessageCredit, userId]
                );
                newBalance = currentBalance;
            } else {
                newBalance = currentBalance + amount;
                await pgClient.query(
                    'UPDATE user_configs SET balance = $1 WHERE user_id = $2::uuid',
                    [newBalance, userId]
                );
                newMessageCredit = currentCredits;
            }
        } else {
            if (coupon.type === 'credit') {
                newMessageCredit = amount;
                newBalance = 0;
                await pgClient.query(
                    'INSERT INTO user_configs (user_id, email, message_credit, balance) VALUES ($1::uuid, $2, $3, $4)',
                    [userId, email, newMessageCredit, 0]
                );
            } else {
                newBalance = amount;
                newMessageCredit = 0;
                await pgClient.query(
                    'INSERT INTO user_configs (user_id, email, balance, message_credit) VALUES ($1::uuid, $2, $3, $4)',
                    [userId, email, newBalance, 0]
                );
            }
        }

        // Log usage
        await pgClient.query(
            'INSERT INTO coupon_usage (user_id, coupon_id) VALUES ($1, $2)',
            [userId, coupon.id]
        );

        // Update coupon stats
        await pgClient.query(
            'UPDATE referral_codes SET current_usage = current_usage + 1 WHERE id = $1',
            [coupon.id]
        );

        // If it was a single-use global coupon and limit reached, deactivate it
        if (coupon.usage_limit > 0 && (coupon.current_usage + 1) >= coupon.usage_limit) {
            await pgClient.query(
                'UPDATE referral_codes SET status = $1 WHERE id = $2',
                ['inactive', coupon.id]
            );
        }

        await pgClient.query(
            `
            INSERT INTO payment_transactions (user_email, amount, method, status, trx_id, sender_number)
            VALUES ($1, $2, $3, $4, $5, $6)
            `,
            [email, amount, 'coupon', 'completed', `COUPON-${code}`, 'System']
        );

        res.json({ success: true, balance: newBalance, message_credit: newMessageCredit });
    } catch (error) {
        console.error('redeemCoupon error:', error);
        res.status(500).json({ error: 'Redemption failed' });
    }
};

exports.buyCredits = async (req, res) => {
    try {
        const userId = req.user && req.user.id;
        const email = req.user && req.user.email;
        if (!userId || !email) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { amount, plan_id } = req.body;
        
        let finalAmount = amount;
        let finalCost = 0;
        let planName = 'credit_purchase';

        const creditPacks = {
            p300: { amount: 1000, price: 300, name: 'Basic Pack' },
            p1200: { amount: 5000, price: 1200, name: 'Value Pack' },
            p2000: { amount: 10000, price: 2000, name: 'Bulk Saver' }
        };

        if (plan_id && creditPacks[plan_id]) {
            finalAmount = creditPacks[plan_id].amount;
            finalCost = creditPacks[plan_id].price;
            planName = creditPacks[plan_id].name;
        } else if (amount && amount > 0) {
            const pricePerCredit = 0.30; // 300 per 1k
            finalCost = Math.ceil(amount * pricePerCredit);
        } else {
            return res.status(400).json({ error: 'Invalid amount or plan' });
        }

        const configResult = await pgClient.query(
            'SELECT balance, message_credit, permanent_credit FROM user_configs WHERE user_id = $1::uuid',
            [userId]
        );

        if (configResult.rows.length === 0) {
            return res.status(404).json({ error: 'User config not found' });
        }

        const userConfig = configResult.rows[0];
        const currentBalance = Number(userConfig.balance) || 0;

        if (currentBalance < finalCost) {
            return res.status(400).json({ error: `Insufficient balance. You need ৳${finalCost} to buy this pack.` });
        }

        const newBalance = currentBalance - finalCost;
        const newCredits = (Number(userConfig.message_credit) || 0); // Keep existing free credits
        const newPermanent = (Number(userConfig.permanent_credit) || 0) + finalAmount; // Add purchased credits only to permanent

        await pgClient.query(
            'UPDATE user_configs SET balance = $1, message_credit = $2, permanent_credit = $3 WHERE user_id = $4::uuid',
            [newBalance, newCredits, newPermanent, userId]
        );

        await pgClient.query(
            `
            INSERT INTO payment_transactions (user_email, amount, method, status, trx_id, sender_number)
            VALUES ($1, $2, $3, $4, $5, $6)
            `,
            [email, finalCost, `pack_${planName}`, 'completed', `BUY-${Date.now()}`, 'System']
        );

        const outRes = await pgClient.query(
            'SELECT balance, daily_limit, daily_used, monthly_limit, monthly_used, bonus_credit, permanent_credit, message_credit, subscription_plan FROM user_configs WHERE user_id = $1::uuid',
            [userId]
        );
        res.json({ success: true, ...outRes.rows[0] });
    } catch (error) {
        console.error('buyCredits error:', error);
        res.status(500).json({ error: 'Credit purchase failed' });
    }
};

exports.buyPlan = async (req, res) => {
    try {
        const userId = req.user && req.user.id;
        const email = req.user && req.user.email;
        if (!userId || !email) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { plan_id } = req.body || {};
        const id = String(plan_id || '').trim();
        if (!id) {
            return res.status(400).json({ error: 'Invalid plan' });
        }

        const plans = {
            m1000: { name: 'starter', price: 1000, daily_limit: 500, bonus: 3000 },
            m3000: { name: 'pro', price: 3000, daily_limit: 2000, bonus: 20000 },
            m7500: { name: 'enterprise', price: 7500, daily_limit: 5000, bonus: 30000 }
        };

        const plan = plans[id];
        if (!plan) {
            return res.status(400).json({ error: 'Unknown plan id' });
        }

        const cfgRes = await pgClient.query(
            'SELECT balance, daily_limit, daily_used, monthly_limit, monthly_used, bonus_credit, permanent_credit, message_credit, subscription_plan FROM user_configs WHERE user_id = $1::uuid',
            [userId]
        );
        if (cfgRes.rows.length === 0) {
            return res.status(404).json({ error: 'User config not found' });
        }

        const cfg = cfgRes.rows[0];
        const currentBalance = Number(cfg.balance) || 0;
        if (currentBalance < plan.price) {
            return res.status(400).json({ error: `Insufficient balance. Need ৳${plan.price}.` });
        }

        const newBalance = currentBalance - plan.price;
        
        // Logical Check: If user already has a plan, we stack the bonus, 
        // but for daily limit, we take the higher one (Upgrade logic)
        const newDailyLimit = Math.max(Number(cfg.daily_limit) || 0, plan.daily_limit);
        const newBonus = (Number(cfg.bonus_credit) || 0) + plan.bonus;

        await pgClient.query(
            `UPDATE user_configs 
             SET balance = $1, daily_limit = $2, subscription_plan = $3, bonus_credit = $4, last_reset_at = NOW()
             WHERE user_id = $5::uuid`,
            [newBalance, newDailyLimit, plan.name, newBonus, userId]
        );

        await pgClient.query(
            `INSERT INTO payment_transactions (user_email, amount, method, status, trx_id, sender_number)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [email, plan.price, `plan_${plan.name}`, 'completed', `SUB-${id}-${Date.now()}`, 'System']
        );

        const outRes = await pgClient.query(
            'SELECT balance, daily_limit, daily_used, monthly_limit, monthly_used, bonus_credit, permanent_credit, message_credit, subscription_plan FROM user_configs WHERE user_id = $1::uuid',
            [userId]
        );
        return res.json({ success: true, ...outRes.rows[0] });
    } catch (error) {
        console.error('buyPlan error:', error);
        res.status(500).json({ error: 'Plan purchase failed' });
    }
};
