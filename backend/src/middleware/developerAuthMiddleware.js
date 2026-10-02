const developerAuthMiddleware = async (req, res, next) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized: No user ID found' });
        }

        const pgClient = require('../services/pgClient');

        // Robust check for developer_status and is_admin columns
        const columnCheck = await pgClient.query(
            "SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name IN ('developer_status', 'is_admin')"
        );

        const hasDevStatus = columnCheck.rows.some(r => r.column_name === 'developer_status');
        const hasIsAdmin = columnCheck.rows.some(r => r.column_name === 'is_admin');

        if (!hasDevStatus) {
            console.warn('[DeveloperAuthMiddleware] developer_status column missing in users table');
            return res.status(403).json({ 
                error: 'Forbidden: Developer system not fully initialized',
                status: 'none'
            });
        }

        const queryStr = `SELECT developer_status${hasIsAdmin ? ', is_admin' : ''} FROM users WHERE id = $1::uuid`;
        const { rows } = await pgClient.query(queryStr, [userId]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = rows[0];
        const isAdmin = hasIsAdmin ? user.is_admin : false;
        
        // Admins always have access, or if status is approved
        if (isAdmin || user.developer_status === 'approved') {
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
