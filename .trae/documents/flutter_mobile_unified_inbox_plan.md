# Flutter Mobile Unified Inbox Plan

## Summary

এই project-এর existing Node/Express backend এবং React web dashboard architecture পড়ে দেখা গেছে Messenger, WhatsApp এবং Instagram conversation management ইতোমধ্যে platform-specific API দিয়ে কাজ করছে। Mobile app-এর জন্য সবচেয়ে ভালো stack হবে:

- Mobile app: Flutter
- Backend: existing JavaScript/Node Express backend reuse
- Python: এই phase-এ দরকার নেই

কারণ Flutter native compiled UI দেয়, low-end/high-end সব Android/iOS phone-এ smooth চলবে, single codebase থাকবে, আর backend আগে থেকেই Messenger/WhatsApp/Instagram conversation API expose করছে। এই phase-এ basic mobile app বানানো হবে: login, unified dashboard, platform selector, conversation list, chat view, account settings, এবং “View More Info” web link।

## Current State Analysis

### Backend entry point

- `backend/src/app.js`
  - Express app route mount করে:
    - `/api/whatsapp`
    - `/api/messenger`
    - `/api/instagram`
    - `/api/auth`
  - SPA fallback আছে, কিন্তু mobile app API-only mode ব্যবহার করবে।

### Authentication

- `src/pages/Login.tsx`
  - Web login uses `POST /api/auth/login`
  - Response token `auth_token` হিসেবে store হয়।
  - Flutter app একই endpoint ব্যবহার করবে এবং JWT secure storage-এ রাখবে।

### Platform APIs

- `backend/src/routes/messengerRoutes.js`
  - `GET /api/messenger/pages`
  - `GET /api/messenger/conversations/:pageId`
  - `GET /api/messenger/messages/:pageId/:senderId`
  - `PATCH /api/messenger/conversations/:pageId/:senderId/labels`
  - `POST /api/messenger/send`

- `backend/src/routes/whatsappRoutes.js`
  - `GET /api/whatsapp/sessions`
  - `GET /api/whatsapp/conversations/:sessionName`
  - `GET /api/whatsapp/messages/:sessionName/:senderId`
  - `PATCH /api/whatsapp/conversations/:sessionName/:senderId/labels`
  - `POST /api/whatsapp/send`
  - Legacy WhatsApp QR/session routes retired, so app must use official WhatsApp Cloud sessions only.

- `backend/src/routes/instagramRoutes.js`
  - `GET /api/instagram/pages`
  - `GET /api/instagram/conversations/:accountId`
  - `GET /api/instagram/messages/:accountId/:senderId`
  - `PATCH /api/instagram/conversations/:accountId/:senderId/labels`
  - `POST /api/instagram/send`

### Smart Inbox normalization

- `backend/src/utils/smartInbox.js`
  - Existing `getSmartInboxConversations()` already Messenger, WhatsApp, Instagram data normalize করে।
  - Unified conversation response fields:
    - `id`
    - `from`
    - `name`
    - `body`
    - `timestamp`
    - `reply_by`
    - `primary_label`
    - `active_labels`
    - `has_order`
    - `order_status`
    - `order_selected`
    - `human_transfer_selected`
  - Flutter list UI এই payload সরাসরি ব্যবহার করতে পারবে।

### Existing web dashboard pattern

- `src/pages/dashboard/SmartInbox.tsx`
  - Web dashboard currently platform-specific smart inbox route থেকে data fetch করে।
  - Existing polling:
    - Conversation list: 30 seconds
    - Messages: 12 seconds
  - Existing UI has:
    - Platform theme
    - Conversation list
    - Chat details
    - Filters: All, Agent, Human, Order, Human Transfer
    - Image upload/send
    - Message cleanup/media extraction

- `src/pages/dashboard/PlatformSelection.tsx`
  - Web dashboard design dark theme + green accent based.
  - Flutter app should follow this visual system.

## Proposed Changes

### 1. Create Flutter mobile app structure

Create a new Flutter app folder in the project root:

- `mobile/`

Recommended structure:

