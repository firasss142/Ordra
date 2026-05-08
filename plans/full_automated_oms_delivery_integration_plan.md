# Full Automation Plan — OMS to Delivery Company Dashboard Integration

## 1. Objective

The goal is to automate the process of sending confirmed orders from your custom OMS to the delivery company dashboard, even though the delivery company does not provide an official API.

Because the delivery dashboard supports CSV/Excel import, the best approach is not to automate the creation of each order one by one. Instead, the OMS will generate a delivery-compatible file, and an automation bot will log in to the delivery dashboard, upload the file, submit it, capture the result, and update the OMS.

This gives you full automation while keeping the system more stable than click-by-click form filling.

---

## 2. Recommended Solution Summary

The recommended approach is:

```text
Confirmed OMS Orders
        ↓
Delivery Queue
        ↓
Batch Generator
        ↓
CSV/Excel File Created
        ↓
Playwright Bot Logs Into Delivery Dashboard
        ↓
Bot Uploads File
        ↓
Delivery Orders Created
        ↓
OMS Updated With Status / Tracking Info
```

The system should be built as a separate delivery automation service connected to the OMS database.

---

## 3. Why This Approach Is Better Than Form Automation

Since the delivery dashboard has CSV/Excel import, file-based automation is the best option.

### Form Automation

This means the bot opens the “Create Order” form and fills each order manually.

Example:

```text
Order 1 → Fill form → Submit
Order 2 → Fill form → Submit
Order 3 → Fill form → Submit
```

This is fragile because every field, button, popup, delay, or small UI change can break the bot.

### CSV/Excel Import Automation

This means the OMS generates one file containing many orders, and the bot uploads that file.

Example:

```text
Generate file with 40 orders → Upload once → Submit once
```

This is more reliable because the bot only automates a few steps:

```text
Login → Go to Import Page → Upload File → Submit → Read Result
```

---

## 4. Main Components

### 4.1 OMS Backend

The OMS backend is responsible for:

- Managing orders
- Confirming orders
- Preparing orders for delivery
- Creating delivery batches
- Generating CSV/Excel files
- Storing delivery statuses
- Receiving updates from the delivery automation worker

The OMS backend should not directly run browser automation. Browser automation should be handled by a separate service.

---

### 4.2 Delivery Automation Worker

This is a separate service responsible for:

- Logging into the delivery company dashboard
- Uploading generated CSV/Excel files
- Submitting the import
- Capturing success or failure messages
- Capturing tracking numbers if available
- Taking screenshots on failure
- Updating the OMS database or calling OMS internal APIs

Recommended tool:

```text
Playwright
```

Playwright is recommended because it is reliable for modern browser automation, supports file upload, handles login flows well, and can take screenshots/videos for debugging.

---

### 4.3 Database

The database stores:

- Orders
- Delivery status per order
- Delivery batches
- Generated file paths
- Upload attempts
- Errors
- Tracking references
- Retry count

---

### 4.4 Admin Dashboard

The OMS admin dashboard should include a dedicated page for delivery automation.

Suggested page name:

```text
Delivery Dispatch
```

This page should show:

- Orders waiting to be sent
- Current delivery batches
- Successful uploads
- Failed uploads
- Retry buttons
- Manual override options
- Error logs and screenshots

---

## 5. Order Status Flow

Each order should have a clear delivery status.

Recommended order statuses:

```text
confirmed
ready_for_delivery
queued_for_delivery
batch_created
uploading_to_delivery
sent_to_delivery
delivery_failed
manual_review_required
```

### Status Explanation

| Status | Meaning |
|---|---|
| `confirmed` | Order has been confirmed by the confirmation team |
| `ready_for_delivery` | Order is ready to be sent to delivery company |
| `queued_for_delivery` | Order is waiting to be included in a delivery batch |
| `batch_created` | Order has been included in a generated CSV/Excel batch |
| `uploading_to_delivery` | Bot is currently uploading the batch |
| `sent_to_delivery` | Order was successfully created in the delivery dashboard |
| `delivery_failed` | Order failed to be sent |
| `manual_review_required` | Human intervention is required |

