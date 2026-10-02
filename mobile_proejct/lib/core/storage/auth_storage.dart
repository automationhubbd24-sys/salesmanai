import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class AuthStorage {
  const AuthStorage();

  static const _storage = FlutterSecureStorage();
  static const _tokenKey = 'auth_token';
  static const _emailKey = 'auth_email';
  static const _nameKey = 'auth_name';

  Future<String?> readToken() => _storage.read(key: _tokenKey);
  Future<String?> readEmail() => _storage.read(key: _emailKey);
  Future<String?> readName() => _storage.read(key: _nameKey);

  Future<void> saveSession({
    required String token,
    String? email,
    String? name,
  }) async {
    await _storage.write(key: _tokenKey, value: token);
    if (email != null) await _storage.write(key: _emailKey, value: email);
    if (name != null) await _storage.write(key: _nameKey, value: name);
  }

  Future<void> clear() => _storage.deleteAll();
}
