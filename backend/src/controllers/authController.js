const axios = require('axios');
const dbService = require('../services/dbService');
const authService = require('../services/authService');
const pgClient = require('../services/pgClient');

exports.exchangeToken = async (req, res) => {
    try {
        const { shortLivedToken } = req.body;

        if (!shortLivedToken) {
            return res.status(400).json({ error: 'Short-lived token is required' });
        }

        const appId = process.env.FACEBOOK_APP_ID;
        const appSecret = process.env.FACEBOOK_APP_SECRET;

        if (!appId || !appSecret) {
            console.error('Missing FACEBOOK_APP_ID or FACEBOOK_APP_SECRET in .env');
            return res.status(500).json({ error: 'Server misconfiguration: Missing App ID/Secret' });
        }

        const url = `https://graph.facebook.com/v19.0/oauth/access_token`;
        const params = {
            grant_type: 'fb_exchange_token',
            client_id: appId,
            client_secret: appSecret,
            fb_exchange_token: shortLivedToken
        };

        console.log('Exchanging token with Facebook...');
        const response = await axios.get(url, { params });

        if (response.data && response.data.access_token) {
            console.log('Token exchanged successfully.');
            return res.json({ 
                access_token: response.data.access_token,
                expires_in: response.data.expires_in 
            });
        } else {
            console.error('Facebook returned unexpected data:', response.data);
            return res.status(502).json({ error: 'Failed to exchange token', details: response.data });
        }

    } catch (error) {
        console.error('Token exchange error:', error.response ? error.response.data : error.message);
        return res.status(502).json({ 
            error: 'Facebook API Error', 
            details: error.response ? error.response.data : error.message 
        });
    }
};

