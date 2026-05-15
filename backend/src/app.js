const express = require('express');
const cors = require('cors');
const webhookRoutes = require('./routes/webhookRoutes');
const whatsappRoutes = require('./routes/whatsappRoutes');
const messengerRoutes = require('./routes/messengerRoutes');
const authRoutes = require('./routes/authRoutes');
const productRoutes = require('./routes/productRoutes');
const adsRoutes = require('./routes/adsRoutes');
const externalApiRoutes = require('./routes/externalApiRoutes');
const liteEngineRoutes = require('./routes/liteEngineRoutes');
const openrouterEngineRoutes = require('./routes/openrouterEngineRoutes');
const dbAdminRoutes = require('./routes/dbAdminRoutes');
const apiListRoutes = require('./routes/apiListRoutes');
const apiEngineRoutes = require('../api-engine/engine'); // Added for API Engine stats
const teamRoutes = require('./routes/teamRoutes');
const statsRoutes = require('./routes/statsRoutes');
const aiRoutes = require('./routes/aiRoutes');
const marketingRoutes = require('./routes/marketingRoutes');

const path = require('path');
const app = express();

// CORS Configuration - Original Simple Working State
app.use(cors());

// Enable trust proxy
app.set('trust proxy', 1);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Optimized Static Serving with Caching
const cacheOptions = {
    maxAge: '7d', // Cache for 7 days
    setHeaders: (res, path) => {
        if (path.endsWith('.html')) {
            res.set('Cache-Control', 'public, max-age=0, must-revalidate'); // Don't cache HTML
        } else {
            res.set('Cache-Control', 'public, max-age=604800, immutable'); // Cache assets for 7 days
        }
    }
};

app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads'), cacheOptions));

// Routes
// We mount the webhook route at /webhook or /api/webhook based on preference
app.use('/webhook', webhookRoutes);
app.use('/api/webhook', webhookRoutes);

// Register other routes
app.use('/api/v1/dev/chat', apiEngineRoutes);
app.use('/api/api-engine', apiEngineRoutes);
app.use('/api-engine', apiEngineRoutes);

app.use('/whatsapp', whatsappRoutes);
app.use('/api/whatsapp', whatsappRoutes);

app.use('/messenger', messengerRoutes);
app.use('/api/messenger', messengerRoutes);

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/ads', adsRoutes);
app.use('/api/external', externalApiRoutes);
app.use('/v1', externalApiRoutes);
app.use('/api/lite', liteEngineRoutes);
app.use('/api/openrouter', openrouterEngineRoutes);
app.use('/api/db-admin', dbAdminRoutes);
app.use('/db-admin', dbAdminRoutes);
app.use('/api/api-list', apiListRoutes);

app.use('/teams', teamRoutes);
app.use('/api/teams', teamRoutes);

app.use('/stats', statsRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/marketing', marketingRoutes);

// Basic health check
app.get('/', (req, res) => {
    res.send('AI Agent Backend Running');
});

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('Unhandled Application Error:', err);
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

// SPA Fallback: handle client-side routing (MUST BE AT THE END)
const distPath = path.join(__dirname, '../../dist');
if (require('fs').existsSync(distPath)) {
    app.use(express.static(distPath, cacheOptions));
    app.get('*', (req, res, next) => {
        // If it's an API request that wasn't handled by routes above, let it pass to 404
        if (req.path.startsWith('/api') || req.path.startsWith('/v1') || req.path.startsWith('/webhook')) {
            return next();
        }
        res.sendFile(path.join(distPath, 'index.html'));
    });
}

module.exports = app;
