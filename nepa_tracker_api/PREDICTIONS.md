# Website restoration forecasts

The forecast is read-only and runs in the FastAPI worker pool. The watchdog, status detection, authoritative history, authentication, CSV exports and Telegram are unchanged. There are no prediction jobs or notifications.

## Deployment

Deploy the API and frontend together. No new Python or npm dependencies are required. Set the API's existing `DATABASE_URL` to the production Supabase PostgreSQL connection as usual. Do not use a Supabase service key in the browser.

**Verify timestamp provenance before enabling production estimates.** Existing records are naive `DateTime` values written with `datetime.now()`. `PREDICTION_STORAGE_TIMEZONE=UTC` is the default, appropriate when the backend clock used UTC. Set `Africa/Lagos` only if those naive records were written in WAT. This setting converts prediction inputs only; it does not migrate existing timestamps. Mixed historical conventions cannot be repaired by guessing one timezone. WAT pattern matching and response display are explicit UTC+1.

Recommended read-query index, run by the database administrator if no equivalent exists:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_power_logs_prediction_time
ON power_logs (timestamp, id);
```

No schema/index change is executed by the forecasting code. Check for an existing equivalent index first. PostgreSQL prediction statements have a transaction-local three-second timeout.

## Statistical method

An empirical conditional survival estimator selects completed grid outages whose duration exceeds the elapsed current outage. It estimates restoration within h hours as the fraction of survivors ending by elapsed+h. It reports the conditional median, the central 80% empirical interval, and 95% Wilson intervals for 1/2/4-hour probabilities. It never extrapolates beyond observed durations.

Cohorts broaden from 60-day records with similar WAT start times (within three hours) and weekday, to similar start time, all recent records, 180 days and finally 730 days. Twelve comparable survivors are preferred; fewer than eight produces no numerical forecast. Moderate confidence requires at least 30 survivors from the recent cohort; all other numerical estimates are low confidence. These labels describe evidence volume and recency, not guaranteed calibration. No high-confidence claim is made. Changes in routines can invalidate historical relationships; backtest before relying on estimates. The engine does not explicitly model a fixed restoration schedule.

Only ON/NEPA ends a grid outage. ON/GEN keeps the grid outage open. At most 120 seconds of grid restoration is merged into the surrounding outage, including repeated switching. After merging, outages of at most 120 seconds are excluded. All comparisons use unrounded seconds/microseconds. A completed interval becomes available for training only after the restoration survives more than 120 seconds. Original rows are never altered by normalization.

Contradictory simultaneous events, invalid events, and nonidentical duplicate state records break ambiguous chains. Exact duplicates are collapsed. Unknown initial state and missing endpoints are not given invented durations. Deletions that leave no detectable inconsistency cannot be inferred from the remaining records; no algorithm can reconstruct an unrecorded transition. This conservative estimator uses completed, validated episodes, not arbitrary imputed or right-censored durations; incomplete histories can therefore limit or bias available evidence and produce an unavailable response.

## Lifecycle and load

`GET /api/predictions/restoration` returns inactive while authoritative power is ON (including generator). When OFF, a newly recorded OFF of at most 120 seconds returns pending; otherwise it returns active, insufficient_data, or unavailable. The model can retain an earlier grid-outage start across a temporary return. Existing monitoring remains authoritative.

Normalized two-year history and completed duration features are cached per API process. Warm OFF requests make two bounded reads (status and latest log) and compute lightweight probabilities in memory. A committed PowerLog insert, edit, source correction, delete or ORM bulk deletion invalidates the cache. Heartbeat-only commits do not. A changed latest event also refreshes it. Other processes or edits directly in Supabase are picked up within the five-minute TTL; this deployment has no shared cache or database trigger. There is no history reload while ON. Invalidating a cache never queries the DB or starts training inside monitoring handlers.

The component polls sequentially about once per minute only while OFF. Requests abort on state change/unmount and have a 12-second browser timeout. An isolated elapsed timer updates locally each second. Forecasts expire after 75 seconds; expired/failed responses cannot remain visible as current estimates. The card is hidden while ON and remounted for a new authoritative power state.

## Validation

```powershell
cd nepa_tracker_api
.\venv\Scripts\python.exe -m unittest -v test_prediction_service test_prediction_api
.\venv\Scripts\python.exe backtest_predictions.py
```

The backtest runner reads `.env` or `--env-file PATH` without importing the monitoring app. Environment variables take precedence. It opens a read-only PostgreSQL transaction, queries only event/source/timestamp, and prints aggregate metrics plus the specifically requested Oct 28–29 case if present. SQLite is refused unless `--allow-sqlite` is explicitly supplied. The runner does not overwrite logs or run at application startup.

Replay origins are 0/30/60/120/180 minutes after outage start. Zero is intentionally ineligible. Each replay normalizes only the raw history prefix available at the origin, including the 120-second restoration-validation delay. Outcomes are used only to score, never to train that origin. Metrics include median absolute error, central-80% interval coverage, 1/2/4-hour Brier scores, average predicted probability versus observed rate, and probability-bin counts. The comparison baseline uses the historical unconditional median duration (with any expired baseline clipped to the origin). Missing pairs and unfinished target outages are not scored.

Local synthetic regression results are not evidence of Supabase production performance. This checkout currently configures SQLite. Production backtesting requires the real PostgreSQL connection and verified timestamp convention. No claim is made that the Oct 28–29 case exists until that query succeeds.
