# Changelog - trading-service

## 2026-01-08
- Fix: AI sell logic - when AI `target_price` is missing, fallback to live price (`kisAPI.getStockPrice`) for loss detection and threshold relaxation. Added additional logs.

## 2026-01-08 - feat(loss-trigger)
- Add `auto_sell.loss_trigger` configurable fields to `AITradeConfig` (percent_threshold, amount_threshold, sell_percentage, order_method, min_holding_days, action, check_interval_minutes).
- Implement `loss-trigger-service` to evaluate triggers per user and execute forced sells or create sale recommendations.
- Scheduler: periodic loss-trigger processor started (5-minute interval), and existing daily 10% checker preserved for backward compatibility.
- Added smoke test script `scripts/test-loss-trigger.js`.
