import 'platform_type.dart';

class ResourceAccount {
  const ResourceAccount({
    required this.id,
    required this.platform,
    required this.name,
  });

  final String id;
  final PlatformType platform;
  final String name;
}
