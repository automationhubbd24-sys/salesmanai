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

    // Add 100 free credits for new user (only if user_config doesn't exist)
    try {
        await query(
            `INSERT INTO user_configs (user_id, email, message_credit, balance)
             VALUES ($1, $2, 100, 0)
             ON CONFLICT (user_id) DO NOTHING`,
            [row.id, row.email]
        );
    } catch (err) {
        console.error("Error adding free credits:", err);
    }

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
    const token = jwt.sign(payload, secret, { expiresIn: '90d' });
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

function extractEmailAddress(value) {
    const input = String(value || '').trim();
    if (!input) return '';
    const match = input.match(/<([^>]+)>/);
    return (match ? match[1] : input).trim().toLowerCase();
}

function getEmailDomain(value) {
    const email = extractEmailAddress(value);
    const atIndex = email.lastIndexOf('@');
    return atIndex === -1 ? '' : email.slice(atIndex + 1);
}

function formatSender(name, email) {
    const cleanEmail = extractEmailAddress(email);
    if (!cleanEmail) return '';
    const cleanName = String(name || '').trim();
    return cleanName ? `${cleanName} <${cleanEmail}>` : cleanEmail;
}

function resolveMailSender() {
    const smtpUser = process.env.SMTP_USER || '';
    const smtpFrom = process.env.SMTP_FROM || '';
    const smtpFromName = process.env.SMTP_FROM_NAME || 'SalesmanAI';

    const authAddress = extractEmailAddress(smtpUser);
    const fromAddress = extractEmailAddress(smtpFrom);
    const authDomain = getEmailDomain(smtpUser);
    const fromDomain = getEmailDomain(smtpFrom);

    if (!fromAddress) {
        return {
            from: formatSender(smtpFromName, authAddress),
            replyTo: undefined
        };
    }

    const isSameAddress = authAddress && fromAddress === authAddress;
    const isSameDomain = authDomain && fromDomain && authDomain === fromDomain;

    if (!isSameAddress && !isSameDomain) {
        console.warn(
            `[AuthMail] SMTP_FROM (${fromAddress}) does not align with SMTP_USER (${authAddress}). Using authenticated sender for better inbox placement.`
        );
        return {
            from: formatSender(smtpFromName, authAddress),
            replyTo: smtpFrom
        };
    }

    return {
        from: formatSender(smtpFromName, smtpFrom),
        replyTo: authAddress && fromAddress !== authAddress ? authAddress : undefined
    };
}

async function sendOtpEmail(email, code) {
    const transporter = createTransport();
    const { from, replyTo } = resolveMailSender();
    const subject = 'SalesmanAI verification code';
    const text = [
        `Your SalesmanAI verification code is ${code}.`,
        'It will expire in 5 minutes.',
        'For your security, do not share this code with anyone.'
    ].join(' ');
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #111827;">
            <div style="border: 1px solid #e5e7eb; border-radius: 16px; padding: 24px;">
                <p style="margin: 0 0 8px; font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; color: #6b7280;">SalesmanAI Security</p>
                <h2 style="margin: 0 0 16px; font-size: 24px; color: #111827;">Your verification code</h2>
                <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.6;">Use the code below to continue your verification. This code expires in <strong>5 minutes</strong>.</p>
                <div style="margin: 20px 0; padding: 18px; border-radius: 12px; background: #f3f4f6; text-align: center; font-size: 32px; font-weight: 700; letter-spacing: 0.35em; color: #111827;">
                    ${code}
                </div>
                <p style="margin: 0 0 10px; font-size: 14px; color: #374151;">For your security, do not share this code with anyone.</p>
                <p style="margin: 0; font-size: 13px; line-height: 1.6; color: #6b7280;">
                    This email was sent because a verification code was requested for your SalesmanAI account.
                </p>
            </div>
        </div>
    `;
    await transporter.sendMail({
        from,
        replyTo,
        to: email,
        subject,
        text,
        html,
        headers: {
            'X-Auto-Response-Suppress': 'All',
            'Auto-Submitted': 'auto-generated'
        }
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
