const express = require('express');
const runtimeMonitor = require('../services/runtimeMonitor');

const router = express.Router();

function requireAuditToken(req, res, next) {
    if (process.env.ENABLE_RUNTIME_AUDIT === 'false') {
        return res.status(404).json({ error: 'Not Found' });
    }

    const expectedToken = process.env.RUNTIME_AUDIT_TOKEN;
    if (!expectedToken) {
        return res.status(503).json({ error: 'Runtime audit is not configured' });
    }

    const providedToken = req.headers['x-audit-token'];
    if (providedToken !== expectedToken) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    next();
}

router.get('/', requireAuditToken, (req, res) => {
    const windowMs = req.query.windowMs ? Number(req.query.windowMs) : undefined;
    res.json(runtimeMonitor.getHealth({ windowMs }));
});

router.get('/recent', requireAuditToken, (req, res) => {
    const limit = Math.min(Number(req.query.limit || 100), 500);
    res.json(runtimeMonitor.getRecent(limit));
});

module.exports = router;
