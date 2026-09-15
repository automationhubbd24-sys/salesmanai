import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/config/app_config.dart';
import '../../core/theme/app_theme.dart';
import '../../models/conversation.dart';
import '../../models/platform_type.dart';
import '../../models/resource_account.dart';
import '../../repositories/conversation_repository.dart';
import '../../repositories/platform_repository.dart';
import '../inbox/chat_screen.dart';
import '../settings/account_settings_screen.dart';

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  final _platforms = PlatformType.values;
  final _filters = const ['all', 'agent', 'human', 'order', 'human_transfer'];
  PlatformType _selectedPlatform = PlatformType.all;
  String _selectedFilter = 'all';
  List<ResourceAccount> _resources = [];
  List<Conversation> _conversations = [];
  bool _loading = true;
  String? _error;
  Timer? _pollTimer;
  int _requestVersion = 0;

  @override
  void initState() {
    super.initState();
    _loadInitial();
    _pollTimer = Timer.periodic(
        AppConfig.chatPollInterval, (_) => _loadConversations(silent: true));
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    super.dispose();
  }

  Future<void> _loadInitial() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      _resources = await context.read<PlatformRepository>().loadResources();
      await _loadConversations(silent: true);
    } catch (error) {
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _loadConversations({bool silent = false}) async {
    final version = ++_requestVersion;
    if (!silent) setState(() => _loading = true);
    final data = await context.read<ConversationRepository>().getConversations(
          platform: _selectedPlatform,
          resources: _resources,
        );
    if (!mounted || version != _requestVersion) return;
    setState(() {
      _conversations = data;
      _loading = false;
      _error = null;
    });
  }

  List<Conversation> get _filteredConversations {
    if (_selectedFilter == 'all') return _conversations;
    return _conversations
        .where((item) => item.activeLabels.contains(_selectedFilter))
        .toList();
  }

  Future<void> _openMoreInfo() async {
    await launchUrl(Uri.parse(AppConfig.moreInfoUrl),
        mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    final conversations = _filteredConversations;
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
          child: RefreshIndicator(
            onRefresh: _loadInitial,
            child: CustomScrollView(
              slivers: [
                SliverToBoxAdapter(
                    child: _TopBar(
                        onInfo: _openMoreInfo, onSettings: _openSettings)),
                const SliverToBoxAdapter(child: _SearchBox()),
                SliverToBoxAdapter(
                    child: _PlatformSelector(
                        platforms: _platforms,
                        selected: _selectedPlatform,
                        onChanged: _selectPlatform)),
                SliverToBoxAdapter(
                    child: _InsightCard(
                        resources: _resources,
                        conversations: _conversations.length)),
                SliverToBoxAdapter(
                    child: _FilterSelector(
                        filters: _filters,
                        selected: _selectedFilter,
                        onChanged: (v) => setState(() => _selectedFilter = v))),
                const SliverToBoxAdapter(child: _SectionHeader()),
                if (_loading)
                  const SliverFillRemaining(
                      child: Center(child: CircularProgressIndicator()))
                else if (_error != null)
                  const SliverFillRemaining(
                      child: Center(
                          child: Padding(
                              padding: EdgeInsets.all(24),
                              child: Text('Could not load conversations',
                                  textAlign: TextAlign.center))))
                else if (conversations.isEmpty)
                  const SliverFillRemaining(
                      child: Center(child: Text('No conversations found')))
                else
                  SliverPadding(
                    padding: const EdgeInsets.fromLTRB(14, 0, 14, 92),
                    sliver: SliverList.builder(
                      itemCount: conversations.length,
                      itemBuilder: (context, index) => _ConversationTile(
                        conversation: conversations[index],
                        onTap: () => Navigator.of(context).push(
                          MaterialPageRoute(
                              builder: (_) => ChatScreen(
                                  conversation: conversations[index])),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
      bottomNavigationBar: const _BottomNav(),
    );
  }

  void _openSettings() {
    Navigator.of(context).push(MaterialPageRoute(
        builder: (_) =>
            AccountSettingsScreen(connectedCount: _resources.length)));
  }

  void _selectPlatform(PlatformType platform) {
    setState(() {
      _selectedPlatform = platform;
      _selectedFilter = 'all';
    });
    _loadConversations();
  }
}

class _TopBar extends StatelessWidget {
  const _TopBar({required this.onInfo, required this.onSettings});
  final VoidCallback onInfo;
  final VoidCallback onSettings;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 8),
      child: Row(
        children: [
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Inbox',
                    style: TextStyle(
                        fontSize: 30,
                        fontWeight: FontWeight.w900,
                        letterSpacing: -1)),
                Text('All customer conversations',
                    style: TextStyle(color: Colors.white54, fontSize: 13)),
              ],
            ),
          ),
          _RoundButton(icon: Icons.info_outline, onTap: onInfo),
          const SizedBox(width: 8),
          _RoundButton(icon: Icons.settings_outlined, onTap: onSettings),
        ],
      ),
    );
  }
}

