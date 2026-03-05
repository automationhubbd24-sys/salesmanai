require('dotenv').config();
const app = require('./src/app');
const whatsappController = require('./src/controllers/whatsappController');

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

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Webhook URL: http://localhost:${PORT}/webhook`);

  // Start Cleanup Job (Every 1 Hour)
  setInterval(() => {
      whatsappController.checkAndCleanupExpiredSessions();
  }, 60 * 60 * 1000);

  // Start Auto-Repair Job (Every 5 Minutes)
  setInterval(() => {
      whatsappController.checkAndAutoRepairSessions();
  }, 5 * 60 * 1000);
});
