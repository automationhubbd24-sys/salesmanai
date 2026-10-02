import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/config/app_config.dart';
import '../../core/storage/auth_storage.dart';
import '../../repositories/auth_repository.dart';
import '../auth/login_screen.dart';

class AccountSettingsScreen extends StatelessWidget {
  const AccountSettingsScreen({super.key, required this.connectedCount});

  final int connectedCount;

  Future<void> _openMoreInfo() async {
    await launchUrl(Uri.parse(AppConfig.moreInfoUrl), mode: LaunchMode.externalApplication);
  }

  Future<void> _logout(BuildContext context) async {
    await context.read<AuthRepository>().logout();
    if (!context.mounted) return;
    Navigator.of(context).pushAndRemoveUntil(MaterialPageRoute(builder: (_) => const LoginScreen()), (_) => false);
  }

  @override
  Widget build(BuildContext context) {
    final storage = context.read<AuthStorage>();
    return Scaffold(
      appBar: AppBar(title: const Text('Account Settings')),
      body: ListView(
        padding: const EdgeInsets.all(18),
        children: [
          FutureBuilder<List<String?>>(
            future: Future.wait([storage.readName(), storage.readEmail()]),
            builder: (context, snapshot) {
              final name = snapshot.data?[0] ?? 'SalesmanAI User';
              final email = snapshot.data?[1] ?? '';
              return Container(
                padding: const EdgeInsets.all(18),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: .05),
                  borderRadius: BorderRadius.circular(22),
                  border: Border.all(color: Colors.white.withValues(alpha: .1)),
                ),
                child: Row(
                  children: [
                    const CircleAvatar(radius: 28, child: Icon(Icons.person)),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(name, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
                          if (email.isNotEmpty) Text(email, style: const TextStyle(color: Colors.white60)),
                        ],
                      ),
                    ),
                  ],
                ),
              );
            },
          ),
          const SizedBox(height: 18),
          ListTile(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
            tileColor: Colors.white.withValues(alpha: .05),
            leading: const Icon(Icons.hub_outlined),
            title: const Text('Connected platforms'),
            trailing: Text('$connectedCount'),
          ),
          const SizedBox(height: 10),
          ListTile(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
            tileColor: Colors.white.withValues(alpha: .05),
            leading: const Icon(Icons.info_outline),
            title: const Text('View More Info'),
            subtitle: const Text(AppConfig.moreInfoUrl),
            onTap: _openMoreInfo,
          ),
          const SizedBox(height: 10),
          ListTile(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
            tileColor: Colors.red.withValues(alpha: .08),
            leading: const Icon(Icons.logout, color: Colors.redAccent),
            title: const Text('Logout'),
            onTap: () => _logout(context),
          ),
        ],
      ),
    );
  }
}
