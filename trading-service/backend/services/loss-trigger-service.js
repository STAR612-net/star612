const AITradeConfig = require('../models/AITradeConfig');
const User = require('../models/User');
const ScheduledOrder = require('../models/ScheduledOrder');
const aiOrderExecutor = require('./ai-order-executor');
const kisAPI = require('./kis-api');
const notificationService = require('./notification-service');

class LossTriggerService {
  /**
   * Process loss triggers for all users (respecting per-user check interval)
   */
  async processAllLossTriggers() {
    try {
      const configs = await AITradeConfig.find({ is_active: true, 'auto_sell.loss_trigger.enabled': true });
      if (!configs || configs.length === 0) {
        console.log('[LossTrigger] No loss_trigger-enabled configs found');
        return { processed: 0 };
      }

      let processedUsers = 0;

      for (const config of configs) {
        try {
          const userId = config.user_id;
          const user = await User.findById(userId);
          if (!user) continue;

          const lastChecked = config.metadata?.loss_trigger_last_checked;
          const checkInterval = (config.auto_sell?.loss_trigger?.check_interval_minutes) || 15;
          const now = new Date();

          if (lastChecked) {
            const last = new Date(lastChecked);
            const diffMinutes = Math.floor((now - last) / (60 * 1000));
            if (diffMinutes < checkInterval) {
              // Skip due to check interval
              continue;
            }
          }

          const res = await this.processUserLossTrigger(user, config);
          // Update last checked
          if (!config.metadata) config.metadata = {};
          if (config.metadata instanceof Map) {
            config.metadata.set('loss_trigger_last_checked', now);
          } else {
            config.metadata.loss_trigger_last_checked = now;
          }
          await config.save();

          processedUsers++;
        } catch (userErr) {
          console.error('[LossTrigger] User processing failed:', userErr.message);
        }
      }

      console.log(`[LossTrigger] processAll complete. Users processed: ${processedUsers}`);
      return { processed: processedUsers };
    } catch (error) {
      console.error('[LossTrigger] Error in processAllLossTriggers:', error.message);
      throw error;
    }
  }

  /**
   * Process loss triggers for a single user/config
   * Returns object with details of actions taken
   */
  async processUserLossTrigger(user, config) {
    try {
      const isPaper = user.trading?.is_paper_trading !== false;
      let portfolio = [];

      if (isPaper) {
        const Portfolio = require('../models/Portfolio');
        const dbPortfolio = await Portfolio.findOne({ user_id: user.id || user._id, is_paper_trading: true });
        if (dbPortfolio && dbPortfolio.holdings) {
          portfolio = dbPortfolio.holdings.filter(h => h && h.symbol && h.quantity > 0);
        }
      } else {
        portfolio = await kisAPI.getPortfolio(user);
      }

      const results = [];

      for (const holding of portfolio) {
        try {
          const symbol = holding.symbol;
          const quantity = holding.quantity || 0;
          const avgPrice = holding.averagePrice || holding.avg_price || holding.avg_price || 0;

          if (!symbol || quantity <= 0 || !avgPrice || avgPrice <= 0) continue;

          // Get current price (prefer current_price in holding, else query KIS API)
          let currentPrice = holding.current_price || holding.price || 0;
          if (!currentPrice || currentPrice <= 0) {
            try {
              const stockData = await kisAPI.getStockPrice(symbol, user);
              currentPrice = stockData?.price || currentPrice || 0;
            } catch (err) {
              console.warn(`[LossTrigger] Current price fetch failed for ${symbol}: ${err.message}`);
              continue; // skip this holding if price can't be obtained
            }
          }

          const lossPercent = ((currentPrice - avgPrice) / avgPrice) * 100; // negative if loss
          const lossAmount = (avgPrice - currentPrice) * quantity; // positive if loss

          const lt = config.auto_sell.loss_trigger;
          const percentThreshold = lt?.percent_threshold || 0;
          const amountThreshold = lt?.amount_threshold || 0;

          const isPercentTriggered = percentThreshold > 0 && lossPercent <= -Math.abs(percentThreshold);
          const isAmountTriggered = amountThreshold > 0 && lossAmount >= amountThreshold;

          if (!isPercentTriggered && !isAmountTriggered) continue; // no trigger

          // Check min holding days
          const minHoldingDays = lt?.min_holding_days || 0;
          if (minHoldingDays > 0 && holding.purchase_date) {
            const purchaseDate = new Date(holding.purchase_date);
            const daysHeld = Math.floor((new Date() - purchaseDate) / (1000 * 60 * 60 * 24));
            if (daysHeld < minHoldingDays) {
              results.push({ symbol, reason: 'min_holding_days_not_met', daysHeld, minHoldingDays });
              continue;
            }
          }

          // Compute sell quantity
          const sellPercent = lt?.sell_percentage || 100;
          let sellQty = Math.floor(quantity * (sellPercent / 100));
          if (sellQty < 1) sellQty = 1;

          const action = lt?.action || 'force';
          const orderMethod = lt?.order_method || 'market';

          if (action === 'force') {
            // Construct a decision-like object for executeSell
            const decisionData = {
              ticker: symbol,
              symbol,
              quantity: sellQty,
              stock_name: holding.name || holding.stock_name || ''
            };

            const sellResult = await aiOrderExecutor.executeSell(
              user,
              decisionData,
              symbol,
              'sell',
              100, // confidence (forced)
              currentPrice,
              'loss_trigger',
              { orderMethod }
            );

            results.push({ symbol, triggeredBy: { lossPercent, lossAmount }, action: 'force', sellQty, sellResult });
          } else {
            // recommend: create scheduled order (pending) and notify user
            try {
              const scheduledOrder = await ScheduledOrder.create({
                user_id: user.id || user._id,
                symbol,
                stock_name: holding.name || holding.stock_name || '',
                order_type: 'sell',
                quantity: sellQty,
                price: currentPrice,
                order_method: orderMethod,
                scheduled_time: new Date(),
                status: 'pending',
                metadata: { source: 'loss-trigger', lossPercent, lossAmount }
              });

              // send notification
              try {
                await notificationService.sendNotification({
                  userId: user.id || user._id,
                  type: 'loss_trigger_recommend',
                  title: '손실 트리거 알림: 매도 권고',
                  message: `${symbol}이 손실 기준을 초과했습니다. 권고 매도: ${sellQty}주 @ ${currentPrice.toLocaleString()}원`,
                  data: { symbol, scheduledOrderId: scheduledOrder._id }
                });
              } catch (notifErr) {
                console.warn('[LossTrigger] Notification failed:', notifErr.message);
              }

              results.push({ symbol, triggeredBy: { lossPercent, lossAmount }, action: 'recommend', sellQty, scheduledOrderId: scheduledOrder._id });
            } catch (schedErr) {
              console.error('[LossTrigger] ScheduledOrder create failed:', schedErr.message);
              results.push({ symbol, error: schedErr.message });
            }
          }
        } catch (holdErr) {
          console.error('[LossTrigger] Holding check failed:', holdErr.message);
        }
      }

      return { user: user.id || user._id, results };
    } catch (error) {
      console.error('[LossTrigger] processUserLossTrigger error:', error.message);
      throw error;
    }
  }
}

module.exports = new LossTriggerService();
