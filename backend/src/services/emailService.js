const nodemailer = require('nodemailer');

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
            const from = process.env.SMTP_FROM || process.env.SMTP_USER;
            const info = await transporter.sendMail({
                from,
                to,
                subject,
                text,
                html
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

        const subject = `Order Confirmed: ${product_name}`;
        const html = `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                <h2 style="color: #2563eb;">Order Confirmed!</h2>
                <p>Hello,</p>
                <p>Thank you for your order. We have received your details and are processing it.</p>
                <div style="background: #f9fafb; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <h3 style="margin-top: 0;">Order Details:</h3>
                    <ul style="list-style: none; padding: 0;">
                        <li><strong>Product:</strong> ${product_name}</li>
                        <li><strong>Quantity:</strong> ${quantity}</li>
                        <li><strong>Price:</strong> ${price || 'N/A'}</li>
                        <li><strong>Delivery Address:</strong> ${address}</li>
                        <li><strong>Phone:</strong> ${phone}</li>
                    </ul>
                </div>
                <p>If you have any questions, feel free to reply to this email or contact us via ${platform}.</p>
                <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
                <p style="font-size: 12px; color: #666;">This is an automated notification from SalesmanChatbot AI.</p>
            </div>
        `;

        return await this.sendEmail({
            to: customer_email,
            subject,
            text: `Order Confirmed: ${product_name}. Thank you for your order.`,
            html
        });
    }

    /**
     * Send Order Notification to Admin
     */
    async sendAdminOrderNotification(adminEmail, orderData) {
        if (!adminEmail) return;

        const { product_name, phone, address, price, quantity, platform, customer_name } = orderData;
        const subject = `New Order Received - ${platform.toUpperCase()}`;
        
        const html = `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                <h2 style="color: #059669;">New Order! ðŸ“¦</h2>
                <p>A new order has been placed via <strong>${platform}</strong>.</p>
                <div style="background: #f0fdf4; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <h3 style="margin-top: 0;">Order Information:</h3>
                    <ul style="list-style: none; padding: 0;">
                        <li><strong>Customer:</strong> ${customer_name || 'Unknown'}</li>
                        <li><strong>Product:</strong> ${product_name}</li>
                        <li><strong>Quantity:</strong> ${quantity}</li>
                        <li><strong>Price:</strong> ${price || 'N/A'}</li>
                        <li><strong>Phone:</strong> ${phone}</li>
                        <li><strong>Address:</strong> ${address}</li>
                    </ul>
                </div>
                <p style="font-size: 12px; color: #666;">View this order in your SalesmanAI Dashboard.</p>
            </div>
        `;

        return await this.sendEmail({
            to: adminEmail,
            subject,
            text: `New Order: ${product_name} from ${customer_name || phone}.`,
            html
        });
    }
}

module.exports = new EmailService();