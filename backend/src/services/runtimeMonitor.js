const MAX_EVENTS = Number(process.env.RUNTIME_AUDIT_MAX_EVENTS || 1000);
const DEFAULT_WINDOW_MS = Number(process.env.RUNTIME_AUDIT_WINDOW_MS || 15 * 60 * 1000);

const latencyEvents = [];
const errorEvents = [];
const bootedAt = Date.now();

function pushBounded(list, item) {
    list.push(item);
    if (list.length > MAX_EVENTS) list.splice(0, list.length - MAX_EVENTS);
}

function maskId(value) {
    const text = String(value || 'unknown');
    if (text.length <= 10) return text;
    return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

function classifyError(message = '') {
    const text = String(message);
    if (/generateImage is not defined/i.test(text)) return 'generate_image_export';
    if (/getEmbedding is not a function/i.test(text)) return 'get_embedding_export';
    if (/Missing Authentication header/i.test(text)) return 'vision_auth_missing';
    if (/\b401\b|\b403\b/i.test(text)) return 'auth_http_error';
    if (/\b429\b/i.test(text)) return 'rate_limit';
    if (/\b500\b|\b503\b/i.test(text)) return 'provider_5xx';
    if (/ReferenceError|TypeError|Unhandled/i.test(text)) return 'runtime_exception';
    return 'error';
}

function recordLatency(platform, event = {}) {
    const elapsedMs = Number(event.elapsedMs || 0);
    pushBounded(latencyEvents, {
        ts: Date.now(),
        platform,
        sessionId: event.sessionId || null,
        stage: event.stage || 'unknown',
        elapsedMs,
        imageCount: Number(event.imageCount || 0),
        audioCount: Number(event.audioCount || 0),
        isLocked: event.isLocked === undefined ? undefined : Boolean(event.isLocked),
        hasReply: event.hasReply === undefined ? undefined : Boolean(event.hasReply),
        model: event.model || null,
        lane: event.lane || null,
        provider: event.provider || null,
        endpointIndex: event.endpointIndex || null,
        loopCount: event.loopCount || null,
        tokenUsage: event.tokenUsage || null,
        phase: event.phase || null,
        hasProductContext: event.hasProductContext === undefined ? undefined : Boolean(event.hasProductContext),
        historyCount: event.historyCount || null,
        processedHistoryCount: event.processedHistoryCount || null,
        messageCount: event.messageCount || null,
        toolCount: event.toolCount || null,
        resourceCount: event.resourceCount || null,
        rowCount: event.rowCount || null,
        resultCount: event.resultCount || null,
        filteredCount: event.filteredCount || null,
        rankedCount: event.rankedCount || null,
        reason: event.reason || null,
        errorType: event.errorType || null
    });
}

function recordError(source, error, meta = {}) {
    const message = typeof error === 'string' ? error : (error?.message || String(error || 'unknown error'));
    pushBounded(errorEvents, {
        ts: Date.now(),
        source,
        type: meta.type || classifyError(message),
        message: message.slice(0, 240),
        sessionId: meta.sessionId || null,
        stage: meta.stage || null,
        platform: meta.platform || null
    });
}

function inWindow(items, windowMs) {
    const since = Date.now() - windowMs;
    return items.filter((item) => item.ts >= since);
}

function summarizeLatency(events) {
    const messenger = events.filter((event) => event.platform === 'messenger');
    const aiRuntime = events.filter((event) => event.platform === 'ai');
    const productSearch = events.filter((event) => event.platform === 'product_search');
    const completedReplies = messenger.filter((event) => event.stage === 'text_send_finished');
    const visionEvents = messenger.filter((event) => event.stage === 'vision_analysis_finished');
    const aiFinished = messenger.filter((event) => event.stage === 'ai_finished');
    const busyEvents = messenger.filter((event) => event.stage === 'buffered_while_busy');
    const lockedEvents = messenger.filter((event) => event.stage === 'handover_lock_check_finished' && event.isLocked === true);

    const avgReplyMs = completedReplies.length
        ? Math.round(completedReplies.reduce((sum, event) => sum + event.elapsedMs, 0) / completedReplies.length)
        : 0;

    const slowCompletedReplies = completedReplies.filter((event) => event.elapsedMs > 45000);
    const slowVision = visionEvents.filter((event) => event.elapsedMs > 30000);
    const slowAi = aiFinished.filter((event) => event.elapsedMs > 60000);
    const slowAiRuntime = aiRuntime.filter((event) => event.elapsedMs > 30000);
    const slowProductSearch = productSearch.filter((event) => event.elapsedMs > 30000);
    const slowEvents = [...slowCompletedReplies, ...slowVision, ...slowAi, ...slowAiRuntime, ...slowProductSearch]
        .sort((a, b) => b.elapsedMs - a.elapsedMs)
        .slice(0, 10)
        .map((event) => ({
            platform: event.platform,
            sessionId: maskId(event.sessionId),
            stage: event.stage,
            elapsedMs: event.elapsedMs,
            imageCount: event.imageCount,
            audioCount: event.audioCount
        }));

    return {
        messenger: {
            completedReplies: completedReplies.length,
            avgReplyMs,
            maxReplyMs: completedReplies.reduce((max, event) => Math.max(max, event.elapsedMs), 0),
            slowReplies: slowCompletedReplies.length,
            busyBuffered: busyEvents.length,
            lockedSessions: lockedEvents.length
        },
        vision: {
            completedAnalyses: visionEvents.length,
            slowCount: slowVision.length,
            maxMs: visionEvents.reduce((max, event) => Math.max(max, event.elapsedMs), 0)
        },
        ai: {
            completed: aiFinished.length,
            slowCount: slowAi.length,
            maxMs: aiFinished.reduce((max, event) => Math.max(max, event.elapsedMs), 0),
            internalEvents: aiRuntime.length,
            internalSlowCount: slowAiRuntime.length,
            internalMaxMs: aiRuntime.reduce((max, event) => Math.max(max, event.elapsedMs), 0)
        },
        productSearch: {
            events: productSearch.length,
            slowCount: slowProductSearch.length,
            maxMs: productSearch.reduce((max, event) => Math.max(max, event.elapsedMs), 0)
        },
        recentSlowSessions: slowEvents
    };
}

function summarizeErrors(events) {
    const counts = events.reduce((map, event) => {
        map[event.type] = (map[event.type] || 0) + 1;
        return map;
    }, {});
    const crashTypes = ['generate_image_export', 'get_embedding_export', 'runtime_exception'];
    const authTypes = ['vision_auth_missing', 'auth_http_error'];

    return {
        counts,
        crashes: crashTypes.reduce((sum, type) => sum + (counts[type] || 0), 0),
        visionAuthFailures: authTypes.reduce((sum, type) => sum + (counts[type] || 0), 0),
        recent: events.slice(-10).reverse().map((event) => ({
            ts: new Date(event.ts).toISOString(),
            source: event.source,
            type: event.type,
            stage: event.stage,
            platform: event.platform,
            sessionId: maskId(event.sessionId),
            message: event.message
        }))
    };
}

function getHealth(options = {}) {
    const windowMs = Number(options.windowMs || DEFAULT_WINDOW_MS);
    const recentLatency = inWindow(latencyEvents, windowMs);
    const recentErrors = inWindow(errorEvents, windowMs);
    const latency = summarizeLatency(recentLatency);
    const errors = summarizeErrors(recentErrors);

    const warnings = [];
    if (errors.crashes > 0) warnings.push('runtime_crashes_detected');
    if (errors.visionAuthFailures > 0) warnings.push('vision_auth_failures_detected');
    if (latency.messenger.slowReplies > 0) warnings.push('slow_messenger_replies_detected');
    if (latency.vision.slowCount > 0) warnings.push('slow_vision_analysis_detected');
    if (latency.ai.slowCount > 0) warnings.push('slow_ai_responses_detected');
    if (latency.ai.internalSlowCount > 0) warnings.push('slow_ai_internal_stages_detected');
    if (latency.productSearch.slowCount > 0) warnings.push('slow_product_search_detected');

    const status = errors.crashes > 0 || errors.visionAuthFailures > 0
        ? 'critical'
        : warnings.length > 0 ? 'degraded' : 'healthy';

    return {
        status,
        uptimeSec: Math.floor((Date.now() - bootedAt) / 1000),
        windowMs,
        eventCounts: {
            latency: recentLatency.length,
            errors: recentErrors.length
        },
        crashes: {
            total: errors.crashes,
            generateImage: errors.counts.generate_image_export || 0,
            getEmbedding: errors.counts.get_embedding_export || 0,
            unhandled: errors.counts.runtime_exception || 0
        },
        vision: {
            authFailures: errors.visionAuthFailures,
            slowCount: latency.vision.slowCount,
            maxMs: latency.vision.maxMs,
            completedAnalyses: latency.vision.completedAnalyses
        },
        messenger: latency.messenger,
        ai: latency.ai,
        productSearch: latency.productSearch,
        warnings,
        recentSlowSessions: latency.recentSlowSessions,
        recentErrors: errors.recent
    };
}

function getRecent(limit = 100) {
    return {
        latency: latencyEvents.slice(-limit).reverse().map((event) => ({
            ...event,
            ts: new Date(event.ts).toISOString(),
            sessionId: maskId(event.sessionId)
        })),
        errors: errorEvents.slice(-limit).reverse().map((event) => ({
            ...event,
            ts: new Date(event.ts).toISOString(),
            sessionId: maskId(event.sessionId)
        }))
    };
}

module.exports = {
    recordLatency,
    recordError,
    getHealth,
    getRecent
};
