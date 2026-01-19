/**
 * AI 분석 결과를 받아 KIS API로 주문을 전송하는 서비스
 * Google AI (Gemini)의 분석 결과(JSON)를 파싱하여 조건 충족 시 매수/매도 주문 실행
 */

const kisAPI = require('./kis-api');
const Trading = require('../models/Trading');

class AIOrderExecutor {
  /**
   * 최근 주문 중복 체크 (같은 종목, 같은 주문 타입, 일정 시간 내)
   * @param {Object} user - 사용자 정보
   * @param {String} symbol - 종목코드
   * @param {String} orderType - 주문 타입 ('buy' 또는 'sell')
   * @param {Number} timeWindowMinutes - 체크할 시간 범위 (분, 기본값: 5분)
   * @returns {Object} { isDuplicate: boolean, recentOrder: Object|null, message: string }
   */
  async checkDuplicateOrder(user, symbol, orderType, timeWindowMinutes = 5) {
    try {
      const userId = user.id || user._id || user.userId;
      const isPaper = user.trading?.is_paper_trading !== false;
      
      // 최근 주문 조회 (일정 시간 내)
      const timeWindow = new Date();
      timeWindow.setMinutes(timeWindow.getMinutes() - timeWindowMinutes);
      
      const recentOrder = await Trading.findOne({
        user_id: userId,
        is_paper_trading: isPaper,
        symbol: symbol.toUpperCase(),
        order_type: orderType,
        status: { $in: ['pending', 'completed'] },
        createdAt: { $gte: timeWindow }
      }).sort({ createdAt: -1 });
      
      if (recentOrder) {
        const timeDiff = Math.floor((Date.now() - new Date(recentOrder.createdAt).getTime()) / 1000 / 60);
        return {
          isDuplicate: true,
          recentOrder: {
            order_id: recentOrder.order_id,
            status: recentOrder.status,
            quantity: recentOrder.quantity,
            price: recentOrder.price,
            createdAt: recentOrder.createdAt,
            timeDiffMinutes: timeDiff
          },
          message: `${timeDiff}분 전에 ${orderType === 'buy' ? '매수' : '매도'} 주문이 ${recentOrder.status === 'pending' ? '대기 중' : '체결'}입니다. (주문ID: ${recentOrder.order_id || 'N/A'})`
        };
      }
      
      return {
        isDuplicate: false,
        recentOrder: null,
        message: '중복 주문 없음'
      };
    } catch (error) {
      console.error('[중복 주문 체크] 오류:', error);
      // 에러 발생 시 중복이 아니라고 간주하고 진행
      return {
        isDuplicate: false,
        recentOrder: null,
        message: `중복 체크 실패: ${error.message}`
      };
    }
  }
  /**
   * AI 분석 결과를 파싱하여 조건 충족 시 매수/매도 주문 실행
   * @param {Object} user - 사용자 정보
   * @param {String} aiResponseText - Google AI의 JSON 응답 텍스트
   * @param {Object} options - 추가 옵션 (confidenceThreshold 등)
   * @returns {Object} 주문 실행 결과
   */
  async executeAITrade(user, aiResponseText, options = {}) {
    try {
      // 1. JSON 파싱 (Gemini가 마크다운 코드블록 ```json ... ``` 을 보낼 경우 처리)
      let cleanText = aiResponseText;
      if (cleanText.includes('```json')) {
        cleanText = cleanText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      } else if (cleanText.includes('```')) {
        cleanText = cleanText.replace(/```/g, '').trim();
      }

      // JSON 추출 (중괄호로 감싸진 부분 찾기)
      const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('AI 응답에서 JSON을 찾을 수 없습니다.');
      }

      const decisionData = JSON.parse(jsonMatch[0]);

      // 2. 필수 필드 확인
      const ticker = decisionData.ticker || decisionData.symbol;
      const action = (decisionData.decision || decisionData.action || '').toLowerCase(); // buy, hold, sell
      const confidence = decisionData.confidence_score || decisionData.confidence || 0;
      const targetPrice = decisionData.target_price || decisionData.price || 0;
      const reasoning = decisionData.reasoning || decisionData.reason || '';

      if (!ticker) {
        throw new Error('종목코드(ticker)가 없습니다.');
      }

      console.log(`📈 AI 분석 결과: ${ticker} -> ${action} (확신도: ${confidence}%)`);

      // 3. 액션에 따라 매수/매도 분기 처리
      if (action === 'buy') {
        return await this.executeBuy(user, decisionData, ticker, action, confidence, targetPrice, reasoning, options);
      } else if (action === 'sell') {
        return await this.executeSell(user, decisionData, ticker, action, confidence, targetPrice, reasoning, options);
      } else {
        console.log(`>> 거래 조건 미충족: action=${action} (buy/sell 아님)`);
        return {
          success: false,
          reason: `거래 신호가 아닙니다. (action: ${action})`,
          action,
          confidence,
          failure_stage: 'action_check'
        };
      }
    } catch (error) {
      console.error('[AI 주문 실행] 에러:', error);
      
      if (error.message && error.message.includes('JSON')) {
        return {
          success: false,
          reason: 'AI 응답이 올바른 JSON 형식이 아닙니다.',
          error: error.message,
          failure_stage: 'json_parsing_error'
        };
      }
      
      return {
        success: false,
        reason: error.message || '주문 실행 중 오류가 발생했습니다.',
        error: error.message,
        failure_stage: 'execution_error'
      };
    }
  }

  /**
   * 매수 주문 실행
   */
  async executeBuy(user, decisionData, ticker, action, confidence, targetPrice, reasoning, options = {}) {
    // 매수금지 종목 체크
    try {
      const User = require('../models/User');
      const userId = user.id || user._id || user.userId;
      const userDoc = await User.findById(userId);
      
      if (userDoc && userDoc.trading && userDoc.trading.blocked_buy_symbols) {
        const blockedBuySymbols = Array.isArray(userDoc.trading.blocked_buy_symbols) 
          ? userDoc.trading.blocked_buy_symbols.map(s => s.toUpperCase().trim())
          : [];
        
        if (blockedBuySymbols.includes(ticker.toUpperCase().trim())) {
          const errorMsg = `매수금지 종목으로 지정되어 있어 매수할 수 없습니다. (종목: ${ticker})`;
          console.warn(`>> ${ticker} 매수 주문 취소: ${errorMsg}`);
          return {
            success: false,
            reason: errorMsg,
            action,
            confidence,
            blocked: true,
            failure_stage: 'blocked_symbol_check',
            details: {
              symbol: ticker,
              blocked_type: 'buy',
              blocked_symbols: blockedBuySymbols
            }
          };
        }
      }
      
      // 전체 거래 금지 종목 체크
      if (userDoc && userDoc.trading && userDoc.trading.blocked_symbols) {
        const blockedSymbols = Array.isArray(userDoc.trading.blocked_symbols) 
          ? userDoc.trading.blocked_symbols.map(s => s.toUpperCase().trim())
          : [];
        
        if (blockedSymbols.includes(ticker.toUpperCase().trim())) {
          const errorMsg = `거래금지 종목으로 지정되어 있어 매수할 수 없습니다. (종목: ${ticker})`;
          console.warn(`>> ${ticker} 매수 주문 취소: ${errorMsg}`);
          return {
            success: false,
            reason: errorMsg,
            action,
            confidence,
            blocked: true,
            failure_stage: 'blocked_symbol_check',
            details: {
              symbol: ticker,
              blocked_type: 'all',
              blocked_symbols: blockedSymbols
            }
          };
        }
      }
    } catch (error) {
      console.warn('>> 매수금지 종목 체크 실패:', error.message);
      // 체크 실패해도 계속 진행
    }
    
    // 확신도 임계값: options에서 제공되면 사용, 없으면 사용자 설정값 조회
    let confidenceThreshold = options.confidenceThreshold;
    let autoBuyEnabled = true; // 기본값
    let isActive = true; // 기본값
    
    if (!confidenceThreshold) {
      try {
        const AITradeConfig = require('../models/AITradeConfig');
        const userId = user.id || user._id || user.userId;
        if (userId) {
          // is_paper_trading 확인
          const isPaper = user.trading?.is_paper_trading !== false;
          const aiConfig = await AITradeConfig.findOne({ 
            user_id: userId,
            is_paper_trading: isPaper
          });
          
          // auto_buy 설정 확인 (직접 필드 우선, metadata 다음)
          let autoBuyConfig = aiConfig?.auto_buy;
          if (!autoBuyConfig && aiConfig?.metadata) {
            if (aiConfig.metadata instanceof Map) {
              autoBuyConfig = aiConfig.metadata.get('auto_buy');
            } else {
              autoBuyConfig = aiConfig.metadata.auto_buy;
            }
          }
          
          confidenceThreshold = autoBuyConfig?.confidence_threshold || 70; // 기본값 70%
          autoBuyEnabled = autoBuyConfig?.enabled !== false; // 기본값 true
          isActive = aiConfig?.is_active !== false; // 기본값 true
          
          // 설정 반영 확인 로그
          console.log(`🔍 [AI 주문 실행] 설정 확인: ${ticker} (매수)`, {
            is_active: isActive,
            auto_buy_enabled: autoBuyEnabled,
            confidence_threshold: confidenceThreshold,
            confidence: confidence,
            조건충족: confidence >= confidenceThreshold,
            is_paper_trading: isPaper,
            config_source: autoBuyConfig ? 'direct_field' : (aiConfig?.metadata ? 'metadata' : 'default')
          });
          
          // 설정 불일치 경고
          if (!isActive) {
            console.warn(`⚠️ [AI 주문 실행] AI 거래가 비활성화되어 있습니다: ${ticker}`);
          }
          if (!autoBuyEnabled) {
            console.warn(`⚠️ [AI 주문 실행] 자동 매수가 비활성화되어 있습니다: ${ticker}`);
          }
        } else {
          confidenceThreshold = 70; // 기본값 70%
        }
      } catch (error) {
        console.warn('>> AI 거래 설정 조회 실패, 기본값 사용:', error.message);
        confidenceThreshold = 70; // 기본값 70%
      }
    }
    
    const {
      minQuantity = 1,             // 최소 주문 수량
      maxQuantity = null,           // 최대 주문 수량 (null이면 제한 없음)
      orderMethod = 'limit',        // 주문 방법: 'limit' (지정가) 또는 'market' (시장가)
      maxRetries = 3,               // 최대 재시도 횟수
      retryDelay = 5000             // 재시도 간격 (밀리초)
    } = options;

    // 확신도 임계값 확인
    if (confidence < confidenceThreshold) {
      console.log(`>> 매수 조건 미충족: 확신도 ${confidence}% < 임계값 ${confidenceThreshold}%`);
      return {
        success: false,
        reason: `확신도가 낮습니다. (${confidence}% < ${confidenceThreshold}%)`,
        action,
        confidence,
        threshold: confidenceThreshold,
        failure_stage: 'confidence_check',
        details: {
          confidence: confidence,
          confidence_threshold: confidenceThreshold,
          is_active: isActive,
          auto_buy_enabled: autoBuyEnabled
        }
      };
    }

    console.log('>> 매수 조건 충족! 주문을 준비합니다.');

    // 중복 주문 체크 (최근 5분 내 동일 종목 매수 주문 확인)
    const duplicateCheck = await this.checkDuplicateOrder(user, ticker, 'buy', 5);
    if (duplicateCheck.isDuplicate) {
      console.log(`⏭️  [중복 방지] 매수 주문 스킵: ${ticker}`, {
        이유: duplicateCheck.message,
        최근주문: duplicateCheck.recentOrder
      });
      return {
        success: false,
        reason: duplicateCheck.message,
        action,
        confidence,
        duplicate: true,
        recentOrder: duplicateCheck.recentOrder,
        failure_stage: 'duplicate_order_check',
        details: {
          symbol: ticker,
          order_type: 'buy',
          time_window_minutes: 5,
          recent_order: duplicateCheck.recentOrder
        }
      };
    }

    // 4. 수량 산정
    let buyQty = decisionData.quantity || minQuantity;
    
    // 최대 수량 제한 확인
    if (maxQuantity && buyQty > maxQuantity) {
      console.warn(`>> 주문 수량 제한: ${buyQty}주 -> ${maxQuantity}주`);
      buyQty = maxQuantity;
    }

    // 최소 수량 확인
    if (buyQty < minQuantity) {
      buyQty = minQuantity;
    }

    // 5. 가격 확인 (지정가인 경우)
    let orderPrice = targetPrice;
    if (orderMethod === 'limit' && (!orderPrice || orderPrice <= 0)) {
      // 지정가인데 가격이 없으면 현재가 조회
      try {
        const stockData = await kisAPI.getStockPrice(ticker, user);
        orderPrice = stockData.price || 0;
        console.log(`>> 현재가 조회: ${ticker} = ${orderPrice}원`);
      } catch (priceError) {
        console.error(`>> 현재가 조회 실패: ${ticker}`, priceError);
        throw new Error(`현재가를 조회할 수 없어 주문을 실행할 수 없습니다.`);
      }
    }

    if (orderMethod === 'limit' && orderPrice <= 0) {
      throw new Error('주문 가격이 유효하지 않습니다.');
    }

    // 5-1. 잔액 확인 (매수 주문인 경우)
    // 시장가 주문인 경우 현재가를 사용하여 잔액 확인
    let checkPrice = orderPrice;
    if (orderMethod === 'market' && checkPrice <= 0) {
      try {
        const stockData = await kisAPI.getStockPrice(ticker, user);
        checkPrice = stockData.price || orderPrice;
      } catch (priceError) {
        console.warn(`>> 시장가 주문 잔액 확인을 위한 현재가 조회 실패, 지정가 사용: ${orderPrice}`);
        checkPrice = orderPrice;
      }
    }
    let orderAmount = buyQty * checkPrice;
    try {
      const balance = await kisAPI.getBalance(user);
      
      // AI 거래 설정에서 잔고 제한 확인
      const AITradeConfig = require('../models/AITradeConfig');
      const userId = user.id || user._id || user.userId;
      let maxUsableCash = balance?.availableCash || 0;
      let reservedBalance = 0;
      
      if (userId) {
        try {
          const aiConfig = await AITradeConfig.findOne({ user_id: userId });
          if (aiConfig && aiConfig.auto_buy?.balance_limits) {
            const balanceLimits = aiConfig.auto_buy.balance_limits;
            const maxUsagePercent = balanceLimits.max_balance_usage_percent || 100;
            reservedBalance = balanceLimits.reserved_balance || 0;
            const designatedCash = balanceLimits.designated_cash_balance || 0;
            
            // 사용 가능한 최대 잔고 = (주문가능현금 * 최대사용비율 / 100) - 예약잔고 - 지정현금잔고
            maxUsableCash = Math.max(0, (balance.availableCash * maxUsagePercent / 100) - reservedBalance - designatedCash);
            
            console.log(`>> AI 거래 잔고 제한 적용:`, {
              주문가능현금: `${balance.availableCash.toLocaleString()}원`,
              최대사용비율: `${maxUsagePercent}%`,
              예약잔고: `${reservedBalance.toLocaleString()}원`,
              지정현금잔고: `${designatedCash.toLocaleString()}원`,
              사용가능잔고: `${maxUsableCash.toLocaleString()}원`
            });
          }
        } catch (configError) {
          console.warn(`>> AI 거래 설정 조회 실패, 기본 잔고 사용:`, configError.message);
        }
      }
      
      if (!balance || maxUsableCash < orderAmount) {
        // 잔액 부족 시 수량 자동 조정 시도
        const adjustedQty = Math.floor(maxUsableCash / checkPrice);
        
        if (adjustedQty >= minQuantity) {
          // 최소 수량 이상이면 조정된 수량으로 주문 진행
          console.log(`>> ${ticker} 잔액 부족으로 수량 자동 조정: ${buyQty}주 -> ${adjustedQty}주 (사용가능잔고: ${maxUsableCash.toLocaleString()}원)`);
          buyQty = adjustedQty;
          orderAmount = buyQty * checkPrice;
          // 조정된 수량으로 계속 진행
        } else {
          // 최소 수량도 충족하지 못하면 실패
          const errorMsg = `주문 가능한 잔고가 부족합니다. (필요: ${orderAmount.toLocaleString()}원, 사용가능: ${maxUsableCash.toLocaleString()}원${reservedBalance > 0 ? `, 예약잔고: ${reservedBalance.toLocaleString()}원` : ''}, 최소수량: ${minQuantity}주)`;
          console.warn(`>> ${ticker} 주문 취소: ${errorMsg}`);
          return {
            success: false,
            reason: errorMsg,
            action,
            confidence,
            requiredAmount: orderAmount,
            availableCash: balance?.availableCash || 0,
            maxUsableCash: maxUsableCash,
            reservedBalance: reservedBalance,
            failure_stage: 'balance_check',
            details: {
              symbol: ticker,
              order_amount: orderAmount,
              required_quantity: buyQty,
              adjusted_quantity: adjustedQty,
              min_quantity: minQuantity,
              price_per_share: checkPrice,
              available_cash: balance?.availableCash || 0,
              max_usable_cash: maxUsableCash,
              reserved_balance: reservedBalance,
              balance_limits: aiConfig?.auto_buy?.balance_limits || null
            }
          };
        }
      }
      console.log(`>> 잔액 확인 완료: 주문금액 ${orderAmount.toLocaleString()}원, 사용가능잔고 ${maxUsableCash.toLocaleString()}원`);
    } catch (balanceError) {
      console.error(`>> 잔고 조회 실패: ${ticker}`, balanceError);
      throw new Error(`잔고를 확인할 수 없어 주문을 실행할 수 없습니다: ${balanceError.message}`);
    }

    // 5-2. 포트폴리오 기반 중복 구매 방지
    try {
      const isPaper = user.trading?.is_paper_trading !== false;
      let portfolio = [];
      
      if (isPaper) {
        // 모의투자: DB 포트폴리오 조회
        const Portfolio = require('../models/Portfolio');
        const userId = user.id || user._id || user.userId;
        const dbPortfolio = await Portfolio.findOne({ user_id: userId, is_paper_trading: true });
        if (dbPortfolio && dbPortfolio.holdings) {
          portfolio = dbPortfolio.holdings.filter(h => h && h.symbol && h.quantity > 0);
        }
      } else {
        // 실전투자: KIS API 포트폴리오 조회
        portfolio = await kisAPI.getPortfolio(user);
      }
        
        // 동일 종목 보유량 확인
        const existingHolding = portfolio.find(h => h.symbol === ticker);
        if (existingHolding && existingHolding.quantity > 0) {
          // 포트폴리오에서 해당 종목의 비율 계산
          const totalValue = portfolio.reduce((sum, h) => {
            const value = (h.current_price || h.price || 0) * (h.quantity || 0);
            return sum + value;
          }, 0);
          
          const holdingValue = (existingHolding.current_price || existingHolding.price || 0) * existingHolding.quantity;
          const holdingPercent = totalValue > 0 ? (holdingValue / totalValue) * 100 : 0;
          
          // 최대 보유 비율 확인 (기본 20%)
          const AITradeConfig = require('../models/AITradeConfig');
          const userId = user.id || user._id || user.userId;
          let maxHoldingPercent = 20; // 기본값 20%
          
          if (userId) {
            try {
              const aiConfig = await AITradeConfig.findOne({ user_id: userId });
              if (aiConfig?.auto_buy?.max_holding_percent) {
                maxHoldingPercent = aiConfig.auto_buy.max_holding_percent;
              }
            } catch (configError) {
              // 설정 조회 실패 시 기본값 사용
            }
          }
          
          // 보유 비율이 최대치를 초과하면 주문 수량 조정
          if (holdingPercent >= maxHoldingPercent) {
            const errorMsg = `포트폴리오에서 ${ticker}의 보유 비율이 ${holdingPercent.toFixed(2)}%로 최대치(${maxHoldingPercent}%)를 초과합니다.`;
            console.warn(`>> ${ticker} 주문 취소: ${errorMsg}`);
            return {
              success: false,
              reason: errorMsg,
              action,
              confidence,
              holdingPercent: holdingPercent.toFixed(2),
              maxHoldingPercent,
              failure_stage: 'portfolio_holding_percent_check',
              details: {
                symbol: ticker,
                current_holding_percent: holdingPercent,
                max_holding_percent: maxHoldingPercent,
                holding_value: holdingValue,
                total_portfolio_value: totalValue
              }
            };
          }
          
          // 보유 비율이 높으면 수량 조정
          const newOrderValue = buyQty * checkPrice;
          const newTotalValue = totalValue + newOrderValue;
          const newHoldingValue = holdingValue + newOrderValue;
          const newHoldingPercent = (newHoldingValue / newTotalValue) * 100;
          
          if (newHoldingPercent > maxHoldingPercent) {
            // 최대 보유 비율을 초과하지 않도록 수량 조정
            const maxNewHoldingValue = (newTotalValue * maxHoldingPercent / 100) - holdingValue;
            const adjustedQty = Math.floor(maxNewHoldingValue / checkPrice);
            
            if (adjustedQty < 1) {
              const errorMsg = `포트폴리오에서 ${ticker}의 보유 비율이 이미 최대치에 근접하여 추가 구매가 불가능합니다.`;
              console.warn(`>> ${ticker} 주문 취소: ${errorMsg}`);
              return {
                success: false,
                reason: errorMsg,
                action,
                confidence,
                holdingPercent: holdingPercent.toFixed(2),
                maxHoldingPercent,
                failure_stage: 'portfolio_holding_percent_adjustment',
                details: {
                  symbol: ticker,
                  original_quantity: buyQty,
                  adjusted_quantity: adjustedQty,
                  current_holding_percent: holdingPercent,
                  max_holding_percent: maxHoldingPercent,
                  new_holding_percent: newHoldingPercent
                }
              };
            }
            
            console.log(`>> ${ticker} 주문 수량 조정: ${buyQty}주 -> ${adjustedQty}주 (보유 비율 제한)`);
            buyQty = adjustedQty;
          }
        }
        
        // 최대 보유 종목 수 확인 (기본 20개)
        const AITradeConfig2 = require('../models/AITradeConfig');
        const userId2 = user.id || user._id || user.userId;
        let maxHoldingsCount = 20; // 기본값 20개
        
        if (userId2) {
          try {
            const aiConfig = await AITradeConfig2.findOne({ user_id: userId2 });
            if (aiConfig?.auto_buy?.max_holdings_count) {
              maxHoldingsCount = aiConfig.auto_buy.max_holdings_count;
            }
          } catch (configError) {
            // 설정 조회 실패 시 기본값 사용
          }
        }
        
        // 새로운 종목 추가 시 최대 보유 종목 수 확인
        if (!existingHolding && portfolio.length >= maxHoldingsCount) {
          const errorMsg = `포트폴리오의 보유 종목 수(${portfolio.length}개)가 최대치(${maxHoldingsCount}개)에 도달했습니다.`;
          console.warn(`>> ${ticker} 주문 취소: ${errorMsg}`);
          return {
            success: false,
            reason: errorMsg,
            action,
            confidence,
            currentHoldingsCount: portfolio.length,
            maxHoldingsCount
          };
        }
    } catch (portfolioError) {
      console.warn(`>> 포트폴리오 확인 실패 (계속 진행): ${ticker}`, portfolioError.message);
      // 포트폴리오 확인 실패해도 주문은 계속 진행
    }

    // 5-3. 가격 변동 모니터링 (주문 전 현재가 재확인)
    let finalOrderPrice = orderPrice;
    if (orderMethod === 'limit' && orderPrice > 0) {
      try {
        const currentStockData = await kisAPI.getStockPrice(ticker, user);
        const currentPrice = currentStockData.price || 0;
        
        if (currentPrice > 0) {
          // 가격 변동률 계산
          const priceChangePercent = ((currentPrice - orderPrice) / orderPrice) * 100;
          
          // 가격 변동률 임계값 (기본 ±10%로 증가)
          const AITradeConfig3 = require('../models/AITradeConfig');
          const userId3 = user.id || user._id || user.userId;
          let maxPriceChangePercent = 10; // 기본값 10%로 증가 (기존 5%에서 변경)
          let configSource = 'default';
          
          if (userId3) {
            try {
              const aiConfig = await AITradeConfig3.findOne({ user_id: userId3 });
              if (aiConfig?.auto_buy?.max_price_change_percent) {
                maxPriceChangePercent = aiConfig.auto_buy.max_price_change_percent;
                configSource = 'DB';
              }
              console.log(`[AI 거래] 가격 변동률 임계값 조회: ${ticker}`, {
                user_id: userId3,
                max_price_change_percent: maxPriceChangePercent,
                source: configSource,
                price_change_percent: priceChangePercent.toFixed(2),
                threshold_exceeded: Math.abs(priceChangePercent) > maxPriceChangePercent
              });
            } catch (configError) {
              console.warn(`[AI 거래] 가격 변동률 임계값 조회 실패 (기본값 사용): ${ticker}`, configError.message);
              // 설정 조회 실패 시 기본값 사용
            }
          } else {
            console.log(`[AI 거래] 가격 변동률 임계값 조회: ${ticker}`, {
              user_id: null,
              max_price_change_percent: maxPriceChangePercent,
              source: 'default (no_user_id)',
              price_change_percent: priceChangePercent.toFixed(2),
              threshold_exceeded: Math.abs(priceChangePercent) > maxPriceChangePercent
            });
          }
          
          // 가격 변동률이 임계값을 초과하면 주문 취소 또는 가격 조정
          if (Math.abs(priceChangePercent) > maxPriceChangePercent) {
            // 가격 변동률 초과 시 현재가로 조정 옵션 확인
            let adjustPrice = true; // 기본값을 true로 변경 (가격 조정 허용)
            if (userId3) {
              try {
                const aiConfig = await AITradeConfig3.findOne({ user_id: userId3 });
                // 명시적으로 false로 설정된 경우에만 가격 조정 비활성화
                adjustPrice = aiConfig?.auto_buy?.adjust_price_on_volatility !== false;
                console.log(`[AI 거래] 가격 조정 옵션 조회: ${ticker}`, {
                  user_id: userId3,
                  adjust_price_on_volatility: aiConfig?.auto_buy?.adjust_price_on_volatility,
                  final_adjust_price: adjustPrice,
                  source: 'DB'
                });
              } catch (configError) {
                console.warn(`[AI 거래] 가격 조정 옵션 조회 실패 (기본값 사용): ${ticker}`, configError.message);
                // 설정 조회 실패 시 기본값 사용 (true)
              }
            }
            
            if (adjustPrice) {
              // 현재가로 주문가 조정
              finalOrderPrice = currentPrice;
              console.log(`>> ${ticker} 주문가 조정 (가격 변동률 초과): ${orderPrice.toLocaleString()}원 -> ${currentPrice.toLocaleString()}원 (변동률: ${priceChangePercent.toFixed(2)}%)`);
              } else {
                // 가격이 크게 변동했고 가격 조정이 비활성화된 경우 주문 취소
                const errorMsg = `가격 변동률(${priceChangePercent.toFixed(2)}%)이 임계값(±${maxPriceChangePercent}%)을 초과했습니다. (주문가: ${orderPrice.toLocaleString()}원, 현재가: ${currentPrice.toLocaleString()}원)`;
                console.warn(`>> ${ticker} 주문 취소: ${errorMsg}`);
                return {
                  success: false,
                  reason: errorMsg,
                  action,
                  confidence,
                  orderPrice,
                  currentPrice,
                  priceChangePercent: priceChangePercent.toFixed(2),
                  failure_stage: 'price_volatility_check',
                  details: {
                    symbol: ticker,
                    order_price: orderPrice,
                    current_price: currentPrice,
                    price_change_percent: priceChangePercent,
                    max_price_change_percent: maxPriceChangePercent,
                    adjust_price_on_volatility: adjustPrice
                  }
                };
              }
          } else if (Math.abs(priceChangePercent) > 1) {
            // 가격 변동률이 1% 이상이면 주문가 조정
            finalOrderPrice = currentPrice;
            console.log(`>> ${ticker} 주문가 조정: ${orderPrice.toLocaleString()}원 -> ${currentPrice.toLocaleString()}원 (변동률: ${priceChangePercent.toFixed(2)}%)`);
          }
        }
      } catch (priceCheckError) {
        console.warn(`>> 가격 재확인 실패 (원래 가격 사용): ${ticker}`, priceCheckError.message);
        // 가격 재확인 실패해도 원래 가격으로 주문 진행
      }
    }

    // 6. 실제 주문 전송 (재시도 로직 포함)
    console.log(`>> 주문 전송: ${ticker} ${buyQty}주 @ ${orderMethod === 'market' ? '시장가' : finalOrderPrice + '원'}`);
    
    let orderResult = null;
    let lastError = null;
    let retryCount = 0;
    
    // 재시도 로직
    while (retryCount <= maxRetries) {
      try {
        // KIS API 주문 실행 (executeOrder 사용)
        orderResult = await kisAPI.executeOrder({
          symbol: ticker,
          order_type: 'buy',
          quantity: buyQty,
          price: orderMethod === 'market' ? 0 : finalOrderPrice,
          order_method: orderMethod
        }, user);
        
        // 성공하면 루프 종료
        if (orderResult && orderResult.order_id) {
          break;
        }
      } catch (error) {
        lastError = error;
        retryCount++;
        
        // 재시도 가능한 오류인지 확인
        const errorMessage = error.message || String(error);
        const isTradingHoursError = errorMessage.includes('거래시간이 아닙니다') || 
                                    errorMessage.includes('거래시간') ||
                                    errorMessage.includes('장마감') ||
                                    errorMessage.includes('장시작');
        
        // 거래시간 외 에러는 재시도하지 않고 즉시 실패 처리
        if (isTradingHoursError) {
          console.warn(`>> ${ticker} 거래시간 외 주문 실패: ${errorMessage}`);
          
          // 실시간 주문 정리: 거래시간 외 실패 시 pending 주문 정리
          try {
            const userId = user.id || user._id || user.userId;
            const isPaper = user.trading?.is_paper_trading !== false;
            const timeWindow = new Date();
            timeWindow.setMinutes(timeWindow.getMinutes() - 5); // 최근 5분 내
            
            // 최근 생성된 동일 종목, 동일 주문 타입의 pending 주문 정리
            const pendingOrders = await Trading.find({
              user_id: userId,
              is_paper_trading: isPaper,
              symbol: ticker.toUpperCase(),
              order_type: 'buy',
              status: 'pending',
              source: 'ai-trade',
              createdAt: { $gte: timeWindow }
            });
            
            if (pendingOrders.length > 0) {
              await Trading.updateMany(
                { _id: { $in: pendingOrders.map(o => o._id) } },
                { 
                  $set: { 
                    status: 'cancelled',
                    cancelled_at: new Date()
                  },
                  $push: {
                    metadata: {
                      cancellation_reason: '거래시간 외 주문 실패로 인한 자동 취소',
                      cancelled_at: new Date()
                    }
                  }
                }
              );
              console.log(`✅ [거래시간 외 실패] 실시간 주문 정리 완료: ${ticker} (${pendingOrders.length}건 취소)`);
            }
          } catch (cleanupError) {
            console.error(`❌ [거래시간 외 실패] 실시간 주문 정리 실패: ${ticker}`, cleanupError.message);
          }
          
          // 거래시간 외 실패를 명확한 failure_stage로 반환
          return {
            success: false,
            reason: errorMessage,
            action,
            confidence,
            failure_stage: 'trading_hours_check',
            details: {
              symbol: ticker,
              error_type: 'trading_hours_outside',
              error_message: errorMessage
            }
          };
        }
        
        const isRetryableError = 
          errorMessage.includes('초당 거래건수') ||
          errorMessage.includes('API 호출 제한') ||
          errorMessage.includes('네트워크') ||
          errorMessage.includes('timeout') ||
          errorMessage.includes('ECONNRESET') ||
          errorMessage.includes('ETIMEDOUT') ||
          (error.response && error.response.status >= 500);
        
        if (!isRetryableError || retryCount > maxRetries) {
          // 재시도 불가능한 오류이거나 최대 재시도 횟수 초과
          throw error;
        }
        
        console.log(`>> ${ticker} 주문 재시도 (${retryCount}/${maxRetries}): ${errorMessage}`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
    
    if (!orderResult || !orderResult.order_id) {
      const finalError = lastError || new Error('주문 실행 실패');
      
      // 거래시간 외 에러 체크
      const errorMessage = finalError.message || String(finalError);
      const isTradingHoursError = errorMessage.includes('거래시간이 아닙니다') || 
                                    errorMessage.includes('거래시간') ||
                                    errorMessage.includes('장마감') ||
                                    errorMessage.includes('장시작');
      
      if (isTradingHoursError) {
        console.warn(`>> ${ticker} 거래시간 외 주문 실패: ${errorMessage}`);
        
        // 실시간 주문 정리
        try {
          const userId = user.id || user._id || user.userId;
          const isPaper = user.trading?.is_paper_trading !== false;
          const timeWindow = new Date();
          timeWindow.setMinutes(timeWindow.getMinutes() - 5);
          
          const pendingOrders = await Trading.find({
            user_id: userId,
            is_paper_trading: isPaper,
            symbol: ticker.toUpperCase(),
            order_type: 'buy',
            status: 'pending',
            source: 'ai-trade',
            createdAt: { $gte: timeWindow }
          });
          
          if (pendingOrders.length > 0) {
            await Trading.updateMany(
              { _id: { $in: pendingOrders.map(o => o._id) } },
              { 
                $set: { 
                  status: 'cancelled',
                  cancelled_at: new Date()
                }
              }
            );
            console.log(`✅ [거래시간 외 실패] 실시간 주문 정리 완료: ${ticker} (${pendingOrders.length}건 취소)`);
          }
        } catch (cleanupError) {
          console.error(`❌ [거래시간 외 실패] 실시간 주문 정리 실패: ${ticker}`, cleanupError.message);
        }
        
        return {
          success: false,
          reason: errorMessage,
          action,
          confidence,
          failure_stage: 'trading_hours_check',
          details: {
            symbol: ticker,
            error_type: 'trading_hours_outside',
            error_message: errorMessage
          }
        };
      }
      
      throw finalError;
    }

    // executeOrder는 성공 시 주문 정보 객체를 반환, 실패 시 에러 throw
    if (orderResult && orderResult.order_id) {
      console.log(`>> ${ticker} 매수 주문 완료. 이유: ${reasoning}`);
      
      // 7. 주문 기록 저장
      try {
        const isPaper = user.trading?.is_paper_trading !== false;
        const userId = user.id || user._id;
        
        console.log(`💾 [AI 거래] 주문 내역 저장 시작: ${ticker}`, {
          userId,
          isPaper,
          symbol: ticker,
          order_type: 'buy',
          quantity: buyQty,
          price: orderMethod === 'market' ? 0 : orderPrice,
          order_method: orderMethod,
          order_id: orderResult.order_id,
          source: 'ai-trade'
        });
        
        const tradingRecord = await Trading.create({
          user_id: userId,
          is_paper_trading: isPaper,
          symbol: ticker,
          stock_name: decisionData.stock_name || decisionData.name || '',
          order_type: 'buy',
          quantity: buyQty,
          price: orderMethod === 'market' ? 0 : orderPrice, // 시장가는 체결 후 가격 확인
          order_method: orderMethod,
          status: 'pending',
          order_id: orderResult.order_id || null,
          source: 'ai-trade',
          metadata: {
            ai_confidence: confidence,
            ai_reasoning: reasoning,
            ai_target_price: targetPrice,
            ai_decision: action
          }
        });
        
        console.log(`✅ [AI 거래] 주문 내역 저장 완료: ${ticker}`, {
          tradingRecordId: tradingRecord._id,
          order_id: tradingRecord.order_id,
          source: tradingRecord.source,
          createdAt: tradingRecord.createdAt
        });
      } catch (dbError) {
        console.error(`❌ [AI 거래] 주문 기록 저장 실패: ${ticker}`, {
          error: dbError.message,
          stack: dbError.stack,
          userId: user.id || user._id,
          order_id: orderResult.order_id
        });
        // DB 저장 실패해도 주문은 성공했으므로 계속 진행
      }

      // AI 주문 실행 알림 발송
      try {
        const notificationService = require('./notification-service');
        await notificationService.sendNotification({
          userId: user.id || user._id,
          type: 'order_executed',
          title: 'AI 자동 매수 주문 체결',
          message: `${decisionData.stock_name || ticker} ${buyQty}주 매수 주문이 체결되었습니다.`,
          data: {
            symbol: ticker,
            stock_name: decisionData.stock_name || decisionData.name || '',
            order_type: 'buy',
            quantity: buyQty,
            price: orderMethod === 'market' ? 0 : orderPrice,
            order_id: orderResult.order_id,
            confidence: confidence
          }
        });
      } catch (notificationError) {
        console.warn(`>> 알림 발송 실패 (주문은 성공): ${ticker}`, notificationError.message);
      }

      return {
        success: true,
        symbol: ticker,
        quantity: buyQty,
        price: orderMethod === 'market' ? 0 : orderPrice,
        order_method: orderMethod,
        order_id: orderResult.order_id,
        order_time: orderResult.order_time,
        reasoning,
        confidence
      };
    } else {
      console.error(`>> ${ticker} 매수 주문 실패: 주문 결과가 올바르지 않습니다.`);
      return {
        success: false,
        reason: '주문 결과가 올바르지 않습니다.',
        symbol: ticker,
        action,
        confidence
      };
    }
  }

  /**
   * 매도 주문 실행
   */
  async executeSell(user, decisionData, ticker, action, confidence, targetPrice, reasoning, options = {}) {
    // 중복 주문 체크 (최근 5분 내 동일 종목 매도 주문 확인)
    const duplicateCheck = await this.checkDuplicateOrder(user, ticker, 'sell', 5);
    if (duplicateCheck.isDuplicate) {
      console.log(`⏭️  [중복 방지] 매도 주문 스킵: ${ticker}`, {
        이유: duplicateCheck.message,
        최근주문: duplicateCheck.recentOrder
      });
      return {
        success: false,
        reason: duplicateCheck.message,
        action,
        confidence,
        duplicate: true,
        recentOrder: duplicateCheck.recentOrder
      };
    }
    // 매도금지 종목 체크
    try {
      const User = require('../models/User');
      const userId = user.id || user._id || user.userId;
      const userDoc = await User.findById(userId);
      
      if (userDoc && userDoc.trading && userDoc.trading.blocked_sell_symbols) {
        const blockedSellSymbols = Array.isArray(userDoc.trading.blocked_sell_symbols) 
          ? userDoc.trading.blocked_sell_symbols.map(s => s.toUpperCase().trim())
          : [];
        
        if (blockedSellSymbols.includes(ticker.toUpperCase().trim())) {
          const errorMsg = `매도금지 종목으로 지정되어 있어 매도할 수 없습니다. (종목: ${ticker})`;
          console.warn(`>> ${ticker} 매도 주문 취소: ${errorMsg}`);
          return {
            success: false,
            reason: errorMsg,
            action,
            confidence,
            blocked: true
          };
        }
      }
    } catch (error) {
      console.warn('>> 매도금지 종목 체크 실패:', error.message);
      // 체크 실패해도 계속 진행
    }
    
    // 확신도 임계값: options에서 제공되면 사용, 없으면 사용자 설정값 조회
    let confidenceThreshold = options.confidenceThreshold;
    
    if (!confidenceThreshold) {
      try {
        const AITradeConfig = require('../models/AITradeConfig');
        const userId = user.id || user._id || user.userId;
        if (userId) {
          // is_paper_trading 확인
          const isPaper = user.trading?.is_paper_trading !== false;
          const aiConfig = await AITradeConfig.findOne({ 
            user_id: userId,
            is_paper_trading: isPaper
          });
          
          // auto_sell 설정 확인 (직접 필드 우선, metadata 다음)
          let autoSellConfig = aiConfig?.auto_sell;
          if (!autoSellConfig && aiConfig?.metadata) {
            if (aiConfig.metadata instanceof Map) {
              autoSellConfig = aiConfig.metadata.get('auto_sell');
            } else {
              autoSellConfig = aiConfig.metadata.auto_sell;
            }
          }
          
          confidenceThreshold = autoSellConfig?.confidence_threshold || 70; // 기본값 70%
          const autoSellEnabled = autoSellConfig?.enabled !== false; // 기본값 true
          const isActive = aiConfig?.is_active !== false; // 기본값 true
          
          // B2: 손실 종목 확신도 임계값 완화
          let isLossStock = false;
          let originalThreshold = confidenceThreshold;
          
          try {
            // 포트폴리오에서 보유 종목 확인
            const kisAPI = require('./kis-api');
            let portfolio = [];
            if (isPaper) {
              const Portfolio = require('../models/Portfolio');
              const userId = user.id || user._id || user.userId;
              const dbPortfolio = await Portfolio.findOne({ user_id: userId, is_paper_trading: true });
              if (dbPortfolio && dbPortfolio.holdings) {
                portfolio = dbPortfolio.holdings.filter(h => h && h.symbol && h.quantity > 0);
              }
            } else {
              portfolio = await kisAPI.getPortfolio(user);
            }
            
            const holding = portfolio.find(h => 
              h && h.symbol && h.symbol.toUpperCase() === ticker.toUpperCase()
            );
            
            if (holding && holding.quantity > 0) {
              // 현재가 우선 사용: AI의 targetPrice가 없을 경우 KIS API에서 현재가 조회
              let currentPrice = 0;
              try {
                if (targetPrice && targetPrice > 0) {
                  currentPrice = targetPrice;
                  console.log(`🔎 [${ticker}] targetPrice 사용: ${currentPrice}원`);
                } else {
                  const stockData = await kisAPI.getStockPrice(ticker, user);
                  currentPrice = stockData?.price || targetPrice || 0;
                  console.log(`🔎 [${ticker}] 현재가 조회 사용: ${currentPrice}원`);
                }
              } catch (priceErr) {
                console.warn(`⚠️ [${ticker}] 현재가 조회 실패, targetPrice 또는 0 사용: ${priceErr.message}`);
                currentPrice = targetPrice || 0;
              }

              const averagePrice = holding.averagePrice || holding.avgPrice || 0;
              
              if (currentPrice > 0 && averagePrice > 0) {
                const profitLossRate = ((currentPrice - averagePrice) / averagePrice) * 100;
                
                if (profitLossRate < -10) {
                  isLossStock = true;
                  // 손실 종목의 경우 확신도 임계값을 50%로 완화
                  confidenceThreshold = Math.min(confidenceThreshold, 50);
                  console.log(`📉 [${ticker}] 손실 종목으로 확신도 임계값 완화: ${originalThreshold}% → ${confidenceThreshold}% (손실률: ${profitLossRate.toFixed(2)}%)`);
                }
              }
            }
          } catch (lossCheckError) {
            console.warn(`⚠️ [${ticker}] 손실 종목 체크 오류:`, lossCheckError.message);
          }
          
          // 설정 반영 확인 로그
          console.log(`🔍 [AI 주문 실행] 설정 확인: ${ticker} (매도)`, {
            is_active: isActive,
            auto_sell_enabled: autoSellEnabled,
            confidence_threshold: confidenceThreshold,
            original_threshold: originalThreshold,
            confidence: confidence,
            조건충족: confidence >= confidenceThreshold,
            is_loss_stock: isLossStock,
            is_paper_trading: isPaper,
            config_source: autoSellConfig ? 'direct_field' : (aiConfig?.metadata ? 'metadata' : 'default')
          });
          
          // 설정 불일치 경고
          if (!isActive) {
            console.warn(`⚠️ [AI 주문 실행] AI 거래가 비활성화되어 있습니다: ${ticker}`);
          }
          if (!autoSellEnabled) {
            console.warn(`⚠️ [AI 주문 실행] 자동 매도가 비활성화되어 있습니다: ${ticker}`);
          }
        } else {
          confidenceThreshold = 70; // 기본값 70%
        }
      } catch (error) {
        console.warn('>> AI 거래 설정 조회 실패, 기본값 사용:', error.message);
        confidenceThreshold = 70; // 기본값 70%
      }
    }
    
    const {
      minQuantity = 1,             // 최소 주문 수량
      maxQuantity = null,           // 최대 주문 수량 (null이면 제한 없음)
      orderMethod = 'limit',        // 주문 방법: 'limit' (지정가) 또는 'market' (시장가)
      maxRetries = 3,               // 최대 재시도 횟수
      retryDelay = 5000             // 재시도 간격 (밀리초)
    } = options;

    // 확신도 임계값 확인
    if (confidence < confidenceThreshold) {
      console.log(`>> 매도 조건 미충족: 확신도 ${confidence}% < 임계값 ${confidenceThreshold}%`);
      return {
        success: false,
        reason: `확신도가 낮습니다. (${confidence}% < ${confidenceThreshold}%)`,
        action,
        confidence,
        threshold: confidenceThreshold
      };
    }

    console.log('>> 매도 조건 충족! 주문을 준비합니다.');

    // 1. 보유 수량 확인
    const isPaper = user.trading?.is_paper_trading !== false;
    let portfolio = [];
    let holding = null;
    
    try {
      if (isPaper) {
        // 모의투자: DB 포트폴리오 조회
        const Portfolio = require('../models/Portfolio');
        const userId = user.id || user._id || user.userId;
        const dbPortfolio = await Portfolio.findOne({ user_id: userId, is_paper_trading: true });
        if (dbPortfolio && dbPortfolio.holdings) {
          portfolio = dbPortfolio.holdings.filter(h => h && h.symbol && h.quantity > 0);
          holding = portfolio.find(h => h.symbol === ticker);
        }
      } else {
        // 실전투자: KIS API 포트폴리오 조회
        portfolio = await kisAPI.getPortfolio(user);
        holding = portfolio.find(h => h.symbol === ticker);
      }
    } catch (portfolioError) {
      console.error(`>> 포트폴리오 조회 실패: ${ticker}`, portfolioError);
      return {
        success: false,
        reason: `포트폴리오를 조회할 수 없어 매도 주문을 실행할 수 없습니다: ${portfolioError.message}`,
        action,
        confidence
      };
    }

    if (!holding || !holding.quantity || holding.quantity <= 0) {
      const errorMsg = `보유 수량이 없어 매도 주문을 실행할 수 없습니다. (종목: ${ticker})`;
      console.warn(`>> ${ticker} 매도 주문 취소: ${errorMsg}`);
      return {
        success: false,
        reason: errorMsg,
        action,
        confidence,
        holdingQuantity: holding?.quantity || 0
      };
    }

    const availableQuantity = holding.quantity;

    // 2. 매도 수량 산정
    let sellQty = decisionData.quantity || maxQuantity || availableQuantity;
    
    // 최대 수량 제한 확인
    if (maxQuantity && sellQty > maxQuantity) {
      console.warn(`>> 주문 수량 제한: ${sellQty}주 -> ${maxQuantity}주`);
      sellQty = maxQuantity;
    }
    
    // 보유 수량 초과 방지
    if (sellQty > availableQuantity) {
      console.warn(`>> 보유 수량 초과 방지: ${sellQty}주 -> ${availableQuantity}주`);
      sellQty = availableQuantity;
    }

    // 최소 수량 확인
    if (sellQty < minQuantity) {
      const errorMsg = `매도 수량(${sellQty}주)이 최소 수량(${minQuantity}주)보다 적습니다.`;
      console.warn(`>> ${ticker} 매도 주문 취소: ${errorMsg}`);
      return {
        success: false,
        reason: errorMsg,
        action,
        confidence,
        sellQty,
        minQuantity
      };
    }

    // 3. 가격 확인 (지정가인 경우)
    let orderPrice = targetPrice;
    if (orderMethod === 'limit' && (!orderPrice || orderPrice <= 0)) {
      // 지정가인데 가격이 없으면 현재가 조회
      try {
        const stockData = await kisAPI.getStockPrice(ticker, user);
        orderPrice = stockData.price || 0;
        console.log(`>> 현재가 조회: ${ticker} = ${orderPrice}원`);
      } catch (priceError) {
        console.error(`>> 현재가 조회 실패: ${ticker}`, priceError);
        throw new Error(`현재가를 조회할 수 없어 주문을 실행할 수 없습니다.`);
      }
    }

    if (orderMethod === 'limit' && orderPrice <= 0) {
      throw new Error('주문 가격이 유효하지 않습니다.');
    }

    // 4. 최소 보유 기간 확인
    try {
      const AITradeConfig = require('../models/AITradeConfig');
      const userId = user.id || user._id || user.userId;
      if (userId) {
        const aiConfig = await AITradeConfig.findOne({ user_id: userId });
        const minHoldingDays = aiConfig?.auto_sell?.min_holding_days || 0;
        
        if (minHoldingDays > 0 && holding.purchase_date) {
          const purchaseDate = new Date(holding.purchase_date);
          const daysHeld = Math.floor((new Date() - purchaseDate) / (1000 * 60 * 60 * 24));
          
          if (daysHeld < minHoldingDays) {
            const errorMsg = `최소 보유 기간(${minHoldingDays}일) 미달로 매도할 수 없습니다. (보유 기간: ${daysHeld}일)`;
            console.warn(`>> ${ticker} 매도 주문 취소: ${errorMsg}`);
            return {
              success: false,
              reason: errorMsg,
              action,
              confidence,
              daysHeld,
              minHoldingDays
            };
          }
        }
      }
    } catch (configError) {
      console.warn(`>> 최소 보유 기간 확인 실패 (계속 진행): ${ticker}`, configError.message);
    }

    // 5. 가격 변동 모니터링 (주문 전 현재가 재확인)
    let finalOrderPrice = orderPrice;
    if (orderMethod === 'limit' && orderPrice > 0) {
      try {
        const currentStockData = await kisAPI.getStockPrice(ticker, user);
        const currentPrice = currentStockData.price || 0;
        
        if (currentPrice > 0) {
          // 가격 변동률 계산
          const priceChangePercent = ((currentPrice - orderPrice) / orderPrice) * 100;
          
          // 가격 변동률 임계값 (기본 ±10%로 증가)
          const AITradeConfig = require('../models/AITradeConfig');
          const userId = user.id || user._id || user.userId;
          let maxPriceChangePercent = 10; // 기본값 10%로 증가 (기존 5%에서 변경)
          let configSource = 'default';
          
          if (userId) {
            try {
              const aiConfig = await AITradeConfig.findOne({ user_id: userId });
              if (aiConfig?.auto_sell?.max_price_change_percent) {
                maxPriceChangePercent = aiConfig.auto_sell.max_price_change_percent;
                configSource = 'DB (auto_sell)';
              } else if (aiConfig?.auto_buy?.max_price_change_percent) {
                maxPriceChangePercent = aiConfig.auto_buy.max_price_change_percent;
                configSource = 'DB (auto_buy, fallback)';
              }
              console.log(`[AI 거래] 매도 가격 변동률 임계값 조회: ${ticker}`, {
                user_id: userId,
                max_price_change_percent: maxPriceChangePercent,
                source: configSource,
                price_change_percent: priceChangePercent.toFixed(2),
                threshold_exceeded: Math.abs(priceChangePercent) > maxPriceChangePercent
              });
            } catch (configError) {
              console.warn(`[AI 거래] 매도 설정 조회 실패 (기본값 사용): ${ticker}`, configError.message);
              // 설정 조회 실패 시 기본값 사용
            }
          } else {
            console.log(`[AI 거래] 매도 가격 변동률 임계값 조회: ${ticker}`, {
              user_id: null,
              max_price_change_percent: maxPriceChangePercent,
              source: 'default (no_user_id)',
              price_change_percent: priceChangePercent.toFixed(2),
              threshold_exceeded: Math.abs(priceChangePercent) > maxPriceChangePercent
            });
          }
          
          // 가격 변동률이 임계값을 초과하면 주문 취소 또는 가격 조정
          if (Math.abs(priceChangePercent) > maxPriceChangePercent) {
            // 가격 변동률 초과 시 현재가로 조정 옵션 확인
            let adjustPrice = true; // 기본값을 true로 변경 (가격 조정 허용)
            if (userId) {
              try {
                const aiConfig = await AITradeConfig.findOne({ user_id: userId });
                // 명시적으로 false로 설정된 경우에만 가격 조정 비활성화
                adjustPrice = aiConfig?.auto_sell?.adjust_price_on_volatility !== false;
                // auto_sell에 없으면 auto_buy 설정 사용
                if (adjustPrice === undefined && aiConfig?.auto_buy?.adjust_price_on_volatility !== undefined) {
                  adjustPrice = aiConfig.auto_buy.adjust_price_on_volatility !== false;
                }
                console.log(`[AI 거래] 매도 가격 조정 옵션 조회: ${ticker}`, {
                  user_id: userId,
                  auto_sell_adjust: aiConfig?.auto_sell?.adjust_price_on_volatility,
                  auto_buy_adjust: aiConfig?.auto_buy?.adjust_price_on_volatility,
                  final_adjust_price: adjustPrice,
                  source: 'DB'
                });
              } catch (configError) {
                console.warn(`[AI 거래] 매도 가격 조정 옵션 조회 실패 (기본값 사용): ${ticker}`, configError.message);
                // 설정 조회 실패 시 기본값 사용 (true)
              }
            }
            
            if (adjustPrice) {
              // 현재가로 주문가 조정
              finalOrderPrice = currentPrice;
              console.log(`>> ${ticker} 주문가 조정 (가격 변동률 초과): ${orderPrice.toLocaleString()}원 -> ${currentPrice.toLocaleString()}원 (변동률: ${priceChangePercent.toFixed(2)}%)`);
            } else {
              // 가격이 크게 변동했고 가격 조정이 비활성화된 경우 주문 취소
              const errorMsg = `가격 변동률(${priceChangePercent.toFixed(2)}%)이 임계값(±${maxPriceChangePercent}%)을 초과했습니다. (주문가: ${orderPrice.toLocaleString()}원, 현재가: ${currentPrice.toLocaleString()}원)`;
              console.warn(`>> ${ticker} 매도 주문 취소: ${errorMsg}`);
              return {
                success: false,
                reason: errorMsg,
                action,
                confidence,
                orderPrice,
                currentPrice,
                priceChangePercent: priceChangePercent.toFixed(2)
              };
            }
          } else if (Math.abs(priceChangePercent) > 1) {
            // 가격 변동률이 1% 이상이면 주문가 조정
            finalOrderPrice = currentPrice;
            console.log(`>> ${ticker} 매도 주문가 조정: ${orderPrice.toLocaleString()}원 -> ${currentPrice.toLocaleString()}원 (변동률: ${priceChangePercent.toFixed(2)}%)`);
          }
        }
      } catch (priceCheckError) {
        console.warn(`>> 가격 재확인 실패 (원래 가격 사용): ${ticker}`, priceCheckError.message);
        // 가격 재확인 실패해도 원래 가격으로 주문 진행
      }
    }

    // 6. 실제 주문 전송 (재시도 로직 포함)
    console.log(`>> 매도 주문 전송: ${ticker} ${sellQty}주 @ ${orderMethod === 'market' ? '시장가' : finalOrderPrice + '원'}`);
    
    let orderResult = null;
    let lastError = null;
    let retryCount = 0;
    
    // 재시도 로직
    while (retryCount <= maxRetries) {
      try {
        // KIS API 주문 실행 (executeOrder 사용)
        orderResult = await kisAPI.executeOrder({
          symbol: ticker,
          order_type: 'sell',
          quantity: sellQty,
          price: orderMethod === 'market' ? 0 : finalOrderPrice,
          order_method: orderMethod
        }, user);
        
        // 성공하면 루프 종료
        if (orderResult && orderResult.order_id) {
          break;
        }
      } catch (error) {
        lastError = error;
        retryCount++;
        
        // 재시도 가능한 오류인지 확인
        const errorMessage = error.message || String(error);
        const isTradingHoursError = errorMessage.includes('거래시간이 아닙니다') || 
                                    errorMessage.includes('거래시간') ||
                                    errorMessage.includes('장마감') ||
                                    errorMessage.includes('장시작');
        
        // 거래시간 외 에러는 재시도하지 않고 즉시 실패 처리
        if (isTradingHoursError) {
          console.warn(`>> ${ticker} 거래시간 외 매도 주문 실패: ${errorMessage}`);
          
          // 실시간 주문 정리: 거래시간 외 실패 시 pending 주문 정리
          try {
            const userId = user.id || user._id || user.userId;
            const isPaper = user.trading?.is_paper_trading !== false;
            const timeWindow = new Date();
            timeWindow.setMinutes(timeWindow.getMinutes() - 5); // 최근 5분 내
            
            // 최근 생성된 동일 종목, 동일 주문 타입의 pending 주문 정리
            const pendingOrders = await Trading.find({
              user_id: userId,
              is_paper_trading: isPaper,
              symbol: ticker.toUpperCase(),
              order_type: 'sell',
              status: 'pending',
              source: 'ai-trade',
              createdAt: { $gte: timeWindow }
            });
            
            if (pendingOrders.length > 0) {
              await Trading.updateMany(
                { _id: { $in: pendingOrders.map(o => o._id) } },
                { 
                  $set: { 
                    status: 'cancelled',
                    cancelled_at: new Date()
                  },
                  $push: {
                    metadata: {
                      cancellation_reason: '거래시간 외 주문 실패로 인한 자동 취소',
                      cancelled_at: new Date()
                    }
                  }
                }
              );
              console.log(`✅ [거래시간 외 실패] 실시간 주문 정리 완료: ${ticker} (${pendingOrders.length}건 취소)`);
            }
          } catch (cleanupError) {
            console.error(`❌ [거래시간 외 실패] 실시간 주문 정리 실패: ${ticker}`, cleanupError.message);
          }
          
          // 거래시간 외 실패를 명확한 failure_stage로 반환
          return {
            success: false,
            reason: errorMessage,
            action,
            confidence,
            failure_stage: 'trading_hours_check',
            details: {
              symbol: ticker,
              error_type: 'trading_hours_outside',
              error_message: errorMessage
            }
          };
        }
        
        const isRetryableError = 
          errorMessage.includes('초당 거래건수') ||
          errorMessage.includes('API 호출 제한') ||
          errorMessage.includes('네트워크') ||
          errorMessage.includes('timeout') ||
          errorMessage.includes('ECONNRESET') ||
          errorMessage.includes('ETIMEDOUT') ||
          (error.response && error.response.status >= 500);
        
        if (!isRetryableError || retryCount > maxRetries) {
          // 재시도 불가능한 오류이거나 최대 재시도 횟수 초과
          throw error;
        }
        
        console.log(`>> ${ticker} 매도 주문 재시도 (${retryCount}/${maxRetries}): ${errorMessage}`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
    
    if (!orderResult || !orderResult.order_id) {
      const finalError = lastError || new Error('매도 주문 실행 실패');
      
      // 거래시간 외 에러 체크
      const errorMessage = finalError.message || String(finalError);
      const isTradingHoursError = errorMessage.includes('거래시간이 아닙니다') || 
                                    errorMessage.includes('거래시간') ||
                                    errorMessage.includes('장마감') ||
                                    errorMessage.includes('장시작');
      
      if (isTradingHoursError) {
        console.warn(`>> ${ticker} 거래시간 외 매도 주문 실패: ${errorMessage}`);
        
        // 실시간 주문 정리
        try {
          const userId = user.id || user._id || user.userId;
          const isPaper = user.trading?.is_paper_trading !== false;
          const timeWindow = new Date();
          timeWindow.setMinutes(timeWindow.getMinutes() - 5);
          
          const pendingOrders = await Trading.find({
            user_id: userId,
            is_paper_trading: isPaper,
            symbol: ticker.toUpperCase(),
            order_type: 'sell',
            status: 'pending',
            source: 'ai-trade',
            createdAt: { $gte: timeWindow }
          });
          
          if (pendingOrders.length > 0) {
            await Trading.updateMany(
              { _id: { $in: pendingOrders.map(o => o._id) } },
              { 
                $set: { 
                  status: 'cancelled',
                  cancelled_at: new Date()
                }
              }
            );
            console.log(`✅ [거래시간 외 실패] 실시간 주문 정리 완료: ${ticker} (${pendingOrders.length}건 취소)`);
          }
        } catch (cleanupError) {
          console.error(`❌ [거래시간 외 실패] 실시간 주문 정리 실패: ${ticker}`, cleanupError.message);
        }
        
        return {
          success: false,
          reason: errorMessage,
          action,
          confidence,
          failure_stage: 'trading_hours_check',
          details: {
            symbol: ticker,
            error_type: 'trading_hours_outside',
            error_message: errorMessage
          }
        };
      }
      
      throw finalError;
    }

    // executeOrder는 성공 시 주문 정보 객체를 반환, 실패 시 에러 throw
    if (orderResult && orderResult.order_id) {
      console.log(`>> ${ticker} 매도 주문 완료. 이유: ${reasoning}`);
      
      // 7. 주문 기록 저장
      try {
        await Trading.create({
          user_id: user.id || user._id,
          is_paper_trading: isPaper,
          symbol: ticker,
          stock_name: decisionData.stock_name || decisionData.name || '',
          order_type: 'sell',
          quantity: sellQty,
          price: orderMethod === 'market' ? 0 : orderPrice, // 시장가는 체결 후 가격 확인
          order_method: orderMethod,
          status: 'pending',
          order_id: orderResult.order_id || null,
          source: 'ai-trade',
          metadata: {
            ai_confidence: confidence,
            ai_reasoning: reasoning,
            ai_target_price: targetPrice,
            ai_decision: action
          }
        });
      } catch (dbError) {
        console.error(`>> 주문 기록 저장 실패: ${ticker}`, dbError);
        // DB 저장 실패해도 주문은 성공했으므로 계속 진행
      }

      // AI 주문 실행 알림 발송
      try {
        const notificationService = require('./notification-service');
        await notificationService.sendNotification({
          userId: user.id || user._id,
          type: 'order_executed',
          title: 'AI 자동 매도 주문 체결',
          message: `${decisionData.stock_name || ticker} ${sellQty}주 매도 주문이 체결되었습니다.`,
          data: {
            symbol: ticker,
            stock_name: decisionData.stock_name || decisionData.name || '',
            order_type: 'sell',
            quantity: sellQty,
            price: orderMethod === 'market' ? 0 : orderPrice,
            order_id: orderResult.order_id,
            confidence: confidence
          }
        });
      } catch (notificationError) {
        console.warn(`>> 알림 발송 실패 (주문은 성공): ${ticker}`, notificationError.message);
      }

      return {
        success: true,
        symbol: ticker,
        quantity: sellQty,
        price: orderMethod === 'market' ? 0 : orderPrice,
        order_method: orderMethod,
        order_id: orderResult.order_id,
        order_time: orderResult.order_time,
        reasoning,
        confidence
      };
    } else {
      console.error(`>> ${ticker} 매도 주문 실패: 주문 결과가 올바르지 않습니다.`);
      return {
        success: false,
        reason: '주문 결과가 올바르지 않습니다.',
        symbol: ticker,
        action,
        confidence
      };
    }
  }

  /**
   * 여러 종목의 AI 분석 결과를 일괄 처리
   * @param {Object} user - 사용자 정보
   * @param {Array} aiResponses - AI 분석 결과 배열
   * @param {Object} options - 추가 옵션
   * @returns {Array} 주문 실행 결과 배열
   */
  async executeBatchAITrades(user, aiResponses, options = {}) {
    const results = [];
    
    for (const aiResponse of aiResponses) {
      try {
        const result = await this.executeAITrade(user, aiResponse, options);
        results.push(result);
        
        // API 호출 제한 방지를 위한 딜레이
        if (results.length < aiResponses.length) {
          await new Promise(resolve => setTimeout(resolve, 1000)); // 1초 대기
        }
      } catch (error) {
        console.error('[AI 주문 일괄 실행] 에러:', error);
        results.push({
          success: false,
          reason: error.message || '주문 실행 실패',
          error: error.message
        });
      }
    }
    
    return results;
  }
}

module.exports = new AIOrderExecutor();