class _SearchBox extends StatelessWidget {
  const _SearchBox();

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 48,
      margin: const EdgeInsets.fromLTRB(20, 14, 20, 14),
      padding: const EdgeInsets.symmetric(horizontal: 15),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .06),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.white.withValues(alpha: .09)),
      ),
      child: const Row(
        children: [
          Icon(Icons.search, color: Colors.white54),
          SizedBox(width: 10),
          Text('Search customers or messages',
              style: TextStyle(color: Colors.white54)),
        ],
      ),
    );
  }
}

class _InsightCard extends StatelessWidget {
  const _InsightCard({required this.resources, required this.conversations});
  final List<ResourceAccount> resources;
  final int conversations;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(20, 0, 20, 14),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppTheme.accent.withValues(alpha: .08),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: AppTheme.accent.withValues(alpha: .15)),
      ),
      child: Row(
        children: [
          const _RoundBadge(icon: Icons.query_stats),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Unified Conversations',
                    style: TextStyle(fontWeight: FontWeight.w900)),
                Text(
                    '${resources.length} accounts connected • $conversations conversations',
                    style:
                        const TextStyle(color: Colors.white54, fontSize: 12)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _PlatformSelector extends StatelessWidget {
  const _PlatformSelector(
      {required this.platforms,
      required this.selected,
      required this.onChanged});
  final List<PlatformType> platforms;
  final PlatformType selected;
  final ValueChanged<PlatformType> onChanged;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 45,
      child: ListView.separated(
        padding: const EdgeInsets.symmetric(horizontal: 20),
        scrollDirection: Axis.horizontal,
        itemCount: platforms.length,
        separatorBuilder: (_, __) => const SizedBox(width: 9),
        itemBuilder: (context, index) {
          final platform = platforms[index];
          final isSelected = selected == platform;
          return ChoiceChip(
            selected: isSelected,
            label: Text(platform.title),
            onSelected: (_) => onChanged(platform),
            selectedColor: AppTheme.accent,
            backgroundColor: Colors.white.withValues(alpha: .055),
            side: BorderSide(
                color: isSelected
                    ? Colors.transparent
                    : Colors.white.withValues(alpha: .09)),
            labelStyle: TextStyle(
                color: isSelected ? Colors.black : Colors.white,
                fontWeight: FontWeight.w900),
          );
        },
      ),
    );
  }
}

class _FilterSelector extends StatelessWidget {
  const _FilterSelector(
      {required this.filters, required this.selected, required this.onChanged});
  final List<String> filters;
  final String selected;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 40,
      child: ListView.separated(
        padding: const EdgeInsets.symmetric(horizontal: 20),
        scrollDirection: Axis.horizontal,
        itemCount: filters.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (context, index) {
          final filter = filters[index];
          return FilterChip(
            selected: selected == filter,
            label: Text(_title(filter)),
            onSelected: (_) => onChanged(filter),
            backgroundColor: Colors.white.withValues(alpha: .055),
            side: BorderSide(color: Colors.white.withValues(alpha: .09)),
          );
        },
      ),
    );
  }

  String _title(String value) => value
      .split('_')
      .map((part) => part[0].toUpperCase() + part.substring(1))
      .join(' ');
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.fromLTRB(20, 12, 20, 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text('Priority chats', style: TextStyle(fontWeight: FontWeight.w900)),
          Text('View all',
              style: TextStyle(
                  color: AppTheme.accent,
                  fontSize: 12,
                  fontWeight: FontWeight.w900)),
        ],
      ),
    );
  }
}

