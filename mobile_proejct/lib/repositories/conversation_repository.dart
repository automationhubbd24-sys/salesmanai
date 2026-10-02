import 'dart:io';

import 'package:dio/dio.dart';

import '../core/network/api_client.dart';
import '../models/conversation.dart';
import '../models/message_item.dart';
import '../models/platform_type.dart';
import '../models/resource_account.dart';

class ConversationRepository {
  ConversationRepository(this._apiClient);

  final ApiClient _apiClient;

  Future<List<Conversation>> getConversations({
    required PlatformType platform,
    required List<ResourceAccount> resources,
  }) async {
    final selected = platform == PlatformType.all
        ? resources
        : resources.where((item) => item.platform == platform).toList();

    final results = await Future.wait(
      selected.map((resource) async {
        try {
          final response = await _apiClient.dio.get(_conversationPath(resource));
          final list = response.data is List ? response.data as List : const [];
          return list
              .whereType<Map>()
              .map((item) => Conversation.fromJson(
                    Map<String, dynamic>.from(item),
                    platform: resource.platform,
                    resourceId: resource.id,
                  ))
              .toList();
        } catch (_) {
          return <Conversation>[];
        }
      }),
    );

    final conversations = results.expand((items) => items).toList();
    conversations.sort((a, b) => (b.timestamp ?? 0).compareTo(a.timestamp ?? 0));
    return conversations;
  }

  Future<List<MessageItem>> getMessages({
    required PlatformType platform,
    required String resourceId,
    required String senderId,
    int limit = 40,
    int offset = 0,
  }) async {
    final response = await _apiClient.dio.get(
      _messagesPath(platform, resourceId, senderId),
      queryParameters: {'limit': limit, 'offset': offset},
    );
    final list = response.data is List ? response.data as List : const [];
    return list
        .whereType<Map>()
        .map((item) => MessageItem.fromJson(Map<String, dynamic>.from(item)))
        .toList();
  }

  Future<void> sendMessage({
    required PlatformType platform,
    required String resourceId,
    required String to,
    required String message,
    File? image,
  }) async {
    final fields = <String, dynamic>{'to': to, 'message': message};
    switch (platform) {
      case PlatformType.whatsapp:
        fields['sessionName'] = resourceId;
        break;
      case PlatformType.instagram:
        fields['accountId'] = resourceId;
        break;
      case PlatformType.messenger:
        fields['pageId'] = resourceId;
        break;
      case PlatformType.all:
        throw ArgumentError('Specific platform required for sending');
    }

    if (image != null) {
      fields['image'] = await MultipartFile.fromFile(image.path);
      await _apiClient.dio.post(_sendPath(platform), data: FormData.fromMap(fields));
      return;
    }

    await _apiClient.dio.post(_sendPath(platform), data: fields);
  }

  String _conversationPath(ResourceAccount resource) {
    switch (resource.platform) {
      case PlatformType.whatsapp:
        return '/api/whatsapp/conversations/${Uri.encodeComponent(resource.id)}';
      case PlatformType.instagram:
        return '/api/instagram/conversations/${Uri.encodeComponent(resource.id)}';
      case PlatformType.messenger:
        return '/api/messenger/conversations/${Uri.encodeComponent(resource.id)}';
      case PlatformType.all:
        return '';
    }
  }

  String _messagesPath(PlatformType platform, String resourceId, String senderId) {
    final resource = Uri.encodeComponent(resourceId);
    final sender = Uri.encodeComponent(senderId);
    switch (platform) {
      case PlatformType.whatsapp:
        return '/api/whatsapp/messages/$resource/$sender';
      case PlatformType.instagram:
        return '/api/instagram/messages/$resource/$sender';
      case PlatformType.messenger:
        return '/api/messenger/messages/$resource/$sender';
      case PlatformType.all:
        return '';
    }
  }

  String _sendPath(PlatformType platform) {
    switch (platform) {
      case PlatformType.whatsapp:
        return '/api/whatsapp/send';
      case PlatformType.instagram:
        return '/api/instagram/send';
      case PlatformType.messenger:
        return '/api/messenger/send';
      case PlatformType.all:
        return '';
    }
  }
}
