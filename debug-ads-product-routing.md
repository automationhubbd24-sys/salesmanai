# Debug Session: ads-product-routing

Status: [OPEN]

## Bug
Ads থেকে আসা user যে product link করে আসে, Messenger/WhatsApp/Instagram-এ সেই product-এর answer না দিয়ে অন্য product-এর answer দেওয়া হচ্ছে।

## Hypotheses
1. Ad click payload/referral data থেকে product identifier/channel context correctly parse হচ্ছে না।
2. Product lookup query ভুল key/slug/id দিয়ে চলছে, তাই fallback বা first matched product চলে যাচ্ছে।
3. Conversation/session state আগের product context ধরে রাখছে এবং ads referral product context override করছে না।
4. Messenger, WhatsApp, Instagram adapter-গুলোর incoming metadata mapping inconsistent।
5. AI answer generation-এ selected product context হারিয়ে generic/other product context inject হচ্ছে।

## Evidence Plan
- Incoming message/referral payload লগ করা।
- Parsed product identifier লগ করা।
- Product lookup result লগ করা।
- Conversation context before/after update লগ করা।
- Final AI context/product id লগ করা।

## Notes
No business logic fix will be applied before runtime evidence is collected.
