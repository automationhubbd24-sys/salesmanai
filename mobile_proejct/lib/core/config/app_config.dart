class AppConfig {
  static const backendUrl = String.fromEnvironment(
    'BACKEND_URL',
    defaultValue: 'https://salesmanchatbot.online',
  );

  static const moreInfoUrl = 'https://salesmanchatbot.online';
  static const chatPollInterval = Duration(seconds: 30);
  static const messagePollInterval = Duration(seconds: 12);
}
