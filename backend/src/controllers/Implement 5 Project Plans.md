# Implement 5 Project Plans

> **Workspace:** c:\Users\autom\Downloads\salesmanai-salesmanchatbot-11\salesmanai-salesmanchatbot-10-backup-july6

---

**User**

`c:\Users\autom\Downloads\salesmanai-salesmanchatbot-11\salesmanai-salesmanchatbot-10-backup-july6\backend\src\controllers\Fix Multiple Product Inquiry and Image Processing.md#L1-147`  plan ta amader project e implement koro 5 ta plan e

**Assistant**

আমি এখন `aiService` আর `webhookController`/`whatsappController`-এর exact current flow মিলিয়ে ৫টা implementation step-এ changes বসাচ্ছি, যাতে multi-image parallel processing থাকলেও final product output serial order-এ যায়।

আমি এখন response shape আর delivery layer একসাথে মেলাচ্ছি, যাতে একই fix `official WhatsApp`, `WA session flow`, আর `Messenger`-এ reusable pattern-এ বসানো যায়।

আমি এখন actual send layer দেখছি, কারণ serial output ঠিকমতো বসাতে হলে `reply/items -> DB save -> sendText/sendMedia` এই চেইনটা কোথায় split করতে হবে সেটা নিশ্চিত করা দরকার।

আমি helper layerটা বের করছি যাতে patchটা scattered না হয়ে reusable হয়। এখন `aiService`-এ normalized multi-item response helper বসিয়ে controller-গুলোতে একই contract consume করবো।

এখন আমি `aiService`-এ contract change বসাচ্ছি: model multi-product detect করলে `items[]` দেবে, আর legacy single-product response-ও আগের মতো কাজ করবে। এর পর controller-এ ওই `items[]` serial queue বানাবো।

আমি এখন `aiService.js` edit করছি। এখানে multi-item schema, tools enablement, আর response normalization একসাথে বসবে যাতে পরের controller patch safe থাকে।

প্যাচের একটা hunk mismatch হয়েছে, তাই আমি exact current snippets reread করে safer incremental patch দিচ্ছি যাতে existing user changes untouched থাকে।

`aiService` contract update হয়ে গেছে। এখন controller-এ ৩টা practical fix বসাচ্ছি: image cap remove, official WA duplicate vision stop, আর `items[]` থেকে serial delivery queue বানানো।

আমি আগে `webhookController.js`-এ official WhatsApp path fix করছি, কারণ এখানেই duplicate vision call আর serial send সবচেয়ে cleanly বসানো যাচ্ছে। এরপর WA session flow-এ একই pattern দেবো।

এখন same file-এ low-risk fixes দিচ্ছি: image cap remove করছি আর official WhatsApp path-এ already analyzed image আবার `generateResponse`-এ না পাঠানোর ব্যবস্থা করছি।

আমি এখন official WhatsApp send stage-এ serial queue বসাচ্ছি, যাতে `items[]` থাকলে `1st text -> 1st media -> 2nd text -> 2nd media` pattern follow করে।

আমি WA session flow-এও একই serial queue বসাচ্ছি, যাতে multiple product reply text/media সব একত্রে না গিয়ে per-item basis-এ যায়।

---

