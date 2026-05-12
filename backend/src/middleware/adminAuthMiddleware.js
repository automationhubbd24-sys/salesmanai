const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Missing or invalid Authorization header' });
        }

        const token = authHeader.replace('Bearer ', '');
        const secret = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET || process.env.ADMIN_PASSWORD;
        if (!secret) {
            throw new Error('Admin auth secret is not configured');
        }

        const payload = jwt.verify(token, secret);

        if (!payload || payload.role !== 'admin') {
            return res.status(403).json({ error: 'Forbidden' });
        }

        // --- SILENT TOKEN REFRESH (Auto-Fix for session expiration) ---
        const now = Math.floor(Date.now() / 1000);
        const sixtyDaysInSeconds = 60 * 24 * 60 * 60;
        if (payload.exp && (payload.exp - now) < sixtyDaysInSeconds) {
            try {
                const newToken = jwt.sign(
                    { role: 'admin', username: payload.username },
                    secret,
                    { expiresIn: '90d' }
                );
                res.setHeader('X-Refresh-Token', newToken);
                res.setHeader('Access-Control-Expose-Headers', 'X-Refresh-Token');
            } catch (e) {
                console.error('[Admin Auth] Failed to issue refresh token:', e.message);
            }
        }

        req.admin = {
            role: payload.role,
            username: payload.username
        };
        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }
        console.error('Admin Auth Middleware Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};
