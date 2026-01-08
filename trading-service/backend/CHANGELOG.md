# Changelog - trading-service

## 2026-01-08
- Fix: AI sell logic - when AI `target_price` is missing, fallback to live price (`kisAPI.getStockPrice`) for loss detection and threshold relaxation. Added additional logs.
