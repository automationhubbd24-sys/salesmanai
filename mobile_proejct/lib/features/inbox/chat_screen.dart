import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../../core/config/app_config.dart';
import '../../core/theme/app_theme.dart';
import '../../models/conversation.dart';
import '../../models/message_item.dart';
import '../../models/platform_type.dart';
import '../../repositories/conversation_repository.dart';

class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key, required this.conversation});

  final Conversation conversation;

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final _messageController = TextEditingController();
  final _scrollController = ScrollController();
  final _imagePicker = ImagePicker();
  List<MessageItem> _messages = [];
  bool _loading = true;
  bool _sending = false;
  File? _image;
  Timer? _pollTimer;
  int _requestVersion = 0;

  @override
  void initState() {
    super.initState();
    _loadMessages();
    _pollTimer = Timer.periodic(
        AppConfig.messagePollInterval, (_) => _loadMessages(silent: true));
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    _messageController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _loadMessages({bool silent = false}) async {
    final version = ++_requestVersion;
    if (!silent) setState(() => _loading = true);
    try {
      final data = await context.read<ConversationRepository>().getMessages(
            platform: widget.conversation.platform,
            resourceId: widget.conversation.resourceId,
            senderId: widget.conversation.id,
          );
      if (!mounted || version != _requestVersion) return;
      setState(() {
        _messages = data;
        _loading = false;
      });
      _scrollBottom();
    } catch (error) {
      if (!silent && mounted) {
        setState(() => _loading = false);
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Message load failed: $error')));
      }
    }
  }

  Future<void> _pickImage() async {
    final picked = await _imagePicker.pickImage(
        source: ImageSource.gallery, imageQuality: 82);
    if (picked != null) setState(() => _image = File(picked.path));
  }

  Future<void> _send() async {
    final text = _messageController.text.trim();
    if (text.isEmpty && _image == null) return;
    setState(() => _sending = true);

    final optimistic = MessageItem(
      from: 'admin',
      body: text.isEmpty ? 'Sent an image' : text,
      timestamp: DateTime.now().millisecondsSinceEpoch,
      replyBy: 'admin',
    );
    setState(() {
      _messages = [..._messages, optimistic];
      _messageController.clear();
    });
    _scrollBottom();

    try {
      await context.read<ConversationRepository>().sendMessage(
            platform: widget.conversation.platform,
            resourceId: widget.conversation.resourceId,
            to: widget.conversation.id,
            message: text,
            image: _image,
          );
      setState(() => _image = null);
      await _loadMessages(silent: true);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Send failed: $error')));
      }
    } finally {
      if (mounted) {
        setState(() => _sending = false);
      }
    }
  }

  void _scrollBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scrollController.hasClients) return;
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 180),
        curve: Curves.easeOut,
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.conversation;
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
          child: Column(
            children: [
              _ChatHeader(conversation: c),
              Expanded(
                child: _loading
                    ? const Center(child: CircularProgressIndicator())
                    : ListView.builder(
                        controller: _scrollController,
                        padding: const EdgeInsets.fromLTRB(14, 18, 14, 18),
                        itemCount: _messages.length + 1,
                        itemBuilder: (context, index) {
                          if (index == 0) return const _DayPill();
                          return _MessageBubble(
                              message: _messages[index - 1],
                              accent: c.platform.color);
                        },
                      ),
              ),
              if (_image != null)
                _SelectedImage(onClear: () => setState(() => _image = null)),
              _Composer(
                controller: _messageController,
                sending: _sending,
                onAttach: _pickImage,
                onSend: _send,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ChatHeader extends StatelessWidget {
  const _ChatHeader({required this.conversation});
  final Conversation conversation;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(8, 12, 14, 12),
      decoration: BoxDecoration(
          border: Border(
              bottom: BorderSide(color: Colors.white.withValues(alpha: .09)))),
      child: Row(
        children: [
          IconButton(
              onPressed: () => Navigator.of(context).pop(),
              icon: const Icon(Icons.chevron_left,
                  size: 32, color: Colors.white70)),
          Container(
            height: 50,
            width: 50,
            alignment: Alignment.center,
            decoration: BoxDecoration(
                color: conversation.platform.color.withValues(alpha: .18),
                borderRadius: BorderRadius.circular(18)),
            child: Text(conversation.displayName.substring(0, 1).toUpperCase(),
                style: const TextStyle(fontWeight: FontWeight.w900)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(conversation.displayName,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontWeight: FontWeight.w900)),
                Text('${conversation.platform.title} • online now',
                    style: TextStyle(
                        color: conversation.platform.color,
                        fontSize: 12,
                        fontWeight: FontWeight.w800)),
              ],
            ),
          ),
          Container(
            height: 38,
            width: 38,
            decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: .06),
                shape: BoxShape.circle,
                border: Border.all(color: Colors.white.withValues(alpha: .09))),
            child: const Icon(Icons.more_horiz),
          ),
        ],
      ),
    );
  }
}