---

## 6. Batch Status Flow

Delivery batches should also have statuses.

Recommended batch statuses:

```text
created
file_generated
uploading
uploaded_successfully
partially_failed
upload_failed
manual_review_required
```

### Batch Status Explanation

| Status | Meaning |
|---|---|
| `created` | Batch record was created |
| `file_generated` | CSV/Excel file was generated |
| `uploading` | Bot is uploading the file |
| `uploaded_successfully` | File was uploaded successfully |
| `partially_failed` | Some orders were accepted and others failed |
| `upload_failed` | Entire upload failed |
| `manual_review_required` | A person needs to check the issue |

---

## 7. Suggested Database Structure

### 7.1 Orders Table Fields

Add these fields to the existing orders table:

```sql
delivery_company VARCHAR(100),
delivery_status VARCHAR(50),
delivery_batch_id UUID NULL,
delivery_tracking_code VARCHAR(100) NULL,
delivery_sent_at TIMESTAMP NULL,
delivery_error_message TEXT NULL,
delivery_retry_count INTEGER DEFAULT 0,
delivery_last_attempt_at TIMESTAMP NULL
```

### 7.2 Delivery Batches Table

Create a new table:

```sql
CREATE TABLE delivery_batches (
    id UUID PRIMARY KEY,
    delivery_company VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL,
    file_name VARCHAR(255),
    file_path TEXT,
    orders_count INTEGER DEFAULT 0,
    successful_orders_count INTEGER DEFAULT 0,
    failed_orders_count INTEGER DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    uploaded_at TIMESTAMP NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 7.3 Delivery Upload Attempts Table

Create a table to track each upload attempt:

```sql
CREATE TABLE delivery_upload_attempts (
    id UUID PRIMARY KEY,
    batch_id UUID NOT NULL,
    status VARCHAR(50) NOT NULL,
    attempt_number INTEGER NOT NULL,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMP NULL,
    screenshot_path TEXT NULL,
    error_message TEXT NULL,
    FOREIGN KEY (batch_id) REFERENCES delivery_batches(id)
);
```

---

## 8. Full Automated Workflow

### Step 1 — Order Confirmation

When the confirmation team confirms an order, the OMS changes the order status to:

```text
confirmed
```

Then the delivery status becomes:

```text
ready_for_delivery
```

Example:

```text
Order #10482
Main status: confirmed
Delivery status: ready_for_delivery
```

---

### Step 2 — Automatic Queueing

A scheduled job runs every few minutes and finds all confirmed orders that are ready for delivery.

Example schedule:

```text
Every 15 minutes
```

The job selects orders where:

```sql
main_status = 'confirmed'
AND delivery_status = 'ready_for_delivery'
AND delivery_tracking_code IS NULL
```

Then it marks them as:

```text
queued_for_delivery
```

---

### Step 3 — Batch Creation

The system groups pending orders into a batch.

For your current volume of 20–40 orders/day, batching can be done:

- Every 30 minutes
- Every 1 hour
- Or instantly when an order is confirmed

Recommended starting point:

```text
Every 30 minutes
```

This reduces repeated logins and makes the process easier to monitor.

The system creates a batch record:

```text
Batch #BATCH-2026-05-08-001
Orders count: 12
Status: created
```

---

### Step 4 — CSV/Excel File Generation

The OMS generates a file matching the delivery company’s import template.

The file should include fields such as:

```text
Customer Name
Phone Number
Second Phone Number
Address
City / Region
Product Name
Quantity
COD Amount
Delivery Notes
Internal OMS Order Reference
```

The internal OMS order reference is very important.

Example:

```text
OMS-10482
```

This helps prevent duplicates and helps with reconciliation.

---

### Step 5 — Bot Starts Upload Attempt

The delivery automation worker picks up a batch with status:

```text
file_generated
```

Then it creates a new upload attempt record.

Example:

```text
Batch: BATCH-2026-05-08-001
Attempt: 1
Status: started
```

The batch status becomes:

```text
uploading
```

The related order delivery statuses become:

```text
uploading_to_delivery
```

---

### Step 6 — Bot Logs Into Delivery Dashboard

The bot opens the delivery dashboard login page.

It enters the credentials from secure environment variables.

Example environment variables:

```env
DELIVERY_DASHBOARD_URL=https://delivery-company-dashboard.com
DELIVERY_USERNAME=your_username
DELIVERY_PASSWORD=your_password
```

Important: credentials should never be hardcoded in the script.

---

### Step 7 — Bot Navigates to Import Page

After login, the bot navigates to the import page.

Depending on the dashboard, this may be done by:

- Direct URL
- Clicking menu item
- Clicking “Orders”
- Clicking “Import”
- Clicking “Upload CSV/Excel”

Direct URL is better if available.

Example:

```text
https://delivery-company-dashboard.com/orders/import
```

---

### Step 8 — Bot Uploads the File

The bot selects the generated CSV/Excel file and uploads it.

Then it clicks the import/submit button.

The bot waits for the dashboard response.

Possible results:

```text
Import successful
Import partially successful
Import failed
```

---

### Step 9 — Bot Reads Result

The bot should capture the result shown by the dashboard.

Possible scenarios:

### Scenario A — Full Success

All orders are imported successfully.

Then:

```text
Batch status = uploaded_successfully
Order delivery status = sent_to_delivery
```

If the dashboard provides tracking numbers, the bot should save them.

---

### Scenario B — Partial Failure

Some rows are accepted, and some are rejected.

Then:

```text
Batch status = partially_failed
Successful orders = sent_to_delivery
Failed orders = delivery_failed
```

The OMS should store the error message per failed order.

Example:

```text
Order #10482 failed: phone number missing
Order #10483 failed: invalid region
```

---

### Scenario C — Full Failure

The whole upload failed.

Then:

```text
Batch status = upload_failed
Order delivery status = delivery_failed
```

The bot should save:

- Error message
- Screenshot
- Attempt number
- Timestamp

---

### Step 10 — OMS Updates

After the bot finishes, the OMS should update:

- Batch status
- Order delivery statuses
- Tracking numbers if available
- Error messages
- Upload attempt result
- Screenshot path if failed

---

## 9. Retry Logic

The system should automatically retry failed uploads.

Recommended retry strategy:

```text
Attempt 1: immediately
Attempt 2: after 5 minutes
Attempt 3: after 15 minutes
Attempt 4: after 30 minutes
```

After 3 or 4 failed attempts, mark the batch as:

```text
manual_review_required
```

Do not retry forever.

---

## 10. Duplicate Protection

Duplicate delivery order creation is one of the biggest risks.

To prevent duplicates:

### Rule 1

Never include an order in a new batch if it already has:

```text
delivery_status = sent_to_delivery
```

### Rule 2

Never include an order if it already has a tracking code.

```text
delivery_tracking_code IS NOT NULL
```

### Rule 3

Use the internal OMS order ID as a reference in the delivery import file.

Example:

```text
OMS-10482
```

### Rule 4

Before retrying a failed batch, check whether the dashboard may have already created some orders.

This is especially important when the bot fails after upload but before reading the success message.

---

## 11. Handling Ambiguous Failures

Sometimes the bot may not know if the upload succeeded.

Example:

- File uploaded
- Dashboard page froze
- Internet disconnected
- Bot did not see success message

In this case, do not automatically retry immediately because it could create duplicates.

Instead, mark the batch as:

```text
manual_review_required
```

The admin should check the delivery dashboard manually.

In the OMS, show:

```text
Upload result unknown. Please verify before retrying.
```

---

## 12. Admin Dashboard Features

Create a page in the OMS called:

```text
Delivery Dispatch
```

### Main Sections

#### 1. Pending Orders

Shows orders ready to be sent.

Columns:

```text
Order ID
Customer Name
Phone
City
Amount
Status
Created At
```

#### 2. Delivery Batches

Shows generated batches.

Columns:

```text
Batch ID
Orders Count
Status
Created At
Uploaded At
Success Count
Failed Count
```

#### 3. Failed Orders

Shows orders that need attention.

Columns:

```text
Order ID
Customer Name
Phone
Error Message
Retry Button
Manual Mark Button
```

#### 4. Batch Details Page

Shows:

- File generated
- Orders included
- Upload attempts
- Screenshots
- Error logs
- Tracking codes if available

---

## 13. Manual Controls

Even with automation, manual controls are necessary.

Add these buttons:

```text
Retry Upload
Mark as Manually Uploaded
Regenerate File
Download CSV/Excel
Cancel Batch
```

### Retry Upload

Used when the issue is fixed and the bot should try again.

### Mark as Manually Uploaded

Used when a human uploads the file manually to the delivery dashboard.

### Regenerate File

Used if order data was corrected.

### Download CSV/Excel

Allows the team to manually upload the file if the bot fails.

### Cancel Batch

Used if the batch should not be sent.

---

## 14. Error Logging

Every upload attempt should log:

```text
Batch ID
Attempt Number
Started At
Finished At
Status
Error Message
Screenshot Path
```

The bot should take screenshots on:

- Login failure
- Import page not found
- Upload failure
- Unexpected popup
- Unknown final state

Optional but useful:

- Save browser trace/video for debugging
- Store HTML snapshot of failed page

---

## 15. Security Recommendations

### 15.1 Credentials

Do not store delivery dashboard credentials in code.

Use:

```text
Environment variables
Secrets manager
Encrypted configuration
```

### 15.2 Dedicated Account

Use a dedicated delivery dashboard account for automation.

Example:

```text
oms.integration@yourcompany.com
```

This makes it easier to track actions and revoke access if needed.

### 15.3 Access Control

Only admins or authorized operations managers should be able to:

- Retry uploads
- Mark orders as manually uploaded
- Download delivery files
- View delivery credentials
- Cancel batches

### 15.4 File Storage

Generated files should be stored securely.

Avoid public URLs unless protected.

---

## 16. Tracking Number Integration

You said the delivery dashboard gives a tracking/reference number immediately.

This can be added in a later version.

### Version 1

Only mark orders as:

```text
sent_to_delivery
```

### Version 2

Capture tracking numbers from the import result if the dashboard provides them.

### Version 3

If needed, the bot can search each order in the delivery dashboard and scrape its tracking number.

Recommended tracking fields:

```sql
delivery_tracking_code VARCHAR(100),
delivery_tracking_url TEXT,
delivery_sent_at TIMESTAMP
```

---

## 17. Future Delivery Status Sync

Later, you may want to sync delivery updates back into your OMS.

Examples:

```text
Picked up
In transit
Delivered
Returned
Cancelled
Paid
```

Since there is no API, this can be done by:

- Exporting reports from the delivery dashboard
- Downloading delivery status files
- Scraping order status pages
- Periodically searching orders by tracking code

Recommended later workflow:

```text
Every morning:
Bot logs in
Downloads delivery report
OMS imports statuses
Orders are updated automatically
```

Do not build this in the first version unless it is urgently needed.

---

## 18. Recommended Implementation Phases

### Phase 1 — Prepare OMS Delivery Data

Goal: Make sure the OMS has all the fields needed for delivery.

Tasks:

- Add delivery status fields to orders
- Add delivery batch table
- Add upload attempts table
- Add delivery dispatch page
- Add ability to generate CSV/Excel manually
- Add download button

Outcome:

```text
You can generate the delivery file manually from OMS.
```

---

### Phase 2 — Build CSV/Excel Generator

Goal: Generate a file that matches the delivery company’s required template.

Tasks:

- Get sample import template from delivery dashboard
- Map OMS fields to delivery file fields
- Validate required fields
- Handle missing phone/address/city
- Add internal OMS order reference
- Generate file
- Store file path in batch table

Outcome:

```text
OMS can produce a valid import file.
```

---

### Phase 3 — Build Playwright Upload Bot

Goal: Automate login and file upload.

Tasks:

- Build Playwright script
- Login to delivery dashboard
- Navigate to import page
- Upload generated file
- Submit import
- Wait for result
- Take screenshot on failure
- Return result to OMS

Outcome:

```text
Bot can upload a delivery batch automatically.
```

---

### Phase 4 — Connect Bot to OMS Queue

Goal: Make the process automatic.

Tasks:

- Create worker process
- Worker checks for batches with status `file_generated`
- Worker uploads batches
- Worker updates batch/order statuses
- Add retry logic
- Add failure handling

Outcome:

```text
Confirmed orders are sent to delivery automatically in batches.
```

---

### Phase 5 — Add Monitoring and Admin Controls

Goal: Make the automation safe for daily operations.

Tasks:

- Add failed batch page
- Add retry button
- Add manual upload confirmation
- Add logs and screenshots
- Add notifications for failures

Outcome:

```text
Your team can operate the automation safely.
```

---

### Phase 6 — Add Tracking Number Capture

Goal: Store delivery references in OMS.

Tasks:

- Analyze import result format
- Capture tracking numbers if shown
- Match tracking number to OMS order reference
- Save tracking code in OMS
- Display it on order details page

Outcome:

```text
OMS stores delivery tracking numbers.
```

---

### Phase 7 — Add Delivery Status Sync

Goal: Sync delivery progress later.

Tasks:

- Check if dashboard has export/report feature
- Download daily status report
- Match rows by tracking number or OMS reference
- Update OMS order statuses
- Add reconciliation page

Outcome:

```text
OMS can track delivery progress automatically.
```

---

## 19. Suggested Automation Frequency

For 20–40 orders/day, do not upload every single order separately.

Recommended options:

### Option A — Every 30 minutes

Good balance between automation and stability.

```text
Every 30 minutes, create and upload a batch.
```

### Option B — Every 1 hour

More conservative.

```text
Every 1 hour, create and upload a batch.
```

### Option C — Instant but batched

When an order is confirmed, wait 5–10 minutes, then include it in the next batch.

Recommended initial choice:

```text
Every 30 minutes
```

---

## 20. Example End-to-End Scenario

### 10:00 AM

Confirmation team confirms 8 orders.

OMS marks them:

```text
delivery_status = ready_for_delivery
```

### 10:30 AM

Batch job runs.

Creates:

```text
Batch #BATCH-001
Orders count: 8
```

Generates:

```text
delivery_batch_001.xlsx
```

### 10:31 AM

Bot starts upload.

Logs in to delivery dashboard.

Uploads the file.

### 10:32 AM

Dashboard returns success.

OMS updates:

```text
Batch status = uploaded_successfully
Orders delivery_status = sent_to_delivery
```

If tracking numbers are available:

```text
Order #10482 tracking = TRK12345
Order #10483 tracking = TRK12346
```

---

## 21. Technical Stack Recommendation

### Backend

Use whatever your OMS already uses.

Common options:

```text
Node.js / NestJS / Express
Laravel
Django
Spring Boot
```

### Automation Worker

Recommended:

```text
Node.js + Playwright
```

### Database

Use your OMS database.

Recommended:

```text
PostgreSQL
MySQL
MongoDB
```

### File Generation

For CSV:

```text
fast-csv
csv-writer
papaparse
```

For Excel:

```text
exceljs
xlsx
```

### Job Queue

Recommended:

```text
BullMQ + Redis
```

Alternative:

```text
Cron job
Database polling worker
```

For the first version, a cron job or database polling worker is enough.

---

## 22. Example Worker Logic

Pseudo-code:

```text
Every 30 minutes:

