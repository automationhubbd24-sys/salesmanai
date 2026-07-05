module.exports = (req, res, next) => {
    // This middleware assumes adminAuthMiddleware has already run and populated req.admin
    const superadminUser = process.env.ADMIN_USERNAME || 'abcadmin';
    
    if (!req.admin) {
        return res.status(401).json({ error: 'Unauthorized', message: 'Admin authentication required.' });
    }

    if (req.admin.username !== superadminUser) {
        console.warn(`[Security] Access Denied: User '${req.admin.username}' tried to access superadmin resource. Required: '${superadminUser}'`);
        return res.status(403).json({ 
            error: 'Access Denied', 
            message: `Only superadmin (${superadminUser}) can access this resource. You are logged in as '${req.admin.username}'. Please logout and login as '${superadminUser}'.` 
        });
    }
    next();
};
