// Smoke test for loss-trigger-service
const lossTriggerService = require('../services/loss-trigger-service');
const kisAPI = require('../services/kis-api');
const Portfolio = require('../models/Portfolio');
const User = require('../models/User');
const ScheduledOrder = require('../models/ScheduledOrder');
const aiOrderExecutor = require('../services/ai-order-executor');

// stubs
kisAPI.getStockPrice = async (symbol, user) => {
  console.log('[stub] kisAPI.getStockPrice for', symbol);
  return { price: 9000 };
};

Portfolio.findOne = async (query) => {
  console.log('[stub] Portfolio.findOne', query);
  return {
    user_id: query.user_id,
    is_paper_trading: true,
    holdings: [
      {
        symbol: 'TEST',
        quantity: 100,
        avg_price: 10000,
        averagePrice: 10000,
        purchase_date: new Date(Date.now() - 10 * 24 * 3600 * 1000) // 10 days ago
      }
    ]
  };
};

aiOrderExecutor.executeSell = async (user, decisionData, symbol, action, confidence, targetPrice, reasoning, options) => {
  console.log('[stub] executeSell called', { user: user.id || user._id, symbol, decisionData, confidence, targetPrice, options });
  return { order_id: 'MOCK_SELL_1', success: true };
};

// Test user and config
(async () => {
  try {
    const user = {
      _id: '000000000000000000000002',
      id: '000000000000000000000002',
      name: 'Loss Test User',
      trading: { is_paper_trading: true }
    };

    // Create a fake config object (mimic AITradeConfig document)
    const config = {
      user_id: user.id,
      is_active: true,
      auto_sell: {
        loss_trigger: {
          enabled: true,
          percent_threshold: 5, // trigger at 5% loss
          amount_threshold: 0,
          sell_percentage: 50,
          order_method: 'market',
          min_holding_days: 0,
          action: 'force'
        }
      },
      metadata: {}
    };

    console.log('=== Running processUserLossTrigger (force) ===');
    const res1 = await lossTriggerService.processUserLossTrigger(user, config);
    console.log('Result:', JSON.stringify(res1, null, 2));

    // Now test recommend
    config.auto_sell.loss_trigger.action = 'recommend';
    console.log('\n=== Running processUserLossTrigger (recommend) ===');
    const res2 = await lossTriggerService.processUserLossTrigger(user, config);
    console.log('Result:', JSON.stringify(res2, null, 2));

    process.exit(0);
  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  }
})();
