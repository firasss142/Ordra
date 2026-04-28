# Carrier Adapters — Rules

## Architecture
Adapter pattern. Each carrier implements the CarrierAdapter interface.
New carriers = new adapter file. Zero changes to confirmation or metrics logic.

## Interface
Every adapter must implement:
- dispatch(order) → { success, tracking_number, error_message }
- getStatus(tracking_number) → carrier-side status (future, v1 may be manual)

## Dispatch is synchronous
When agent confirms → OMS pushes to carrier API immediately → waits for response.
On success: status → dispatched, tracking_number stored.
On failure: error shown to agent, order stays confirmed, retry available.

## Current adapters
- NavexAdapter (Tunisia) — Session 8
- LibyanCarrierAdapter (Libya) — Session 8

## API credentials
Stored in carriers table (api_credentials JSONB). Encrypted at app level.
NEVER hardcode API keys or endpoints.

## References
- OMS spec Section 9 (Carrier Dispatch Layer)
- Carrier API docs: ask Firas for Navex + Libyan carrier documentation
