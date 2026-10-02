import '../core/network/api_client.dart';
import '../core/storage/auth_storage.dart';

class AuthRepository {
  AuthRepository(this._apiClient, this._storage);

  final ApiClient _apiClient;
  final AuthStorage _storage;

  Future<void> login({required String email, required String password}) async {
    final response = await _apiClient.dio.post(
      '/api/auth/login',
      data: {'email': email, 'password': password},
    );
    final data = response.data as Map<String, dynamic>;
    final token = data['token']?.toString();
    if (token == null || token.isEmpty) {
      throw Exception(data['error']?.toString() ?? 'Login failed');
    }

    final user = data['user'];
    await _storage.saveSession(
      token: token,
      email: user is Map && user['email'] != null ? user['email'].toString() : email,
      name: user is Map ? user['full_name']?.toString() : null,
    );
  }

  Future<bool> hasSession() async {
    final token = await _storage.readToken();
    return token != null && token.isNotEmpty;
  }

  Future<void> logout() => _storage.clear();
}
