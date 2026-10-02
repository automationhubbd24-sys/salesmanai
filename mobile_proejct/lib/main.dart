import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'app.dart';
import 'core/network/api_client.dart';
import 'core/storage/auth_storage.dart';
import 'repositories/auth_repository.dart';
import 'repositories/conversation_repository.dart';
import 'repositories/platform_repository.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();

  const storage = AuthStorage();
  final apiClient = ApiClient(storage);

  runApp(
    MultiProvider(
      providers: [
        Provider<AuthStorage>.value(value: storage),
        Provider<ApiClient>.value(value: apiClient),
        Provider<AuthRepository>(create: (_) => AuthRepository(apiClient, storage)),
        Provider<PlatformRepository>(create: (_) => PlatformRepository(apiClient)),
        Provider<ConversationRepository>(create: (_) => ConversationRepository(apiClient)),
      ],
      child: const SalesmanMobileApp(),
    ),
  );
}
