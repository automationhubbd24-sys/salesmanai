require('dotenv').config();
const app = require('./src/app');
const reminderService = require('./src/services/reminderService');

const PORT = process.env.PORT || 3001;

// Global Exception Handlers to prevent crash
process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION! 💥 Shutting down...');
    console.error(err.name, err.message, err.stack);
    // process.exit(1); // Don't exit in production immediately if possible, but usually safe to restart
});

process.on('unhandledRejection', (err) => {
    console.error('UNHANDLED REJECTION! 💥');
    console.error(err.name, err.message, err.stack);
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);

    // Schedule order reminders
    // Run frequently so 1-20 hour reminder delays feel accurate.
    setInterval(() => {
        reminderService.checkAndSendReminders();
    }, 10 * 60 * 1000);
    
    // Initial run shortly after startup to avoid long first-wait.
    setTimeout(() => {
        reminderService.checkAndSendReminders();
    }, 15 * 1000);
});
