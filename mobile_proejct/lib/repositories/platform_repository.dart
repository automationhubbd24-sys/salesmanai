import '../core/network/api_client.dart';
import '../models/platform_type.dart';
import '../models/resource_account.dart';

class PlatformRepository {
  PlatformRepository(this._apiClient);

  final ApiClient _apiClient;

  Future<List<ResourceAccount>> loadResources() async {
    final results = await Future.wait([
      _loadMessengerPages(),
      _loadWhatsAppSessions(),
      _loadInstagramPages(),
    ]);
    return results.expand((items) => items).toList();
  }

  Future<List<ResourceAccount>> _loadMessengerPages() async {
    final response = await _apiClient.dio.get('/api/messenger/pages');
    return _mapList(response.data, PlatformType.messenger);
  }

  Future<List<ResourceAccount>> _loadWhatsAppSessions() async {
    final response = await _apiClient.dio.get('/api/whatsapp/sessions');
    return _mapList(response.data, PlatformType.whatsapp);
  }

  Future<List<ResourceAccount>> _loadInstagramPages() async {
    final response = await _apiClient.dio.get('/api/instagram/pages');
    return _mapList(response.data, PlatformType.instagram);
  }

  List<ResourceAccount> _mapList(dynamic data, PlatformType platform) {
    final list = data is List ? data : const [];
    return list.map((raw) {
      final item = raw is Map ? raw : <String, dynamic>{};
      final id = _idFor(item, platform);
      final name = _nameFor(item, platform, id);
      return ResourceAccount(id: id, platform: platform, name: name);
    }).where((item) => item.id.isNotEmpty).toList();
  }

  String _idFor(Map item, PlatformType platform) {
    switch (platform) {
      case PlatformType.whatsapp:
        return '${item['session_name'] ?? item['phone_number_id'] ?? item['waba_id'] ?? ''}';
      case PlatformType.instagram:
        return '${item['instagram_account_id'] ?? item['page_id'] ?? ''}';
      case PlatformType.messenger:
        return '${item['page_id'] ?? ''}';
      case PlatformType.all:
        return '';
    }
  }

  String _nameFor(Map item, PlatformType platform, String id) {
    final value = item['name'] ?? item['page_name'] ?? item['instagram_username'] ?? item['session_name'];
    final name = value?.toString().trim();
    if (name != null && name.isNotEmpty) return name;
    return '${platform.title} $id';
  }
}
