// Simple test script for executeSell price fallback behavior
// Usage: node scripts/test-sell-fallback.js

const aiExecutor = require('../services/ai-order-executor');
const kisAPI = require('../services/kis-api');
const Portfolio = require('../models/Portfolio');
const AITradeConfig = require('../models/AITradeConfig');
const Trading = require('../models/Trading');
const notificationService = require('../services/notification-service');

// --- Stubs / mocks ---
// stub getStockPrice to simulate current market price
kisAPI.getStockPrice = async (symbol, user) => {
  console.log('[stub] kisAPI.getStockPrice called for', symbol);
  return { price: 8000 };
};

// stub Portfolio.findOne for paper trading
Portfolio.findOne = async (query) => {
  console.log('[stub] Portfolio.findOne called with', query);
  return {
    user_id: query.user_id,
    is_paper_trading: true,
    holdings: [
      {
        symbol: 'TEST',
        quantity: 100,
        averagePrice: 10000,
        purchase_date: new Date(Date.now() - 5 * 24 * 3600 * 1000) // 5 days ago
      }
    ]
  };
};

// stub AITradeConfig
AITradeConfig.findOne = async (query) => {
  console.log('[stub] AITradeConfig.findOne called with', query);
  return {
    user_id: query.user_id,
    is_active: true,
    auto_sell: {
      enabled: true,
      confidence_threshold: 70,
      min_holding_days: 0
    }
  };
};

// stub Trading.create
Trading.create = async (data) => {
  console.log('[stub] Trading.create called:', JSON.stringify(data, null, 2));
  return data;
};

// stub notification
notificationService.sendNotification = async (payload) => {
  console.log('[stub] sendNotification', payload.type, payload.message);
};

// stub kisAPI.executeOrder to simulate success
kisAPI.executeOrder = async (order, user) => {
  console.log('[stub] executeOrder called', order);
  return { order_id: 'MOCK_ORDER_123', order_time: new Date().toISOString() };
};

// --- Test scenario ---
(async () => {
  try {
    const user = {
      id: '000000000000000000000001',
      _id: '000000000000000000000001',
      name: 'Test User',
      trading: { is_paper_trading: true }
    };

    // Decision data WITHOUT targetPrice to force the fallback
    const decisionData = {
      ticker: 'TEST',
      symbol: 'TEST',
      decision: 'sell',
      action: 'sell',
      confidence: 80,
      quantity: 50,
      stock_name: 'Test Stock'
    };

    console.log('\n=== Running executeSell test (targetPrice MISSING, expecting fallback to kisAPI.getStockPrice) ===');

    const result = await aiExecutor.executeSell(user, decisionData, 'TEST', decisionData.action, decisionData.confidence, undefined, 'test-reasoning', {});

    console.log('\n=== Result ===');
    console.log(result);
    process.exit(0);
  } catch (err) {
    console.error('Test script error:', err);
    process.exit(1);
  }
})();
