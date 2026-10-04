-- A Google Sheets shop's sheet lives on its storefront row from now on
-- (storefronts.config = { spreadsheet_id, sheet_name, sheet_adapter }).
--
-- The one live sheet was wired by hand in settings.google_sheets_sources, and
-- its storefront row named a different tab. The import still reads the settings
-- entry as an override, so this changes nothing about what is imported — it
-- makes the row tell the truth, which is what Réglages › Boutiques displays.
--
-- Idempotent: re-running writes the same values. Data only, no schema change.
update storefronts s
set config = coalesce(s.config, '{}'::jsonb) || jsonb_build_object(
      'spreadsheet_id', e->>'spreadsheet_id',
      'sheet_name',     e->>'sheet_name',
      'sheet_adapter',  coalesce(nullif(e->>'platform', ''), 'converty')
    )
from settings st
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(st.value) = 'array' then st.value else '[]'::jsonb end
) e
where st.key = 'google_sheets_sources'
  and st.market_id = s.market_id
  and s.platform = 'google_sheets'
  and e->>'storefront_id' = s.id::text
  and coalesce(e->>'spreadsheet_id', '') <> ''
  and coalesce(e->>'sheet_name', '') <> '';
