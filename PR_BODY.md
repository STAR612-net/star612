Title: feat(loss-trigger): configurable loss-trigger (percent/amount) with automated processing

Summary:
- Add `auto_sell.loss_trigger` configurable options to `AITradeConfig`.
  - `enabled`, `percent_threshold`, `amount_threshold`, `sell_percentage`, `order_method`, `min_holding_days`, `action`, `check_interval_minutes`.
- Implement `loss-trigger-service` to evaluate user-configured loss triggers and either force sell or create sell recommendations.
- Add periodic processor (runs every 5 minutes) and retain the existing daily 10% analysis for backward compatibility.
- Add smoke test script `trading-service/backend/scripts/test-loss-trigger.js`.
- Add changelog entry.

Behavioral Notes:
- Default behavior: disabled. When enabled with default settings (percent_threshold: 3, sell_percentage: 50, action:force), the service will sell 50% of a holding when loss >= 3%.
- Force-sell uses `ai-order-executor.executeSell()` to benefit from existing safety checks (blocked symbols, min_holding_days, trading hours).
- Recommend creates a `ScheduledOrder` with metadata `{ source: 'loss-trigger' }` and sends a notification.

Testing:
- Provided smoke script `trading-service/backend/scripts/test-loss-trigger.js` to simulate both 'force' and 'recommend' flows (stubs KIS API and Portfolio for local testing).

Migration / Rollout:
- PR can be reviewed and merged. Post-merge, we should deploy to staging and enable the feature per user for testing (start with a small set of internal test accounts).

Requests:
- Please review and run `node trading-service/backend/scripts/test-loss-trigger.js` in a staging/dev environment to validate behavior.
- If you'd like, I can create a PR on GitHub; I need GH CLI or a GitHub token to create it programmatically. Otherwise, open: https://github.com/STAR612-net/star612/pull/new/fix/ai-sell-price-fallback