- `mobile/lib/main.dart`
- `mobile/lib/app.dart`
- `mobile/lib/core/config/app_config.dart`
- `mobile/lib/core/network/api_client.dart`
- `mobile/lib/core/storage/auth_storage.dart`
- `mobile/lib/core/theme/app_theme.dart`
- `mobile/lib/features/auth/login_screen.dart`
- `mobile/lib/features/dashboard/dashboard_screen.dart`
- `mobile/lib/features/inbox/inbox_screen.dart`
- `mobile/lib/features/inbox/chat_screen.dart`
- `mobile/lib/features/settings/account_settings_screen.dart`
- `mobile/lib/models/platform_type.dart`
- `mobile/lib/models/resource_account.dart`
- `mobile/lib/models/conversation.dart`
- `mobile/lib/models/message_item.dart`
- `mobile/lib/repositories/auth_repository.dart`
- `mobile/lib/repositories/platform_repository.dart`
- `mobile/lib/repositories/conversation_repository.dart`

Why:

- App শুরু থেকেই clean feature-based structure পাবে।
- Later web dashboard-এর আরও features mobile app-এ আনতে সহজ হবে।

### 2. Flutter dependencies

Use minimal fast dependencies:

- `dio` for HTTP requests + interceptors
- `flutter_secure_storage` for JWT token
- `provider` or `riverpod` for lightweight state management
- `url_launcher` for `salesmanchatbot.online` opening
- `image_picker` for optional image sending
- `cached_network_image` only if remote/media images display দরকার হয়

Decision:

- State management: `provider`
- Reason: basic app, fast implementation, low overhead, enough for current conversion management phase.

### 3. Auth flow

Implement in:

- `mobile/lib/features/auth/login_screen.dart`
- `mobile/lib/repositories/auth_repository.dart`
- `mobile/lib/core/storage/auth_storage.dart`

Flow:

1. User email/password submit করবে।
2. `POST {BACKEND_URL}/api/auth/login`
3. Success হলে JWT secure storage-এ save হবে।
4. App dashboard screen-এ যাবে।
5. App start হলে token থাকলে dashboard, না থাকলে login screen।

Design:

- Existing `src/pages/Login.tsx` dark UI follow করা হবে:
  - black background
  - green `#00ff88` accent
  - rounded inputs/buttons
  - fast tap feedback with small scale/opacity effect

### 4. Platform/resource loading

Implement in:

- `mobile/lib/repositories/platform_repository.dart`
- `mobile/lib/features/dashboard/dashboard_screen.dart`

Load available connected accounts:

- Messenger: `GET /api/messenger/pages`
- WhatsApp: `GET /api/whatsapp/sessions`
- Instagram: `GET /api/instagram/pages`

Normalize into one model:

```dart
enum PlatformType { all, messenger, whatsapp, instagram }

class ResourceAccount {
  final String id;
  final PlatformType platform;
  final String name;
}
```

Dashboard platform selector:

- All
- Messenger
- WhatsApp
- Instagram

Behavior:

- User “All” select করলে all connected platform/resource conversations এক dashboard list-এ merge হবে।
- User specific platform select করলে only that platform-এর conversations দেখাবে।
- Conversation tile-এ platform badge থাকবে: Messenger / WhatsApp / Instagram।

### 5. Conversation repository

Implement in:

- `mobile/lib/repositories/conversation_repository.dart`

Methods:

```dart
Future<List<Conversation>> getConversations({
  required PlatformType platform,
  required List<ResourceAccount> resources,
});

Future<List<MessageItem>> getMessages({
  required PlatformType platform,
  required String resourceId,
  required String senderId,
  int limit = 40,
  int offset = 0,
});

Future<void> sendMessage({
  required PlatformType platform,
  required String resourceId,
  required String to,
  required String message,
  File? image,
});
```

Endpoint adapter rules:

- WhatsApp:
  - conversations: `/api/whatsapp/conversations/{sessionName}`
  - messages: `/api/whatsapp/messages/{sessionName}/{senderId}`
  - send body key: `sessionName`

- Messenger:
  - conversations: `/api/messenger/conversations/{pageId}`
  - messages: `/api/messenger/messages/{pageId}/{senderId}`
  - send body key: `pageId`

- Instagram:
  - conversations: `/api/instagram/conversations/{accountId}`
  - messages: `/api/instagram/messages/{accountId}/{senderId}`
  - send body key: `accountId`

All mode:

