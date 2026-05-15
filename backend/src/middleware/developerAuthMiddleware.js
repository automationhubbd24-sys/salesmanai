const developerAuthMiddleware = async (req, res, next) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized: No user ID found' });
        }

        const pgClient = require('../services/pgClient');

        // Robust check for developer_status column
        const columnCheck = await pgClient.query(
            "SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='developer_status'"
        );

        if (columnCheck.rows.length === 0) {
            console.warn('[DeveloperAuthMiddleware] developer_status column missing in users table');
            // If column is missing, user can't be approved. 
            // We treat this as "none" but since this middleware is for protected routes, we deny access.
            return res.status(403).json({ 
                error: 'Forbidden: Developer system not fully initialized',
                status: 'none'
            });
        }

        const { rows } = await pgClient.query(
            'SELECT developer_status, is_admin FROM users WHERE id = $1::uuid',
            [userId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = rows[0];
        
        // Admins always have access, or if status is approved
        if (user.is_admin || user.developer_status === 'approved') {
            return next();
        }

        return res.status(403).json({ 
            error: 'Forbidden: Developer access not approved',
            status: user.developer_status || 'none'
        });
    } catch (err) {
        console.error('[DeveloperAuthMiddleware] Exception:', err);
        res.status(500).json({ 
            error: 'Internal Server Error', 
            details: err.message,
            hint: "Check if migrations were run correctly" 
        });
    }
};

module.exports = developerAuthMiddleware;