class _ConversationTile extends StatelessWidget {
  const _ConversationTile({required this.conversation, required this.onTap});
  final Conversation conversation;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(24),
        child: Container(
          padding: const EdgeInsets.all(13),
          decoration: BoxDecoration(
            gradient: LinearGradient(colors: [
              Colors.white.withValues(alpha: .065),
              Colors.white.withValues(alpha: .035)
            ]),
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: Colors.white.withValues(alpha: .055)),
          ),
          child: Row(
            children: [
              _Avatar(
                  name: conversation.displayName,
                  color: conversation.platform.color),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                            child: Text(conversation.displayName,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                    fontWeight: FontWeight.w900))),
                        Text(_timeLabel(conversation.timestamp),
                            style: const TextStyle(
                                color: Colors.white54, fontSize: 11)),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(conversation.body,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            color: Colors.white54, fontSize: 13)),
                    const SizedBox(height: 7),
                    Row(
                      children: [
                        _Badge(
                            text: conversation.platform.title,
                            color: conversation.platform.color),
                        const SizedBox(width: 6),
                        ...conversation.activeLabels.take(1).map((label) =>
                            _Badge(
                                text: label.replaceAll('_', ' '),
                                color: AppTheme.accent)),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Container(
                height: 21,
                width: 21,
                alignment: Alignment.center,
                decoration: const BoxDecoration(
                    color: AppTheme.accent, shape: BoxShape.circle),
                child: const Text('1',
                    style: TextStyle(
                        color: Colors.black,
                        fontWeight: FontWeight.w900,
                        fontSize: 11)),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _timeLabel(int? timestamp) {
    if (timestamp == null) return '';
    final date = DateTime.fromMillisecondsSinceEpoch(
        timestamp < 10000000000 ? timestamp * 1000 : timestamp);
    final diff = DateTime.now().difference(date);
    if (diff.inMinutes < 1) return 'now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m';
    if (diff.inHours < 24) return '${diff.inHours}h';
    return '${diff.inDays}d';
  }
}

class _Avatar extends StatelessWidget {
  const _Avatar({required this.name, required this.color});
  final String name;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 50,
      width: 50,
      alignment: Alignment.center,
      decoration: BoxDecoration(
          color: color.withValues(alpha: .18),
          borderRadius: BorderRadius.circular(18)),
      child: Text(name.substring(0, 1).toUpperCase(),
          style: const TextStyle(fontWeight: FontWeight.w900)),
    );
  }
}

class _Badge extends StatelessWidget {
  const _Badge({required this.text, required this.color});
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
          color: color.withValues(alpha: .13),
          borderRadius: BorderRadius.circular(20)),
      child: Text(text,
          style: TextStyle(
              color: color, fontSize: 10, fontWeight: FontWeight.w900)),
    );
  }
}

class _BottomNav extends StatelessWidget {
  const _BottomNav();

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 72,
      margin: const EdgeInsets.fromLTRB(18, 0, 18, 14),
      decoration: BoxDecoration(
        color: const Color(0xEE0E1211),
        borderRadius: BorderRadius.circular(26),
        border: Border.all(color: Colors.white.withValues(alpha: .09)),
      ),
      child: const Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          _NavItem(icon: Icons.forum, label: 'Inbox', active: true),
          _NavItem(icon: Icons.push_pin_outlined, label: 'Platforms'),
          _NavItem(icon: Icons.person_outline, label: 'Account'),
        ],
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  const _NavItem(
      {required this.icon, required this.label, this.active = false});
  final IconData icon;
  final String label;
  final bool active;

  @override
  Widget build(BuildContext context) {
    final color = active ? AppTheme.accent : Colors.white54;
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Icon(icon, color: color, size: 22),
        const SizedBox(height: 3),
        Text(label,
            style: TextStyle(
                color: color, fontSize: 11, fontWeight: FontWeight.w700)),
      ],
    );
  }
}

class _RoundButton extends StatelessWidget {
  const _RoundButton({required this.icon, required this.onTap});
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(99),
      child: Container(
        height: 38,
        width: 38,
        decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: .06),
            shape: BoxShape.circle,
            border: Border.all(color: Colors.white.withValues(alpha: .09))),
        child: Icon(icon, size: 19),
      ),
    );
  }
}

class _RoundBadge extends StatelessWidget {
  const _RoundBadge({required this.icon});
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 38,
      width: 38,
      decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: .06),
          shape: BoxShape.circle,
          border: Border.all(color: Colors.white.withValues(alpha: .09))),
      child: Icon(icon, color: AppTheme.accent, size: 20),
    );
  }
}
