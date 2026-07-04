const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');

// Facebook Webhook Verification (GET)
router.get('/', webhookController.verifyWebhook);

// WhatsApp Webhook Verification (GET)
router.get('/whatsapp', webhookController.verifyWhatsAppWebhook);

// Facebook Webhook Event Listener (POST)
router.post('/', webhookController.handleWebhook);

// WhatsApp Webhook Event Listener (POST)
router.post('/whatsapp', webhookController.handleWhatsAppWebhook);

// Monitor route for webhook debugging
router.get('/monitor', webhookController.getWebhookLogs);

module.exports = router;