- App parallel requests করবে all connected resources-এর জন্য।
- Result merge করে `timestamp` desc sort করবে।
- Every `Conversation` object-এ `platform` এবং `resourceId` attach থাকবে।

### 6. Dashboard UI

Implement in:

- `mobile/lib/features/dashboard/dashboard_screen.dart`
- `mobile/lib/features/inbox/inbox_screen.dart`
- `mobile/lib/features/inbox/chat_screen.dart`

Dashboard layout:

- Top app bar:
  - SalesmanAI title/logo style
  - Account/settings icon
- Platform selector chips:
  - All
  - Messenger
  - WhatsApp
  - Instagram
- Filter row:
  - All
  - Agent
  - Human
  - Order
  - Human Transfer
- Conversation list:
  - avatar/initial
  - customer name or sender id
  - latest message preview
  - platform badge
  - label chips
  - latest timestamp
- Chat screen:
  - header with customer name + platform badge
  - message bubbles based on `reply_by`
  - input composer
  - send button
  - optional image attach

Performance decisions:

- Use `ListView.builder` for conversation/message lists.
- Avoid heavy animations.
- Cache loaded conversations in memory.
- Abort/ignore stale requests using request versioning.
- Pull-to-refresh plus polling.
- Show skeleton/loading only where needed, not full-screen reload after first load.

### 7. Polling and freshness

For first version, match existing web behavior from `src/pages/dashboard/SmartInbox.tsx`:

- Conversation refresh: every 30 seconds
- Selected chat messages refresh: every 12 seconds

Optimization:

- Immediate optimistic update after sending a message.
- Silent refresh should not rebuild whole screen if data signature unchanged.
- Later phase can add WebSocket/SSE backend endpoint if real-time push is required.

### 8. Account settings

Implement in:

- `mobile/lib/features/settings/account_settings_screen.dart`

Initial settings:

- User email/name display from login response if available
- Logout
- Clear local token
- App version placeholder
- Connected platform summary count

Do not implement full web settings yet in this basic phase.

### 9. View more info

Add button/menu item:

- Label: “View More Info”
- Action: open `https://salesmanchatbot.online` using `url_launcher`

This should be available from dashboard and settings.

### 10. Backend changes for this phase

No major backend rewrite required.

Only add backend endpoint if implementation finds “All” mode too slow from multiple mobile requests. Optional later endpoint:

- `GET /api/mobile/conversations?platform=all|messenger|whatsapp|instagram`

But first implementation should reuse existing stable platform routes to avoid unnecessary backend changes.

## Assumptions & Decisions

- Flutter is selected as mobile language/framework because user wants fast, smooth, all-phone support.
- Existing Node/Express backend will remain the API backend.
- Python will not be used in this phase.
- This phase focuses only on conversion/conversation management, not full website conversion.
- App design will follow current web dashboard dark theme and green accent.
- Existing JWT auth will be reused.
- Existing platform APIs will be reused first; backend unified mobile endpoint is optional later.
- WhatsApp will use official Cloud API sessions only; retired legacy QR routes will not be used.
- “Facebook” conversation management means Messenger/Page inbox in the current backend.

## Verification Steps

After implementation:

1. Run Flutter dependency install:
   - `flutter pub get`
2. Static analysis:
   - `flutter analyze`
3. Launch app:
   - `flutter run`
4. Verify auth:
   - Login with existing web credentials.
   - Token persists after app restart.
   - Logout clears token.
5. Verify platform data:
   - Messenger pages load from `/api/messenger/pages`.
   - WhatsApp sessions load from `/api/whatsapp/sessions`.
   - Instagram accounts load from `/api/instagram/pages`.
6. Verify dashboard selection:
   - All shows merged conversations with platform badge.
   - Messenger shows only Messenger conversations.
   - WhatsApp shows only WhatsApp conversations.
   - Instagram shows only Instagram conversations.
7. Verify chat:
   - Open conversation.
   - Messages load.
   - Send text message.
   - Message appears optimistically and persists after refresh.
8. Verify settings:
   - Account settings opens.
   - View More Info opens `https://salesmanchatbot.online`.
9. Performance check:
   - Conversation list scroll is smooth.
   - Button clicks have immediate visual response.
   - No full-screen reload during silent polling.
