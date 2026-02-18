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

const app = express();


// Middleware
app.use(cors());
app.use(express.json());

// Routes
// We mount the webhook route at /webhook or /api/webhook based on preference
// The user's n8n.json used /webhook
app.use('/webhook', webhookRoutes);

// Register other routes
app.use('/whatsapp', whatsappRoutes);
app.use('/messenger', messengerRoutes);
app.use('/api/auth', authRoutes); // Matches frontend call /api/auth/facebook/exchange-token
app.use('/api/products', productRoutes);
app.use('/api/external', externalApiRoutes);
app.use('/api/lite', liteEngineRoutes);
app.use('/api/openrouter', openrouterEngineRoutes);
app.use('/api/db-admin', dbAdminRoutes);
app.use('/api/api-list', apiListRoutes);
app.use('/teams', teamRoutes);

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
