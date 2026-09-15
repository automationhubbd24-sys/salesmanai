const express = require('express');
const webhookController = require('../controllers/webhookController');
const router = express.Router();

// Monitor route for webhook debugging
// VERY IMPORTANT: Put this BEFORE dynamic routes to avoid it being caught by a parameter route
router.get('/monitor', webhookController.getWebhookLogs);

// Facebook and Instagram Webhook Verification (GET)
router.get('/', webhookController.verifyWebhook);
router.get('/instagram', require('../controllers/instagramController').verifyInstagramWebhook);

// WhatsApp Webhook Verification (GET)
router.get('/whatsapp', webhookController.verifyWhatsAppWebhook);

// Facebook Webhook Event Listener (POST)
router.post('/', webhookController.handleWebhook);

// WhatsApp Webhook Event Listener (POST)
router.post('/whatsapp', webhookController.handleWhatsAppWebhook);

module.exports = router;
