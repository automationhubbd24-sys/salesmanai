const pgClient = require('../services/pgClient');

const developerAuthMiddleware = async (req, res, next) => {
    try {
        const userId = req.user.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized: No user ID found' });
        }

        const { rows } = await pgClient.query(
            'SELECT developer_status, is_admin FROM users WHERE id = $1',
            [userId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = rows[0];
        if (user.developer_status === 'approved') {
            return next();
        }

        return res.status(403).json({ 
            error: 'Forbidden: Developer access not approved',
            status: 'unapproved'
        });
    } catch (err) {
        console.error('[DeveloperAuthMiddleware] Error:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

module.exports = developerAuthMiddleware;
