import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/theme/app_theme.dart';
import '../../repositories/auth_repository.dart';
import '../dashboard/dashboard_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _loading = false;
  bool _showPassword = false;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _login() async {
    final email = _emailController.text.trim();
    final password = _passwordController.text;
    if (email.isEmpty || password.isEmpty) {
      _showSnack('Email and password required');
      return;
    }
    setState(() => _loading = true);
    try {
      await context.read<AuthRepository>().login(email: email, password: password);
      if (!mounted) return;
      Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => const DashboardScreen()));
    } catch (error) {
      _showSnack(error.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _showSnack(String text) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: RadialGradient(
            center: Alignment.topCenter,
            radius: 1.1,
            colors: [Color(0xFF123D2B), Color(0xFF07100C), Color(0xFF020303)],
          ),
        ),
        child: SafeArea(
          child: Stack(
            children: [
              ListView(
                padding: const EdgeInsets.all(24),
                children: [
                  const SizedBox(height: 10),
                  const _BrandHeader(),
                  const SizedBox(height: 58),
                  const Text('MESSAGING COMMAND CENTER', style: TextStyle(color: AppTheme.accent, fontWeight: FontWeight.w900, fontSize: 13, letterSpacing: .4)),
                  const SizedBox(height: 12),
                  const Text('Manage every chat from one app.', style: TextStyle(fontSize: 39, height: 1.02, fontWeight: FontWeight.w900, letterSpacing: -1.4)),
                  const SizedBox(height: 12),
                  const Text(
                    'Messenger, WhatsApp and Instagram conversations stay organized, fast and ready for reply.',
                    style: TextStyle(color: Colors.white60, height: 1.55),
                  ),
                  const SizedBox(height: 30),
                  TextField(
                    controller: _emailController,
                    keyboardType: TextInputType.emailAddress,
                    textInputAction: TextInputAction.next,
                    decoration: const InputDecoration(prefixIcon: Icon(Icons.email_outlined), labelText: 'Email address'),
                  ),
                  const SizedBox(height: 15),
                  TextField(
                    controller: _passwordController,
                    obscureText: !_showPassword,
                    onSubmitted: (_) => _login(),
                    decoration: InputDecoration(
                      prefixIcon: const Icon(Icons.lock_outline),
                      labelText: 'Password',
                      suffixIcon: IconButton(
                        onPressed: () => setState(() => _showPassword = !_showPassword),
                        icon: Icon(_showPassword ? Icons.visibility_off : Icons.visibility),
                      ),
                    ),
                  ),
                  const SizedBox(height: 22),
                  ElevatedButton(
                    onPressed: _loading ? null : _login,
                    child: _loading
                        ? const SizedBox(height: 22, width: 22, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black))
                        : const Text('Sign In'),
                  ),
                  const SizedBox(height: 18),
                  const Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      _FeatureChip(icon: Icons.flash_on, text: 'Fast replies'),
                      _FeatureChip(icon: Icons.lock, text: 'Secure login'),
                      _FeatureChip(icon: Icons.forum, text: 'Unified inbox'),
                    ],
                  ),
                ],
              ),
              const Positioned(left: 24, right: 24, bottom: 24, child: _StatsCard()),
            ],
          ),
        ),
      ),
    );
  }
}

class _BrandHeader extends StatelessWidget {
  const _BrandHeader();

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          height: 58,
          width: 58,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            gradient: LinearGradient(colors: [AppTheme.accent.withValues(alpha: .22), const Color(0xFF1687FF).withValues(alpha: .1)]),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: AppTheme.accent.withValues(alpha: .38)),
            boxShadow: [BoxShadow(color: AppTheme.accent.withValues(alpha: .12), blurRadius: 32)],
          ),
          child: const Icon(Icons.bolt, color: AppTheme.accent, size: 30),
        ),
        const SizedBox(width: 12),
        const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('SalesmanAI', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900)),
            Text('Unified mobile inbox', style: TextStyle(color: Colors.white54, fontSize: 12)),
          ],
        ),
      ],
    );
  }
}

class _FeatureChip extends StatelessWidget {
  const _FeatureChip({required this.icon, required this.text});
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Chip(
      avatar: Icon(icon, size: 14, color: AppTheme.accent),
      label: Text(text),
      backgroundColor: Colors.white.withValues(alpha: .055),
      side: BorderSide(color: Colors.white.withValues(alpha: .1)),
    );
  }
}

class _StatsCard extends StatelessWidget {
  const _StatsCard();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .045),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: Colors.white.withValues(alpha: .09)),
      ),
      child: const Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          _Stat(value: '3', label: 'Platforms'),
          _Stat(value: '128', label: 'Chats'),
          _Stat(value: '12s', label: 'Refresh'),
        ],
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.value, required this.label});
  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(value, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
        Text(label, style: const TextStyle(fontSize: 12, color: Colors.white54)),
      ],
    );
  }
}
