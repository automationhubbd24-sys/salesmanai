const express = require('express');
const cors = require('cors');
const path = require('path');
const apiListRoutes = require('./routes/apiListRoutes');
const openrouterEngineRoutes = require('./routes/openrouterEngineRoutes');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Routes
app.use('/api/api-list', apiListRoutes);
app.use('/api/openrouter', openrouterEngineRoutes);

// Basic health check
app.get('/', (req, res) => {
    res.send('AI Agent Backend (Aligned) Running');
});

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('Unhandled Application Error:', err);
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

module.exports = app;
