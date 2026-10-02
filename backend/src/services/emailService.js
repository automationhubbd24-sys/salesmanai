const nodemailer = require('nodemailer');

const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const resolveSender = () => {
    const smtpUser = process.env.SMTP_USER;
    const configuredFrom = process.env.SMTP_FROM;
    const fromName = process.env.SMTP_FROM_NAME || 'SalesmanChatbot';
    const fromAddress = configuredFrom || smtpUser;
    const replyTo = configuredFrom && smtpUser && configuredFrom !== smtpUser ? smtpUser : undefined;

    return {
        from: `"${fromName}" <${fromAddress}>`,
        replyTo,
    };
};

class EmailService {
    constructor() {
        this.transporter = null;
    }

    /**
     * Creates a Nodemailer transport using environment variables
     */
    getTransporter() {
        if (!this.transporter) {
            const host = process.env.SMTP_HOST || 'smtp.gmail.com';
            const port = parseInt(process.env.SMTP_PORT || '587', 10);
            const user = process.env.SMTP_USER;
            const pass = process.env.SMTP_PASS;

            if (!user || !pass) {
                console.warn('[EmailService] SMTP_USER or SMTP_PASS not set. Emails will not be sent.');
                return null;
            }

            this.transporter = nodemailer.createTransport({
                host,
                port,
                secure: port === 465,
                auth: { user, pass }
            });
        }
        return this.transporter;
    }

    /**
     * Send a generic email
     */
    async sendEmail({ to, subject, text, html }) {
        const transporter = this.getTransporter();
        if (!transporter) return false;

        try {
            const sender = resolveSender();
            const info = await transporter.sendMail({
                from: sender.from,
                replyTo: sender.replyTo,
                to,
                subject,
                text,
                html,
                headers: {
                    'X-Auto-Response-Suppress': 'All',
                    'Auto-Submitted': 'auto-generated'
                }
            });
            console.log(`[EmailService] Email sent to ${to}: ${info.messageId}`);
            return true;
        } catch (error) {
            console.error(`[EmailService] Error sending email to ${to}:`, error.message);
            return false;
        }
    }

    /**
     * Send Order Confirmation Email to Customer
     */
    async sendOrderConfirmation(orderData) {
        const { customer_email, product_name, phone, address, price, quantity, platform } = orderData;
        
        if (!customer_email) return;

        const safeProductName = escapeHtml(product_name || 'Order item');
        const safeQuantity = escapeHtml(quantity || '1');
        const safePrice = escapeHtml(price || 'N/A');
        const safeAddress = escapeHtml(address || 'N/A');
        const safePhone = escapeHtml(phone || 'N/A');
        const safePlatform = escapeHtml(platform || 'chat');
        const subject = `Order confirmation - ${product_name || 'your order'}`;
        const html = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 10px; color: #111827;">
                <h2 style="color: #2563eb; margin-top: 0;">Order confirmation</h2>
                <p>Hello,</p>
                <p>We received your order details and will process it shortly.</p>
                <div style="background: #f9fafb; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <h3 style="margin-top: 0;">Order details</h3>
                    <ul style="list-style: none; padding: 0; margin: 0;">
                        <li><strong>Product:</strong> ${safeProductName}</li>
                        <li><strong>Quantity:</strong> ${safeQuantity}</li>
                        <li><strong>Price:</strong> ${safePrice}</li>
                        <li><strong>Delivery address:</strong> ${safeAddress}</li>
                        <li><strong>Phone:</strong> ${safePhone}</li>
                    </ul>
                </div>
                <p>If you have questions, reply to this email or contact us via ${safePlatform}.</p>
                <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 20px 0;">
                <p style="font-size: 12px; color: #6b7280;">This transactional email was sent by SalesmanChatbot.</p>
            </div>
        `;

        return await this.sendEmail({
            to: customer_email,
            subject,
            text: `Order confirmation: ${product_name || 'your order'}. We received your order details.`,
            html
        });
    }

    /**
     * Send Order Notification to Admin
     */
    async sendAdminOrderNotification(adminEmail, orderData) {
        if (!adminEmail) return;

        const { product_name, phone, address, price, quantity, platform, customer_name } = orderData;
        const safePlatform = escapeHtml(platform || 'chat');
        const safeCustomerName = escapeHtml(customer_name || 'Unknown');
        const safeProductName = escapeHtml(product_name || 'Order item');
        const safeQuantity = escapeHtml(quantity || '1');
        const safePrice = escapeHtml(price || 'N/A');
        const safePhone = escapeHtml(phone || 'N/A');
        const safeAddress = escapeHtml(address || 'N/A');
        const subject = `New order received - ${platform ? platform.toUpperCase() : 'CHAT'}`;
        
        const html = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 10px; color: #111827;">
                <h2 style="color: #059669; margin-top: 0;">New order received</h2>
                <p>A customer placed an order via <strong>${safePlatform}</strong>.</p>
                <div style="background: #f0fdf4; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <h3 style="margin-top: 0;">Order information</h3>
                    <ul style="list-style: none; padding: 0; margin: 0;">
                        <li><strong>Customer:</strong> ${safeCustomerName}</li>
                        <li><strong>Product:</strong> ${safeProductName}</li>
                        <li><strong>Quantity:</strong> ${safeQuantity}</li>
                        <li><strong>Price:</strong> ${safePrice}</li>
                        <li><strong>Phone:</strong> ${safePhone}</li>
                        <li><strong>Address:</strong> ${safeAddress}</li>
                    </ul>
                </div>
                <p style="font-size: 12px; color: #6b7280;">View this order in your SalesmanAI Dashboard.</p>
            </div>
        `;

        return await this.sendEmail({
            to: adminEmail,
            subject,
            text: `New order: ${product_name || 'Order item'} from ${customer_name || phone || 'customer'}.`,
            html
        });
    }
}

module.exports = new EmailService();