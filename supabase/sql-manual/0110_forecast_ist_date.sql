-- 0110 — WhatsApp / follow-up revenue forecasts count days from the India date (29 Oct 2026)
--
-- Both functions used current_date (the server's UTC date), so between
-- 00:00 and 05:30 IST the forecast started from yesterday. Each function is
-- re-created from its own current definition with current_date replaced by
-- the Asia/Kolkata date — nothing else in them changes.
-- Approved by Dr. Yadav: "forecast wala bhi thik krdo".
do $$
declare
  f text;
  d text;
begin
  foreach f in array array['public.whatsapp_forecast(integer)', 'public.followup_revenue_forecast()'] loop
    d := pg_get_functiondef(f::regprocedure);
    d := replace(d, 'current_date', '(now() at time zone ''Asia/Kolkata'')::date');
    execute d;
  end loop;
end $$;

insert into schema_migrations (filename, notes) values
  ('0110_forecast_ist_date', 'whatsapp_forecast / followup_revenue_forecast use the Asia/Kolkata date')
on conflict (filename) do nothing;