1. Find orders where:
   - main status = confirmed
   - delivery_status = ready_for_delivery

2. If no orders:
   - stop

3. Create delivery batch

4. Generate CSV/Excel file

5. Mark orders as batch_created

6. Start upload attempt

7. Bot logs in to delivery dashboard

8. Bot uploads file

9. If success:
   - mark batch uploaded_successfully
   - mark orders sent_to_delivery
   - save tracking numbers if available

10. If failure:
   - save error
   - save screenshot
   - retry if safe
   - otherwise mark manual_review_required
```

---

## 23. Important Validation Before Upload

Before generating the file, validate each order.

Required fields usually include:

```text
Customer name
Phone number
Address
City / region
COD amount
Product description
Quantity
```

If an order has missing required data, do not include it in the batch.

Mark it as:

```text
manual_review_required
```

Example:

```text
Order #10482 cannot be sent because city is missing.
```

This prevents the whole file from failing.

---

## 24. Failure Types

### Safe to Retry

These can be retried automatically:

```text
Dashboard timeout
Temporary network issue
Login page slow
Import page slow
Upload button not ready
```

### Not Safe to Retry Automatically

These should go to manual review:

```text
Unknown result after upload
Dashboard may have accepted file but bot did not capture response
Possible duplicate risk
Template mismatch
Invalid data in file
Unexpected dashboard error
```

---

## 25. Monitoring and Notifications

You should notify the team when something fails.

Possible channels:

```text
OMS notification
Email
Slack
Telegram
WhatsApp internal alert
```

Example alert:

```text
Delivery batch BATCH-001 failed.
Reason: Invalid city value in row 7.
Action required: Review failed orders.
```

---

## 26. Production Deployment

The automation worker should run on a server, not on an employee laptop.

Recommended deployment:

```text
VPS or cloud server
Docker container
Scheduled worker process
Secure environment variables
Persistent file storage
```

If using Playwright in production, install browser dependencies properly.

With Docker, use the official Playwright image when possible.

---

## 27. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Delivery dashboard UI changes | Keep bot small: only login and upload file |
| Duplicate orders | Store OMS reference, avoid retrying unknown uploads |
| Login expires quickly | Bot logs in every run |
| Upload fails | Retry safe failures, manual review unsafe failures |
| Invalid order data | Validate before generating file |
| Tracking not captured | Add tracking capture in V2 |
| Dashboard unavailable | Queue remains in OMS until retry |
| Credentials exposed | Use secure environment variables |

---

## 28. Minimum Viable Version

The first production-ready version should include:

```text
1. Delivery status fields on orders
2. Delivery batch table
3. CSV/Excel generator
4. Playwright login + upload script
5. Batch status update
6. Failure screenshots
7. Retry button
8. Manual upload fallback
9. Duplicate protection
```

Do not start with tracking sync or delivery status sync. Add them later.

---

## 29. Final Recommended Roadmap

### Week 1

- Understand delivery dashboard import template
- Map OMS order fields to template
- Add delivery statuses to database
- Build CSV/Excel generation manually

### Week 2

- Build delivery dispatch page
- Add batch creation
- Add download file button
- Test manual uploads with real orders

### Week 3

- Build Playwright upload bot
- Automate login
- Automate file upload
- Capture success/failure
- Add screenshots on failure

### Week 4

- Connect worker to OMS queue
- Add retry logic
- Add admin controls
- Run in parallel with manual process

### Week 5

- Move to full automation
- Add monitoring
- Add tracking capture if available

---

## 30. Final Decision

The best decision for your OMS is:

```text
Use full automation based on CSV/Excel batch upload, not individual form filling.
```

This is the safest and most scalable workaround when the delivery company does not provide an API.

It gives your business:

- Less manual work
- Fewer human errors
- Faster order dispatch
- A clear audit trail
- Manual fallback when needed
- Future ability to sync tracking and delivery statuses

The key is to treat the bot as a controlled automation worker, not a simple hidden script.

Build it with queues, logs, retries, duplicate protection, and manual review.