class _DayPill extends StatelessWidget {
  const _DayPill();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Container(
        margin: const EdgeInsets.only(bottom: 18),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: .055),
            borderRadius: BorderRadius.circular(999)),
        child: const Text('Today',
            style: TextStyle(color: Colors.white54, fontSize: 11)),
      ),
    );
  }
}

class _SelectedImage extends StatelessWidget {
  const _SelectedImage({required this.onClear});
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(14, 0, 14, 8),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: .06),
          borderRadius: BorderRadius.circular(16)),
      child: Row(
        children: [
          const Icon(Icons.image, color: AppTheme.accent),
          const SizedBox(width: 8),
          const Expanded(child: Text('Image selected')),
          IconButton(onPressed: onClear, icon: const Icon(Icons.close)),
        ],
      ),
    );
  }
}

class _Composer extends StatelessWidget {
  const _Composer(
      {required this.controller,
      required this.sending,
      required this.onAttach,
      required this.onSend});
  final TextEditingController controller;
  final bool sending;
  final VoidCallback onAttach;
  final VoidCallback onSend;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
        decoration: BoxDecoration(
            color: const Color(0xEE050706),
            border: Border(
                top: BorderSide(color: Colors.white.withValues(alpha: .09)))),
        child: Row(
          children: [
            InkWell(
              onTap: onAttach,
              borderRadius: BorderRadius.circular(99),
              child: Container(
                height: 42,
                width: 42,
                decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: .06),
                    shape: BoxShape.circle),
                child: const Icon(Icons.add, color: Colors.white70),
              ),
            ),
            const SizedBox(width: 9),
            Expanded(
              child: TextField(
                controller: controller,
                minLines: 1,
                maxLines: 4,
                textInputAction: TextInputAction.send,
                onSubmitted: (_) => onSend(),
                decoration:
                    const InputDecoration(hintText: 'Reply as admin...'),
              ),
            ),
            const SizedBox(width: 9),
            FloatingActionButton.small(
              onPressed: sending ? null : onSend,
              backgroundColor: AppTheme.accent,
              foregroundColor: Colors.black,
              child: sending
                  ? const SizedBox(
                      height: 18,
                      width: 18,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.black))
                  : const Icon(Icons.send),
            ),
          ],
        ),
      ),
    );
  }
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble({required this.message, required this.accent});
  final MessageItem message;
  final Color accent;

  @override
  Widget build(BuildContext context) {
    final outbound = message.isOutbound;
    final isBot = message.replyBy == 'bot';
    final color = isBot
        ? const Color(0x2A1687FF)
        : outbound
            ? accent
            : Colors.white.withValues(alpha: .08);
    final textColor = outbound && !isBot ? Colors.black : Colors.white;
    return Align(
      alignment: outbound ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints:
            BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * .76),
        margin: const EdgeInsets.symmetric(vertical: 5),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: color,
          border: isBot ? Border.all(color: const Color(0x3A1687FF)) : null,
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(20),
            topRight: const Radius.circular(20),
            bottomLeft: Radius.circular(outbound ? 20 : 6),
            bottomRight: Radius.circular(outbound ? 6 : 20),
          ),
          boxShadow: [
            BoxShadow(
                color: Colors.black.withValues(alpha: .18),
                blurRadius: 20,
                offset: const Offset(0, 8))
          ],
        ),
        child: Text(message.body,
            style: TextStyle(color: textColor, height: 1.38)),
      ),
    );
  }
}
