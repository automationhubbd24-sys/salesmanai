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

        req.admin = {
            role: payload.role
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
