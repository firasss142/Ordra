# Financial Calculations — Rules

This directory contains ALL financial logic. Server-side only.

## Iron rules
- NEVER import from this directory in any client component
- NEVER hardcode fees — always read from settings table via Supabase
- Revenue = orders.total_price ONLY
- All functions must be verifiable with known test numbers

## Profitability model (OMS uses simplified version)
Revenue − COGS − delivery cost − return cost − packing − ad spend − processing cost = simplified net profit

## Cost sources
- Delivery fee: carriers table (per delivered order)
- Return fee: carriers table (per returned order)  
- COGS: products.unit_cost × product_variants.quantity
- Packing: products.packing_cost (per confirmed order)
- Ad spend (product): SUM(ad_spend.amount WHERE product_id = X AND period overlaps)
- Processing: products.confirmation_processing_cost (per confirmed order)
- Ad spend: ad_spend table (manual entry per period)

## References
- Full formulas: see docs/business-logic.md (created in Session 12)
- OMS spec Section 12.3 for product profitability
- OMS spec Section 12.2 for business profitability