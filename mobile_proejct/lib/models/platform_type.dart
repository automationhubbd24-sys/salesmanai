import 'package:flutter/material.dart';

import '../core/theme/app_theme.dart';

enum PlatformType { all, messenger, whatsapp, instagram }

extension PlatformTypeX on PlatformType {
  String get title {
    switch (this) {
      case PlatformType.all:
        return 'All';
      case PlatformType.messenger:
        return 'Messenger';
      case PlatformType.whatsapp:
        return 'WhatsApp';
      case PlatformType.instagram:
        return 'Instagram';
    }
  }

  String get endpointKey {
    switch (this) {
      case PlatformType.all:
        return 'all';
      case PlatformType.messenger:
        return 'messenger';
      case PlatformType.whatsapp:
        return 'whatsapp';
      case PlatformType.instagram:
        return 'instagram';
    }
  }

  Color get color {
    switch (this) {
      case PlatformType.all:
        return AppTheme.accent;
      case PlatformType.messenger:
        return const Color(0xFF0084FF);
      case PlatformType.whatsapp:
        return const Color(0xFF25D366);
      case PlatformType.instagram:
        return const Color(0xFFE4405F);
    }
  }
}
