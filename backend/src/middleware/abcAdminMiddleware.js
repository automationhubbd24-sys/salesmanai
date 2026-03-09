module.exports = (req, res, next) => {
    // This middleware assumes adminAuthMiddleware has already run and populated req.admin
    if (!req.admin || req.admin.username !== 'abcadmin') {
        return res.status(403).json({ 
            error: 'Access Denied', 
            message: 'Only superadmin (abcadmin) can access this resource.' 
        });
    }
    next();
};
