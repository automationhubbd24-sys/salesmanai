import 'platform_type.dart';

class Conversation {
  const Conversation({
    required this.id,
    required this.from,
    required this.body,
    required this.platform,
    required this.resourceId,
    this.name,
    this.timestamp,
    this.replyBy,
    this.primaryLabel,
    this.activeLabels = const [],
    this.hasOrder = false,
    this.orderStatus,
    this.orderSelected = false,
    this.humanTransferSelected = false,
  });

  final String id;
  final String from;
  final String? name;
  final String body;
  final int? timestamp;
  final String? replyBy;
  final String? primaryLabel;
  final List<String> activeLabels;
  final bool hasOrder;
  final String? orderStatus;
  final bool orderSelected;
  final bool humanTransferSelected;
  final PlatformType platform;
  final String resourceId;

  String get displayName => (name == null || name!.trim().isEmpty) ? from : name!;

  factory Conversation.fromJson(
    Map<String, dynamic> json, {
    required PlatformType platform,
    required String resourceId,
  }) {
    final labels = json['active_labels'];
    return Conversation(
      id: '${json['id'] ?? json['from'] ?? ''}',
      from: '${json['from'] ?? json['id'] ?? ''}',
      name: json['name']?.toString(),
      body: json['body']?.toString() ?? '',
      timestamp: _parseTimestamp(json['timestamp']),
      replyBy: json['reply_by']?.toString(),
      primaryLabel: json['primary_label']?.toString(),
      activeLabels: labels is List ? labels.map((e) => '$e').toList() : const [],
      hasOrder: json['has_order'] == true,
      orderStatus: json['order_status']?.toString(),
      orderSelected: json['order_selected'] == true,
      humanTransferSelected: json['human_transfer_selected'] == true,
      platform: platform,
      resourceId: resourceId,
    );
  }

  static int? _parseTimestamp(dynamic value) {
    if (value == null) return null;
    if (value is int) return value;
    if (value is double) return value.round();
    return int.tryParse('$value');
  }
}
