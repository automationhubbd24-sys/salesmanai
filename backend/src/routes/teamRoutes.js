const express = require('express');
const router = express.Router();
const pgClient = require('../services/pgClient');
const authMiddleware = require('../middleware/authMiddleware');

// Helper: Determine the effective owner email
// If the user is a member of a team, they act on behalf of the team owner.
// If the user is not a member, they are the owner.
async function getEffectiveOwnerEmail(userEmail) {
    // Check if this user is a member of an active team
    const memberRes = await pgClient.query(
        'SELECT owner_email FROM team_members WHERE member_email = $1 AND status = $2',
        [userEmail, 'active']
    );

    if (memberRes.rows.length > 0) {
        return memberRes.rows[0].owner_email;
    }
    
    return userEmail;
}

router.get('/members', authMiddleware, async (req, res) => {
    try {
        const userEmail = req.user.email;
        const ownerEmail = await getEffectiveOwnerEmail(userEmail);

        const result = await pgClient.query(
            'SELECT id, member_email, status, permissions, created_at FROM team_members WHERE owner_email = $1 ORDER BY created_at DESC',
            [ownerEmail]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Get team members error:', err);
        res.status(500).json({ error: 'Failed to fetch team members' });
    }
});

// Get teams I belong to
router.get('/me', authMiddleware, async (req, res) => {
    try {
        const userEmail = req.user.email;
        const result = await pgClient.query(
            'SELECT id, owner_email, status, permissions, created_at FROM team_members WHERE member_email = $1 AND status = $2',
            [userEmail, 'active']
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Get my teams error:', err);
        res.status(500).json({ error: 'Failed to fetch my teams' });
    }
});

router.post('/members', authMiddleware, async (req, res) => {
    try {
        const userEmail = req.user.email;
        const ownerEmail = await getEffectiveOwnerEmail(userEmail);
        
        const { member_email, permissions } = req.body;

        if (!member_email) {
            return res.status(400).json({ error: 'member_email is required' });
        }

        // Prevent adding the owner themselves as a member
        if (member_email.toLowerCase() === ownerEmail.toLowerCase()) {
             return res.status(400).json({ error: 'Cannot add the owner as a member' });
        }
        
        // Prevent adding yourself (if you are a member adding another member)
        if (member_email.toLowerCase() === userEmail.toLowerCase()) {
             return res.status(400).json({ error: 'Cannot add yourself' });
        }

        const result = await pgClient.query(
            `
            INSERT INTO team_members (owner_email, member_email, status, permissions)
            VALUES ($1, $2, 'active', $3)
            RETURNING id, member_email, status, permissions, created_at
            `,
            [ownerEmail, member_email.toLowerCase(), permissions || {}]
        );

        res.json(result.rows[0]);
    } catch (err) {
        console.error('Create team member error:', err);
        res.status(500).json({ error: err.message });
    }
});

router.put('/members/:id', authMiddleware, async (req, res) => {
    try {
        const userEmail = req.user.email;
        const ownerEmail = await getEffectiveOwnerEmail(userEmail);
        
        const { id } = req.params;
        const { permissions } = req.body;

        const result = await pgClient.query(
            `
            UPDATE team_members
            SET permissions = $1
            WHERE id = $2 AND owner_email = $3
            RETURNING id, member_email, status, permissions, created_at
            `,
            [permissions || {}, id, ownerEmail]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Member not found' });
        }

        res.json(result.rows[0]);
    } catch (err) {
        console.error('Update team member error:', err);
        res.status(500).json({ error: err.message });
    }
});

router.delete('/members/:id', authMiddleware, async (req, res) => {
    try {
        const userEmail = req.user.email;
        const ownerEmail = await getEffectiveOwnerEmail(userEmail);
        
        const { id } = req.params;

        const result = await pgClient.query(
            `
            DELETE FROM team_members
            WHERE id = $1 AND owner_email = $2
            `,
            [id, ownerEmail]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Member not found' });
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Delete team member error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

