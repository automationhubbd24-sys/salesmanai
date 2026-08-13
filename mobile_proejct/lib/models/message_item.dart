class MessageItem {
  const MessageItem({
    required this.from,
    required this.body,
    this.timestamp,
    this.isAi = false,
    this.replyBy,
  });

  final String from;
  final String body;
  final int? timestamp;
  final bool isAi;
  final String? replyBy;

  bool get isOutbound => replyBy == 'bot' || replyBy == 'admin' || isAi;

  factory MessageItem.fromJson(Map<String, dynamic> json) {
    return MessageItem(
      from: json['from']?.toString() ?? '',
      body: json['body']?.toString() ?? json['text']?.toString() ?? '',
      timestamp: _parseTimestamp(json['timestamp']),
      isAi: json['is_ai'] == true,
      replyBy: json['reply_by']?.toString(),
    );
  }

  static int? _parseTimestamp(dynamic value) {
    if (value == null) return null;
    if (value is int) return value;
    if (value is double) return value.round();
    return int.tryParse('$value');
  }
}
