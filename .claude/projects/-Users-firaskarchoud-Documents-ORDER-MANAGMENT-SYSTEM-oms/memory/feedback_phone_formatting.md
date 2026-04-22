---
name: Phone number formatting — remove +216 prefix
description: Strip +216 country code when displaying phone numbers in UI
type: feedback
---

Remove the +216 prefix whenever a phone number is mentioned or displayed in the UI.

**Why:** Cleaner display in the OMS, especially for Tunisian market where +216 is assumed context.

**How to apply:** When rendering phone numbers in components, lists, or any UI output, strip the +216 prefix. Apply this consistently across all screens showing contact info (order details, agent queue, etc.).