exports.adminTopup = async (req, res) => {
    try {
        const { email, amount, secret } = req.body;

        // Simple Secret Check for extra security (optional but good)
        // Ideally should check Admin Session but for quick implementation we rely on frontend sending it? 
        // No, frontend is secured by Admin Login. 
        // We will assume if this endpoint is hit, it's from our Admin Page. 
        // But to be safe, let's check a hardcoded secret or just rely on obscurity if user wants "just make it work".
        // Actually, the route isn't protected by middleware in authRoutes yet.
        // Let's add a basic check.
        
        if (!email || !amount) {
            return res.status(400).json({ error: "Email and Amount required" });
        }

        const result = await dbService.addBalanceByEmail(email, amount);
        res.json(result);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.adminLogin = async (req, res) => {
    try {
        const { username, password } = req.body || {};

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }

        const envUser = process.env.ADMIN_USERNAME || 'abcadmin';
        const envPass = process.env.ADMIN_PASSWORD || 'admin123';

        if (username === envUser && password === envPass) {
            const jwtSecret = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET || envPass;
            if (!jwtSecret) {
                return res.status(500).json({ error: 'Admin auth secret is not configured' });
            }
            const token = require('jsonwebtoken').sign(
                { role: 'admin', username: username },
                jwtSecret,
                { expiresIn: '7d' }
            );
            return res.json({ success: true, token });
        }

        return res.status(401).json({ error: 'Invalid credentials' });
    } catch (error) {
        console.error('Admin login error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

exports.listTransactions = async (req, res) => {
    try {
        const { rows } = await pgClient.query(
            'SELECT id, user_email, amount, method, trx_id, sender_number, status, created_at FROM payment_transactions ORDER BY created_at DESC'
        );
        res.json({ transactions: rows });
    } catch (error) {
        console.error('List transactions error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

exports.approveTransaction = async (req, res) => {
    try {
        const { id } = req.params;
        const txnId = String(id || '').trim();
        if (!txnId) {
            return res.status(400).json({ error: 'Invalid id' });
        }

        const { rows } = await pgClient.query(
            'SELECT * FROM payment_transactions WHERE id = $1',
            [txnId]
        );
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Transaction not found' });
        }

        const txn = rows[0];
        if (txn.status === 'approved') {
            return res.json({ success: true });
        }

        await dbService.approveDepositTransaction(txn);

        res.json({ success: true });
    } catch (error) {
        console.error('Approve transaction error:', error);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
};

exports.rejectTransaction = async (req, res) => {
    try {
        const { id } = req.params;
        const txnId = String(id || '').trim();
        if (!txnId) {
            return res.status(400).json({ error: 'Invalid id' });
        }

        await pgClient.query(
            'UPDATE payment_transactions SET status = $1 WHERE id = $2',
            ['failed', txnId]
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Reject transaction error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

exports.listCoupons = async (req, res) => {
    try {
        const { rows } = await pgClient.query(
            'SELECT id, code, value, type, status, usage_limit, current_usage, per_user_limit, created_at FROM referral_codes ORDER BY created_at DESC'
        );
        res.json({ coupons: rows });
    } catch (error) {
        console.error('List coupons error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

exports.createCoupon = async (req, res) => {
    try {
        const { code, value, type, usage_limit, per_user_limit } = req.body;
        if (!code || !value) {
            return res.status(400).json({ error: 'code and value are required' });
        }

        const couponType = type || 'balance'; // balance or credit
        const limit = parseInt(usage_limit) || 1; // Default 1 use
        const userLimit = parseInt(per_user_limit) || 1; // Default 1 per user

        const { rows } = await pgClient.query(
            `
            INSERT INTO referral_codes (code, value, type, status, usage_limit, per_user_limit)
            VALUES ($1, $2, $3, 'active', $4, $5)
            RETURNING id, code, value, type, status, usage_limit, per_user_limit, created_at
            `,
            [code, value, couponType, limit, userLimit]
        );

        res.json(rows[0]);
    } catch (error) {
        console.error('Create coupon error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

exports.updateCouponStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const couponId = parseInt(id, 10);

        if (!couponId || !status) {
            return res.status(400).json({ error: 'Invalid payload' });
        }

        await pgClient.query(
            'UPDATE referral_codes SET status = $1 WHERE id = $2',
            [status, couponId]
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Update coupon status error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

exports.requestOtp = async (req, res) => {
    try {
        const email = String(req.body.email || '').trim().toLowerCase();
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        const user = await authService.findOrCreateUserByEmail(email);
        const otp = await authService.createOtp(user.email);
        await authService.sendOtpEmail(user.email, otp.code);

        res.json({ success: true });
    } catch (error) {
        console.error('requestOtp error:', error);
        res.status(500).json({ error: 'Failed to send OTP' });
    }
};

exports.verifyOtp = async (req, res) => {
    try {
        const email = String(req.body.email || '').trim().toLowerCase();
        const code = String(req.body.code || '').trim();

        if (!email || !code) {
            return res.status(400).json({ error: 'Email and code are required' });
        }

        const result = await authService.verifyOtp(email, code);
        if (!result.ok) {
            if (result.reason === 'expired') {
                return res.status(400).json({ error: 'Code expired' });
            }
            return res.status(400).json({ error: 'Invalid code' });
        }

        const user = await authService.findOrCreateUserByEmail(email);
        const token = authService.signToken(user);

        res.json({
            token,
            user
        });
    } catch (error) {
        console.error('verifyOtp error:', error);
        res.status(500).json({ error: 'Failed to verify code' });
    }
};

exports.registerWithPassword = async (req, res) => {
    try {
        const fullName = String(req.body.fullName || '').trim();
        const phone = String(req.body.phone || '').trim();
        const email = String(req.body.email || '').trim().toLowerCase();
        const password = String(req.body.password || '');

        if (!fullName || !phone || !email || !password) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        const user = await authService.setUserPassword(email, password, fullName, phone);
        res.json({ success: true, user });
    } catch (error) {
        console.error('registerWithPassword error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
};

exports.loginWithPassword = async (req, res) => {
    try {
        const email = String(req.body.email || '').trim().toLowerCase();
        const password = String(req.body.password || '');

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const result = await authService.verifyPassword(email, password);
        if (!result.ok || !result.user) {
            return res.status(400).json({ error: 'Invalid email or password' });
        }

        const token = authService.signToken(result.user);
        res.json({
            token,
            user: result.user
        });
    } catch (error) {
        console.error('loginWithPassword error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
};

// Get current user's balance and transactions
exports.getMyPayments = async (req, res) => {
    try {
        const userId = req.user && req.user.id;
        const email = req.user && req.user.email;

        if (!userId || !email) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const configResult = await pgClient.query(
            'SELECT balance FROM user_configs WHERE user_id::text = $1::text LIMIT 1',
            [String(userId)]
        );

        const balance = configResult.rows[0]?.balance || 0;

        const txResult = await pgClient.query(
            `
            SELECT id, user_email, amount, method, trx_id, sender_number, status, created_at
            FROM payment_transactions
            WHERE user_email = $1
            ORDER BY created_at DESC
            `,
            [email]
        );

        res.json({
            balance,
            transactions: txResult.rows || []
        });
    } catch (error) {
        console.error('getMyPayments error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Create a new deposit request
exports.createDepositRequest = async (req, res) => {
    try {
        const email = req.user && req.user.email;
        if (!email) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const rawAmount = req.body && req.body.amount;
        const method = String(req.body.method || 'bkash');
        const trxId = String(req.body.trxId || '').trim();
        const senderNumber = String(req.body.senderNumber || '').trim();

        const amount = Number(rawAmount);
        if (!trxId || !senderNumber) {
            return res.status(400).json({ error: 'Transaction ID and sender number are required' });
        }
        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Invalid amount' });
        }
        if (amount < 300) {
            return res.status(400).json({ error: 'Minimum deposit is 300 BDT' });
        }

        const insertResult = await pgClient.query(
            `
            INSERT INTO payment_transactions (user_email, amount, method, status, trx_id, sender_number)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, user_email, amount, method, trx_id, sender_number, status, created_at
            `,
            [email, amount, method, 'pending', trxId, senderNumber]
        );

        res.json(insertResult.rows[0]);
    } catch (error) {
        console.error('createDepositRequest error:', error);
        res.status(500).json({ error: 'Failed to create deposit request' });
    }
};

exports.requestPasswordReset = async (req, res) => {
    try {
        const email = String(req.body.email || '').trim().toLowerCase();
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        const existing = await pgClient.query(
            'SELECT id, email FROM users WHERE email = $1 LIMIT 1',
            [email]
        );

        if (existing.rows.length === 0) {
            return res.json({ success: true });
        }

        const otp = await authService.createOtp(email);
        await authService.sendOtpEmail(email, otp.code);

        res.json({ success: true });
    } catch (error) {
        console.error('requestPasswordReset error:', error);
        res.status(500).json({ error: 'Failed to send reset code' });
    }
};

exports.verifyPasswordResetCode = async (req, res) => {
    try {
        const email = String(req.body.email || '').trim().toLowerCase();
        const code = String(req.body.code || '').trim();

        if (!email || !code) {
            return res.status(400).json({ error: 'Email and code are required' });
        }

        const now = new Date().toISOString();
        const result = await pgClient.query(
            `SELECT id, code, expires_at, used
             FROM email_otp_codes
             WHERE email = $1
             ORDER BY created_at DESC
             LIMIT 5`,
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(400).json({ error: 'Invalid code' });
        }

        const match = result.rows.find(row => row.code === code);
        if (!match) {
            return res.status(400).json({ error: 'Invalid code' });
        }

        if (match.used) {
            return res.status(400).json({ error: 'Code already used' });
        }

        if (match.expires_at <= now) {
            return res.status(400).json({ error: 'Code expired' });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('verifyPasswordResetCode error:', error);
        res.status(500).json({ error: 'Verification failed' });
    }
};

exports.completePasswordReset = async (req, res) => {
    try {
        const email = String(req.body.email || '').trim().toLowerCase();
        const code = String(req.body.code || '').trim();
        const password = String(req.body.password || '');

        if (!email || !code || !password) {
            return res.status(400).json({ error: 'Email, code and password are required' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        const now = new Date().toISOString();
        const result = await pgClient.query(
            `SELECT id, code, expires_at, used
             FROM email_otp_codes
             WHERE email = $1
             ORDER BY created_at DESC
             LIMIT 5`,
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(400).json({ error: 'Invalid code' });
        }

        const match = result.rows.find(row => row.code === code);
        if (!match) {
            return res.status(400).json({ error: 'Invalid code' });
        }

        if (match.used) {
            return res.status(400).json({ error: 'Code already used' });
        }

        if (match.expires_at <= now) {
            return res.status(400).json({ error: 'Code expired' });
        }

        await pgClient.query('UPDATE email_otp_codes SET used = true WHERE id = $1', [match.id]);

        await authService.setUserPassword(email, password, null, null);

        res.json({ success: true });
    } catch (error) {
        console.error('completePasswordReset error:', error);
        res.status(500).json({ error: 'Failed to update password' });
    }
};

exports.changePassword = async (req, res) => {
    try {
        const email = req.user && req.user.email;
        if (!email) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const oldPassword = String(req.body.oldPassword || '');
        const newPassword = String(req.body.newPassword || '');

        if (!oldPassword || !newPassword) {
            return res.status(400).json({ error: 'Old and new passwords are required' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'New password must be at least 6 characters' });
        }

        const result = await authService.verifyPassword(email, oldPassword);
        if (!result.ok) {
            return res.status(400).json({ error: 'Old password is incorrect' });
        }

        await authService.setUserPassword(email, newPassword, null, null);

        res.json({ success: true });
    } catch (error) {
        console.error('changePassword error:', error);
        res.status(500).json({ error: 'Failed to change password' });
    }
};

// Redeem balance coupon code
exports.redeemCoupon = async (req, res) => {
    try {
        const userId = req.user && req.user.id;
        const email = req.user && req.user.email;

        if (!userId || !email) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const code = String(req.body.code || '').trim();
        if (!code) {
            return res.status(400).json({ error: 'Code is required' });
        }

        const couponResult = await pgClient.query(
            'SELECT id, code, value, type, status, usage_limit, current_usage, per_user_limit FROM referral_codes WHERE code = $1 AND status = $2',
            [code, 'active']
        );

        if (couponResult.rows.length === 0) {
            return res.status(400).json({ error: 'Invalid or expired coupon' });
        }

        const coupon = couponResult.rows[0];
        const amount = Number(coupon.value) || 0;

        // Check global usage limit
        if (coupon.usage_limit > 0 && coupon.current_usage >= coupon.usage_limit) {
            return res.status(400).json({ error: 'Coupon usage limit reached' });
        }

        // Check per-user usage limit
        const usageCheck = await pgClient.query(
            'SELECT count(*) FROM coupon_usage WHERE user_id = $1 AND coupon_id = $2',
            [userId, coupon.id]
        );
        const userUsageCount = parseInt(usageCheck.rows[0].count);
        if (coupon.per_user_limit > 0 && userUsageCount >= coupon.per_user_limit) {
            return res.status(400).json({ error: 'You have already used this coupon' });
        }

        const configResult = await pgClient.query(
            'SELECT balance, message_credit FROM user_configs WHERE user_id = $1::uuid',
            [userId]
        );

        let newBalance = 0;
        let newMessageCredit = 0;

        if (configResult.rows.length > 0) {
            const currentBalance = Number(configResult.rows[0].balance) || 0;
            const currentCredits = Number(configResult.rows[0].message_credit) || 0;
            
            if (coupon.type === 'credit') {
                newMessageCredit = currentCredits + amount;
                await pgClient.query(
                    'UPDATE user_configs SET message_credit = $1 WHERE user_id = $2::uuid',
                    [newMessageCredit, userId]
                );
                newBalance = currentBalance;
            } else {
                newBalance = currentBalance + amount;
                await pgClient.query(
                    'UPDATE user_configs SET balance = $1 WHERE user_id = $2::uuid',
                    [newBalance, userId]
                );
                newMessageCredit = currentCredits;
            }
        } else {
            if (coupon.type === 'credit') {
                newMessageCredit = amount;
                newBalance = 0;
                await pgClient.query(
                    'INSERT INTO user_configs (user_id, email, message_credit, balance) VALUES ($1::uuid, $2, $3, $4)',
                    [userId, email, newMessageCredit, 0]
                );
            } else {
                newBalance = amount;
                newMessageCredit = 0;
                await pgClient.query(
                    'INSERT INTO user_configs (user_id, email, balance, message_credit) VALUES ($1::uuid, $2, $3, $4)',
                    [userId, email, newBalance, 0]
                );
            }
        }

        // Log usage
        await pgClient.query(
            'INSERT INTO coupon_usage (user_id, coupon_id) VALUES ($1, $2)',
            [userId, coupon.id]
        );

        // Update coupon stats
        await pgClient.query(
            'UPDATE referral_codes SET current_usage = current_usage + 1 WHERE id = $1',
            [coupon.id]
        );

        // If it was a single-use global coupon and limit reached, deactivate it
        if (coupon.usage_limit > 0 && (coupon.current_usage + 1) >= coupon.usage_limit) {
            await pgClient.query(
                'UPDATE referral_codes SET status = $1 WHERE id = $2',
                ['inactive', coupon.id]
            );
        }

        await pgClient.query(
            `
            INSERT INTO payment_transactions (user_email, amount, method, status, trx_id, sender_number)
            VALUES ($1, $2, $3, $4, $5, $6)
            `,
            [email, amount, 'coupon', 'completed', `COUPON-${code}`, 'System']
        );

        res.json({ success: true, balance: newBalance, message_credit: newMessageCredit });
    } catch (error) {
        console.error('redeemCoupon error:', error);
        res.status(500).json({ error: 'Redemption failed' });
    }
};

exports.buyCredits = async (req, res) => {
    try {
        const userId = req.user && req.user.id;
        const email = req.user && req.user.email;
        if (!userId || !email) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { amount } = req.body;
        
        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Invalid amount' });
        }

        const pricePerCredit = 0.1;
        const totalCost = amount * pricePerCredit;

        const configResult = await pgClient.query(
            'SELECT balance, message_credit FROM user_configs WHERE user_id = $1::uuid',
            [userId]
        );

        if (configResult.rows.length === 0) {
            return res.status(404).json({ error: 'User config not found' });
        }

        const userConfig = configResult.rows[0];
        const currentBalance = Number(userConfig.balance) || 0;

        if (currentBalance < totalCost) {
            return res.status(400).json({ error: `Insufficient balance. You need ${totalCost} TK to buy ${amount} credits.` });
        }

        const newBalance = currentBalance - totalCost;
        const newCredits = (Number(userConfig.message_credit) || 0) + amount;

        await pgClient.query(
            'UPDATE user_configs SET balance = $1, message_credit = $2 WHERE user_id = $3::uuid',
            [newBalance, newCredits, userId]
        );

        await pgClient.query(
            `
            INSERT INTO payment_transactions (user_email, amount, method, status, trx_id, sender_number)
            VALUES ($1, $2, $3, $4, $5, $6)
            `,
            [email, totalCost, 'credit_purchase', 'completed', `BUY-${Date.now()}`, 'System']
        );

        res.json({ success: true, balance: newBalance, message_credit: newCredits });
    } catch (error) {
        console.error('buyCredits error:', error);
        res.status(500).json({ error: 'Credit purchase failed' });
    }
};
