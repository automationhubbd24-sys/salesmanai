const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const { query } = require('./pgClient');

async function findOrCreateUserByEmail(email) {
    const existing = await query('SELECT id, email, full_name, phone FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
        const row = existing.rows[0];
        return {
            id: row.id,
            email: row.email,
            full_name: row.full_name || null,
            phone: row.phone || null
        };
    }
    const inserted = await query(
        'INSERT INTO users (email) VALUES ($1) RETURNING id, email, full_name, phone',
        [email]
    );
    const row = inserted.rows[0];
    return {
        id: row.id,
        email: row.email,
        full_name: row.full_name || null,
        phone: row.phone || null
    };
}

async function setUserPassword(email, password, fullName, phone) {
    const passwordHash = await bcrypt.hash(password, 10);
    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
        const id = existing.rows[0].id;
        await query(
            'UPDATE users SET password_hash = $1, full_name = COALESCE($2, full_name), phone = COALESCE($3, phone) WHERE id = $4',
            [passwordHash, fullName || null, phone || null, id]
        );
        const updated = await query('SELECT id, email, full_name, phone FROM users WHERE id = $1 LIMIT 1', [id]);
        const row = updated.rows[0];
        return {
            id: row.id,
            email: row.email,
            full_name: row.full_name || null,
            phone: row.phone || null
        };
    }
    const inserted = await query(
        'INSERT INTO users (email, password_hash, full_name, phone) VALUES ($1, $2, $3, $4) RETURNING id, email, full_name, phone',
        [email, passwordHash, fullName || null, phone || null]
    );
    const row = inserted.rows[0];
    return {
        id: row.id,
        email: row.email,
        full_name: row.full_name || null,
        phone: row.phone || null
    };
}

async function verifyPassword(email, password) {
    const result = await query(
        'SELECT id, email, password_hash, full_name, phone FROM users WHERE email = $1 LIMIT 1',
        [email]
    );
    if (result.rows.length === 0) {
        return { ok: false };
    }
    const user = result.rows[0];
    if (!user.password_hash) {
        return { ok: false };
    }
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
        return { ok: false };
    }
    return {
        ok: true,
        user: {
            id: user.id,
            email: user.email,
            full_name: user.full_name || null,
            phone: user.phone || null
        }
    };
}

function generateOtpCode() {
    const n = Math.floor(100000 + Math.random() * 900000);
    return String(n);
}

async function createOtp(email) {
    const code = generateOtpCode();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await query(
        'INSERT INTO email_otp_codes (email, code, expires_at) VALUES ($1, $2, $3)',
        [email, code, expiresAt.toISOString()]
    );
    return { code, expiresAt };
}

function getJwtSecret() {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        throw new Error('JWT_SECRET is not configured');
    }
    return secret;
}

function signToken(user) {
    const secret = getJwtSecret();
    const payload = {
        sub: user.id,
        email: user.email
    };
    const token = jwt.sign(payload, secret, { expiresIn: '7d' });
    return token;
}

async function verifyOtp(email, code) {
    const now = new Date().toISOString();
    const result = await query(
        `SELECT id, email, code, expires_at, used
         FROM email_otp_codes
         WHERE email = $1
         ORDER BY created_at DESC
         LIMIT 5`,
        [email]
    );

    if (result.rows.length === 0) {
        return { ok: false, reason: 'not_found' };
    }

    const match = result.rows.find(row => row.code === code);
    if (!match) {
        return { ok: false, reason: 'invalid_code' };
    }

    if (match.used) {
        return { ok: false, reason: 'used' };
    }

    if (match.expires_at <= now) {
        return { ok: false, reason: 'expired' };
    }

    await query('UPDATE email_otp_codes SET used = true WHERE id = $1', [match.id]);
    return { ok: true };
}

function createTransport() {
    const host = process.env.SMTP_HOST || 'smtp.gmail.com';
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (!user || !pass) {
        throw new Error('SMTP_USER and SMTP_PASS must be set');
    }
    const transport = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass }
    });
    return transport;
}

async function sendOtpEmail(email, code) {
    const transporter = createTransport();
    const from = process.env.SMTP_FROM || process.env.SMTP_USER;
    const subject = 'Your login code';
    const text = `Your login code is ${code}. It will expire in 5 minutes.`;
    const html = `<p>Your login code is <strong>${code}</strong>.</p><p>This code will expire in 5 minutes.</p>`;
    await transporter.sendMail({
        from,
        to: email,
        subject,
        text,
        html
    });
}

module.exports = {
    findOrCreateUserByEmail,
    createOtp,
    verifyOtp,
    signToken,
    sendOtpEmail,
    setUserPassword,
    verifyPassword
};
