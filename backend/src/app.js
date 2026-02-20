const express = require('express');
const cors = require('cors');
const webhookRoutes = require('./routes/webhookRoutes');
const whatsappRoutes = require('./routes/whatsappRoutes');
const messengerRoutes = require('./routes/messengerRoutes');
const authRoutes = require('./routes/authRoutes');
const productRoutes = require('./routes/productRoutes');
const externalApiRoutes = require('./routes/externalApiRoutes');
const liteEngineRoutes = require('./routes/liteEngineRoutes');
const openrouterEngineRoutes = require('./routes/openrouterEngineRoutes');
const dbAdminRoutes = require('./routes/dbAdminRoutes');
const apiListRoutes = require('./routes/apiListRoutes');
const teamRoutes = require('./routes/teamRoutes');
const statsRoutes = require('./routes/statsRoutes');
const aiRoutes = require('./routes/aiRoutes');

const path = require('path');
const app = express();

// Enable trust proxy for Coolify/Nginx/Load Balancers
app.set('trust proxy', 1);

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Routes
// We mount the webhook route at /webhook or /api/webhook based on preference
// The user's n8n.json used /webhook
app.use('/webhook', webhookRoutes);
app.use('/api/webhook', webhookRoutes); // Alias for consistency

// Register other routes
app.use('/whatsapp', whatsappRoutes);
app.use('/api/whatsapp', whatsappRoutes); // Alias for /api prefix

app.use('/messenger', messengerRoutes);
app.use('/api/messenger', messengerRoutes); // Alias for /api prefix

app.use('/api/auth', authRoutes); // Matches frontend call /api/auth/facebook/exchange-token
app.use('/api/products', productRoutes);
app.use('/api/external', externalApiRoutes);
app.use('/api/lite', liteEngineRoutes);
app.use('/api/openrouter', openrouterEngineRoutes);
app.use('/api/db-admin', dbAdminRoutes);
app.use('/api/api-list', apiListRoutes);

app.use('/teams', teamRoutes);
app.use('/api/teams', teamRoutes); // Alias for /api prefix

app.use('/stats', statsRoutes);
app.use('/api/stats', statsRoutes); // Alias for /api prefix

app.use('/api/ai', aiRoutes);

// Basic health check

app.get('/', (req, res) => {
    res.send('AI Agent Backend Running');
});

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('Unhandled Application Error:', err);
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

module.exports = app;
