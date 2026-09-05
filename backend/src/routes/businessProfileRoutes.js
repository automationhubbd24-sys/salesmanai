const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const businessProfileService = require('../services/businessProfileService');

const router = express.Router();

router.use(authMiddleware);

router.get('/resources/options', async (req, res) => {
    try {
        const options = await businessProfileService.getResourceOptions({
            userId: req.user?.id,
            email: req.user?.email
        });
        res.json(options);
    } catch (error) {
        console.error('[BusinessProfiles] Failed to load resource options:', error);
        res.status(500).json({ error: error.message || 'Failed to load resource options' });
    }
});

router.get('/', async (req, res) => {
    try {
        const profiles = await businessProfileService.listProfiles({
            userId: req.user?.id,
            email: req.user?.email,
            platform: req.query.platform,
            resourceId: req.query.resource_id
        });
        res.json(profiles);
    } catch (error) {
        console.error('[BusinessProfiles] Failed to list profiles:', error);
        res.status(500).json({ error: error.message || 'Failed to list business profiles' });
    }
});

router.post('/', async (req, res) => {
    try {
        const profile = await businessProfileService.saveProfile({
            userId: req.user?.id,
            email: req.user?.email,
            payload: req.body
        });
        res.status(201).json(profile);
    } catch (error) {
        console.error('[BusinessProfiles] Failed to create profile:', error);
        res.status(error.statusCode || 400).json({ error: error.message || 'Failed to create business profile' });
    }
});

router.put('/:id', async (req, res) => {
    try {
        const profile = await businessProfileService.saveProfile({
            userId: req.user?.id,
            email: req.user?.email,
            payload: req.body,
            id: req.params.id
        });
        res.json(profile);
    } catch (error) {
        console.error('[BusinessProfiles] Failed to update profile:', error);
        res.status(error.statusCode || 400).json({ error: error.message || 'Failed to update business profile' });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const deleted = await businessProfileService.deleteProfile({
            userId: req.user?.id,
            email: req.user?.email,
            id: req.params.id
        });
        if (!deleted) return res.status(404).json({ error: 'Business profile not found' });
        res.json({ success: true });
    } catch (error) {
        console.error('[BusinessProfiles] Failed to delete profile:', error);
        res.status(500).json({ error: error.message || 'Failed to delete business profile' });
    }
});

module.exports = router;
