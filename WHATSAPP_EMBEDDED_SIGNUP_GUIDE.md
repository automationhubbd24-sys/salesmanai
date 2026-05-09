# WhatsApp Embedded Signup & Official Chatbot Setup Guide

এই গাইডটি ভবিষ্যতে ডেভেলপার বা এআই (AI) এজেন্টদের জন্য তৈরি করা হয়েছে যাতে তারা সহজেই WhatsApp Embedded Signup এবং Official Cloud API সেটআপ করতে পারে।

## ১. Meta Developer Portal সেটআপ (অ্যাডমিন কাজ)

আপনার চ্যাটবটটি কাজ করানোর জন্য Meta পোর্টালে নিচের ধাপগুলো অনুসরণ করতে হবে:

1.  **App তৈরি:** [developers.facebook.com](https://developers.facebook.com) এ গিয়ে একটি 'Business' টাইপ অ্যাপ তৈরি করুন।
2.  **WhatsApp যোগ করা:** অ্যাপ ড্যাশবোর্ড থেকে 'WhatsApp' প্রোডাক্টটি সেটআপ করুন।
3.  **Facebook Login for Business:** 'Facebook Login for Business' প্রোডাক্টটি যোগ করুন।
4.  **Configuration তৈরি:**
    *   `whatsapp_business_management`, `whatsapp_business_messaging`, এবং `business_management` পারমিশনগুলো সিলেক্ট করুন।
    *   একটি 'Configuration ID' জেনারেট হবে যা ফ্রন্টএন্ডে ব্যবহার করতে হবে।
5.  **Webhook সেটআপ:**
    *   **Callback URL:** `https://your-domain.com/webhook`
    *   **Verify Token:** `salesman_ai_2026` (আপনার প্রজেক্টের ডিফল্ট টোকেন)
    *   **Fields:** `messages`, `message_deliveries` ফিল্ডগুলোতে সাবস্ক্রাইব করুন।

---

## ২. ফ্রন্টএন্ড ইমপ্লিমেন্টেশন (Embedded Signup)

ইউজার যেন আপনার ওয়েবসাইট থেকেই হোয়াটসঅ্যাপ কানেক্ট করতে পারে, সেজন্য:

*   **SDK লোড:** Facebook JavaScript SDK লোড করুন।
*   **Login Flow:**
    ```javascript
    FB.login((res) => {
      if (res.authResponse) {
        const accessToken = res.authResponse.accessToken;
        // এই টোকেনটি ব্যাকএন্ডে পাঠান
      }
    }, {
      scope: 'whatsapp_business_management,whatsapp_business_messaging,business_management',
      extras: {
        feature: 'whatsapp_embedded_signup',
        setup_id: 'YOUR_CONFIG_ID' // Meta থেকে পাওয়া ID
      }
    });
    ```
*   **কোড রেফারেন্স:** [SessionManager.tsx](src/pages/dashboard/whatsapp/SessionManager.tsx)

---

## ৩. ব্যাকএন্ড ইমপ্লিমেন্টেশন (Node.js/Express)

ব্যাকএন্ডে টোকেন এক্সচেঞ্জ এবং ডেটা সেভ করার লজিক:

1.  **Token Exchange:** শর্ট-লিভড টোকেনকে লং-লিভড টোকেনে রূপান্তর করুন (যদি App Secret থাকে)।
2.  **Fetch Details:** `/me/whatsapp_business_accounts` এবং `/{waba_id}/phone_numbers` থেকে ইউজারের WABA ID এবং Phone ID সংগ্রহ করুন।
3.  **Automatic Onboarding (Easy Setup):** আপনার ব্যাকঅ্যান্ড এখন ইউজারের হয়ে অটোমেটিক সেশন তৈরি করে দেয়:
    *   `whatsappController.embeddedSignup` ফাংশনটি কল হলে এটি Meta থেকে ডেটা নিয়ে সরাসরি ডাটাবেসে `WORKING` স্ট্যাটাসে একটি সেশন তৈরি করে।
    *   এর ফলে ইউজারকে আর কোনো ফর্ম ফিলাপ করতে হয় না।
4.  **Database Save:** `waba_id`, `phone_number_id`, এবং `access_token` ডাটাবেসে সেভ করুন।
5.  **কোড রেফারেন্স:** [whatsappCloudService.js](backend/src/services/whatsappCloudService.js) এবং [whatsappController.js](backend/src/controllers/whatsappController.js)

---

## ৪. Webhook হ্যান্ডলিং (Easy Setup Logic)

ইউজাররা যেন কোনো ঝামেলা ছাড়াই মেসেজ পায়, সেজন্য:

*   **Auto-Subscription:** `handleEmbeddedSignup` ফাংশনটি অটোমেটিক `subscribed_apps` এপিআই কল করে ইউজারের WABA-কে আপনার Webhook-এর সাথে লিঙ্ক করে দেয়।
*   **Direct Verification:** `app.get('/webhook')` সরাসরি চ্যালেঞ্জ রিটার্ন করে যাতে ভেরিফিকেশন কখনো ফেইল না হয়।
*   **Logic:** `body.object === 'whatsapp_business_account'` হলে সেটি অফিশিয়াল চ্যাটবট লজিক দিয়ে হ্যান্ডেল করুন।
*   **কোড রেফারেন্স:** [webhookController.js](backend/src/controllers/webhookController.js)

---

## ৫. গুরুত্বপূর্ণ টিপস (Memory for Future AI)

*   **Webhook ভেরিফিকেশন:** সবসময় `text/plain` ফরম্যাটে চ্যালেঞ্জ রিটার্ন করুন।
*   **Route Order:** Express-এ স্ট্যাটিক ফাইল সার্ভিং-এর আগেই Webhook রুটগুলো ডিফাইন করুন।
*   **Permanent Token:** সিস্টেম ইউজারের মাধ্যমে পারমানেন্ট টোকেন জেনারেট করা সবচেয়ে ভালো যাতে সেশন কখনো শেষ না হয়।
*   **Screencast (ভিডিও) টিপস:**
    Meta রিভিউয়ের জন্য ভিডিও রেকর্ড করার সময় আপনার ড্যাশবোর্ডের **Conversion** পেজে যান। সেখানে যেকোনো মেসেজের পাশে থাকা **Reply (তীর চিহ্ন)** আইকনে ক্লিক করে একটি ম্যানুয়াল মেসেজ পাঠান। এটি আপনার অ্যাপ থেকে মেসেজ যাওয়ার প্রমাণ হিসেবে কাজ করবে।
*   **Coexistence:** একই নাম্বারে ফোনের অ্যাপ এবং এপিআই দুটোই চালানো সম্ভব (Meta-র নতুন আপডেট অনুযায়ী)।

---
*Created on 2026-04-29*
