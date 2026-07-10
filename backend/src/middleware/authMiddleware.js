
const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Missing or invalid Authorization header' });
        }

        const token = authHeader.replace('Bearer ', '');
        const secret = process.env.JWT_SECRET;
        if (!secret) {
            throw new Error('JWT_SECRET is not configured');
        }

        const payload = jwt.verify(token, secret);
        req.user = {
            id: payload.sub,
            email: payload.email
        };

        // --- SILENT TOKEN REFRESH (Auto-Fix for session expiration) ---
        // If token is valid but has less than 60 days left (out of 90), issue a new one
        const now = Math.floor(Date.now() / 1000);
        const sixtyDaysInSeconds = 60 * 24 * 60 * 60;
        if (payload.exp && (payload.exp - now) < sixtyDaysInSeconds) {
            try {
                const newToken = jwt.sign(
                    { sub: payload.sub, email: payload.email },
                    secret,
                    { expiresIn: '90d' }
                );
                res.setHeader('X-Refresh-Token', newToken);
                res.setHeader('Access-Control-Expose-Headers', 'X-Refresh-Token');
            } catch (e) {
                console.error('[Auth] Failed to issue refresh token:', e.message);
            }
        }

        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }
        console.error('Auth Middleware Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};
