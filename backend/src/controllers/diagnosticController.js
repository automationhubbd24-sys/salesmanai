const diagnosticService = require('../services/diagnosticService');

function adminName(req) {
    return req.admin?.username || req.user?.email || 'admin';
}

exports.listConfigs = async (req, res) => {
    try {
        const configs = await diagnosticService.listTraceConfigs();
        res.json({ success: true, configs });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.enableTrace = async (req, res) => {
    try {
        const config = await diagnosticService.enableTrace({
            pageId: req.body.page_id,
            platform: req.body.platform || 'all',
            traceLevel: req.body.trace_level || 'full',
            expiresInHours: req.body.expires_in_hours || 48,
            reason: req.body.reason || null,
            admin: adminName(req)
        });
        res.json({ success: true, config });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.disableTrace = async (req, res) => {
    try {
        const config = await diagnosticService.disableTrace({
            pageId: req.body.page_id || req.params.pageId,
            platform: req.body.platform || req.query.platform || 'all',
            admin: adminName(req)
        });
        res.json({ success: true, config });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.listReports = async (req, res) => {
    try {
        const reports = await diagnosticService.listReports({
            status: req.query.status,
            pageId: req.query.page_id,
            limit: req.query.limit
        });
        res.json({ success: true, reports });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getReport = async (req, res) => {
    try {
        const report = await diagnosticService.getReport(req.params.reportId);
        if (!report) return res.status(404).json({ success: false, error: 'Report not found' });
        res.json({ success: true, report });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
};

exports.updateReport = async (req, res) => {
    try {
        const report = await diagnosticService.updateReportStatus({
            reportId: req.params.reportId,
            status: req.body.status,
            rootCause: req.body.root_cause,
            resolutionNote: req.body.resolution_note,
            resolvedBy: adminName(req)
        });
        res.json({ success: true, report });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getTrace = async (req, res) => {
    try {
        const trace = await diagnosticService.getTrace(req.params.traceId);
        if (!trace) return res.status(404).json({ success: false, error: 'Trace not found' });
        res.json({ success: true, trace });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getStatus = async (req, res) => {
    try {
        const status = await diagnosticService.isTraceEnabled(req.query.page_id, req.query.platform || 'all');
        res.json({ success: true, ...status });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
};

exports.reportMessage = async (req, res) => {
    try {
        const report = await diagnosticService.reportMessage({
            pageId: req.body.page_id,
            platform: req.body.platform,
            senderId: req.body.sender_id,
            messageId: req.params.messageId || req.body.message_id,
            reportType: req.body.report_type || 'other',
            note: req.body.note || null,
            reportedBy: req.body.reported_by || 'owner'
        });
        res.json({ success: true, report });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
};
