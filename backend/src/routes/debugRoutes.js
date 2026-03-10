const express = require('express');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const fs = require('fs');
const path = require('path');
const router = express.Router();

// --- NEW: AI Log Viewer ---
router.get('/ai-logs', (req, res) => {
    try {
        const logPath = path.join(__dirname, '../../logs/ai.log');
        if (!fs.existsSync(logPath)) {
            return res.status(404).json({ error: 'Log file not found' });
        }

        // Get last N lines
        const lines = req.query.lines ? parseInt(req.query.lines) : 100;
        const content = fs.readFileSync(logPath, 'utf8');
        const allLines = content.split('\n');
        const lastLines = allLines.slice(-lines).join('\n');

        res.type('text/plain').send(lastLines);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- NEW: Clear AI Logs ---
router.get('/clear-ai-logs', (req, res) => {
    try {
        const logPath = path.join(__dirname, '../../logs/ai.log');
        if (fs.existsSync(logPath)) {
            fs.writeFileSync(logPath, '');
        }
        res.json({ ok: true, message: 'AI logs cleared' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

function buildProxyUrlFromHeaders(req) {
    const hdrUser = (req.header('x-brd-user') || '').replace(/['"]/g, '').trim();
    const hdrPass = (req.header('x-brd-pass') || '').replace(/['"]/g, '').trim();
    const hdrHost = (req.header('x-brd-host') || process.env.BRIGHT_DATA_PROXY_URL || 'brd.superproxy.io:33335')
        .replace(/^https?:\/\//, '').replace(/['"]/g, '').trim();
    if (!hdrUser || !hdrPass) return null;
    const session = `sess${Math.floor(Math.random() * 9999999)}`;
    return `http://${hdrUser}-session-${session}:${hdrPass}@${hdrHost}`;
}

router.get('/proxy', async (req, res) => {
    try {
        // Token check disabled for testing as per user request
        /*
        const token = req.header('x-debug-token') || req.query.token || '';
        const allowToken = process.env.DEBUG_ADMIN_TOKEN || '';
        if (!allowToken || token !== allowToken) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        */

        const fromHeaders = buildProxyUrlFromHeaders(req);
        let proxyUrl = fromHeaders;
        if (!proxyUrl) {
            // Fallback to env (uses aiService logic variables)
            const user = (process.env.BRIGHT_DATA_USER || '').replace(/['"]/g, '').trim();
            const pass = (process.env.BRIGHT_DATA_PASS || '').replace(/['"]/g, '').trim();
            const host = (process.env.BRIGHT_DATA_PROXY_URL || 'brd.superproxy.io:33335')
                .replace(/^https?:\/\//, '').replace(/['"]/g, '').trim();
            if (user && pass) {
                const session = `sess${Math.floor(Math.random() * 9999999)}`;
                proxyUrl = `http://${user}-session-${session}:${pass}@${host}`;
            }
        }

        if (!proxyUrl) {
            return res.status(400).json({ error: 'Missing proxy credentials' });
        }

        const agent = new HttpsProxyAgent(proxyUrl);
        const target = req.query.target === 'txt'
            ? 'https://geo.brdtest.com/welcome.txt?product=dc&method=native'
            : 'https://geo.brdtest.com/mygeo.json';

        const response = await axios.get(target, {
            httpsAgent: agent,
            httpAgent: agent,
            proxy: false,
            timeout: 12000
        });

        const data = typeof response.data === 'string' ? response.data : JSON.stringify(response.data, null, 2);
        return res.json({
            ok: true,
            via: fromHeaders ? 'headers' : 'env',
            target,
            status: response.status,
            headers: {
                'content-type': response.headers['content-type'],
                'content-encoding': response.headers['content-encoding']
            },
            body_preview: String(data).slice(0, 400)
        });
    } catch (err) {
        return res.status(500).json({
            ok: false,
            message: err.message,
            status: err.response?.status || null,
            data: err.response?.data || null
        });
    }
});

module.exports = router;

