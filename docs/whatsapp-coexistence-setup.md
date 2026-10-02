# WhatsApp Coexistence Setup

This project supports Meta Embedded Signup for WhatsApp Business App coexistence.

## Meta Developer Checklist

1. Create or open your Meta app.
2. Add the `WhatsApp` product to the app.
3. Configure the webhook callback URL:
   - Primary: `<YOUR_BACKEND_URL>/webhook/whatsapp`
   - Backward-compatible: `<YOUR_BACKEND_URL>/api/whatsapp/webhook`
4. Set the webhook verify token to the same value as `WHATSAPP_OFFICIAL_VERIFY_TOKEN`.
5. Make sure the app has access to:
   - `whatsapp_business_management`
   - `whatsapp_business_messaging`
   - `business_management`
6. Generate an Embedded Signup configuration ID and place it in `VITE_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID`.
7. Set the Meta app ID in both:
   - `FACEBOOK_APP_ID` (backend)
   - `VITE_FACEBOOK_APP_ID` (frontend)
8. Set the Meta app secret in `FACEBOOK_APP_SECRET`.

## Coexistence Flow

1. Open the WhatsApp integration page in the dashboard.
2. Click `Connect WhatsApp Business`.
3. In the Meta popup, log in with the correct Facebook business account.
4. Select the existing WhatsApp Business App number if you want coexistence.
5. Complete verification and consent inside the popup.
6. After connection, open WhatsApp settings and configure:
   - AI provider/model
   - System prompt
   - Image prompt
   - Reply delay
   - Memory context limit
   - Order notification email

## Important Notes

- The backend automatically subscribes the app to the connected WABA.
- Disconnecting a connected number unsubscribes the app from the WABA and removes the local connection row.
- Official webhook processing now supports text, image, and audio-aware AI flow.
- The same number can still be used from the WhatsApp Business App when coexistence is selected in the Meta flow.
