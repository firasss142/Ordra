---
title: "Darb Assabil"
source: "https://app.sabil.ly/developer"
author:
published:
created: 2026-05-06
description:
tags:
  - "clippings"
---
مفاتيح API

إدارة مفاتيح API الخاصة بك

Webhook

إدارة Webhooks

تنزيل Postman

احصل على مجموعة API لـ Postman

حالة الخادم

Check server health and status

### Integration Guide

REST API

Everything you need to get started with the Darb Assabil API.

The Darb Assabil API is designed to streamline and automate workflows related to shipping and logistics. Integrate these functionalities into your own applications and services.

Base URL

`https://v2.sabil.ly`

Authorization

`Authorization: apikey YOUR_API_KEY`

Capabilities

Fetch available shipping zones

Fetch available service packages

CRUD operations on orders

Track orders

Calculate shipping prices

Security tip: Always store API keys and tokens securely, for example, in environment variables rather than hard-coding them in your source.

### API Example

POST

Create a local shipment order using the Darb Assabil API.

POST

`https://v2.sabil.ly/api/local/shipments`

Required Fields

`service` Service package ID

`contacts` Receiver contact IDs (min: 1)

`products` Product list with amount, currency (min: 1)

`paymentBy` "sender", "receiver", or "sales"

`to` Destination with countryCode, city, area

Code Snippets

```
curl -X POST https://v2.sabil.ly/api/local/shipments \
  -H "Content-Type: application/json" \
  -H "Authorization: apikey YOUR_API_KEY" \
  -H "X-API-VERSION: 1.0.0" \
  -H "X-ACCOUNT-ID: YOUR_ACCOUNT_ID" \
  -d '{
    "service": "SERVICE_PACKAGE_ID",
    "contacts": ["RECEIVER_CONTACT_ID"],
    "paymentBy": "receiver",
    "to": {
      "countryCode": "LBY",
      "city": "Tripoli",
      "area": "Ain Zara",
      "address": "123 Main Street"
    },
    "products": [
      {
        "title": "Smartphone Case",
        "quantity": 2,
        "amount": 25,
        "currency": "LYD",
        "isChargeable": true
      }
    ],
    "notes": "Handle with care"
  }'
```

Testing with Postman

1Download the Postman collection using the "Download Postman" tool above and import it into Postman.

2Set the {{host}} variable to https://v2.sabil.ly in your Postman environment.

3Add your Authorization, X-API-VERSION, and X-ACCOUNT-ID headers (or configure them in the collection variables).

4Navigate to localShipments > create, fill in the request body with your data, and click "Send".

Success Response

```
{
  "status": true,
  "data": {
    "_id": "6789abc...",
    "reference": "DS-12345",
    "status": "pending",
    "createdAt": "2026-03-07T10:00:00.000Z",
    "from": { "countryCode": "LBY", "city": "Tripoli", ... },
    "to": { "countryCode": "LBY", "city": "Tripoli", "area": "Ain Zara", ... },
    "products": [ ... ],
    "invoices": [ ... ],
    "timeline": [ ... ]
  }
}
```

Use the "Calculate Shipping" endpoint (POST /api/local/shipments/calculate/shipping) first to preview shipping costs before creating a shipment.