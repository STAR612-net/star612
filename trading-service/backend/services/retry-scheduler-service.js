/**
 * 실패 재시도 스케줄링 서비스
 * 실패 원인별 재시도 전략 및 지수 백오프
 */

const AITradeAnalysis = require('../models/AITradeAnalysis');
const ScheduledOrder = require('../models/ScheduledOrder');
const scheduledOrderService = require('./scheduled-order-service');

class RetrySchedulerService {
  /**
   * 실패 원인별 재시도 전략 결정
   * @param {String} failureStage - 실패 단계
   * @param {Number} retryCount - 현재 재시도 횟수
   * @returns {Object} 재시도 전략 (shouldRetry, retryDelay, nextRetryTime)
   */
  getRetryStrategy(failureStage, retryCount = 0) {
    const maxRetries = 3; // 최대 재시도 횟수
    
    // 재시도 불가능한 실패 단계
    const nonRetryableStages = [
      'blocked_symbol_check',
      'confidence_check',
      'duplicate_order_check',
      'portfolio_holdings_count_check', // 포트폴리오 종목 수 초과는 재시도 불가
      'balance_check' // 잔액 부족 - 잔액 증가 없이 재시도해도 동일 결과이므로 재시도 불가
    ];
    
    if (nonRetryableStages.includes(failureStage)) {
      return {
        shouldRetry: false,
        reason: '재시도 불가능한 실패 원인'
      };
    }
    
    // 재시도 가능한 실패 단계
    // 참고: balance_check(잔액 부족)는 잔액 증가를 확인하기 어려워 재시도 불가로 변경 (2025-01-19)
    const retryableStages = [
      'price_volatility_check', // 가격 변동률 초과 - 가격 안정화 시 재시도 가능
      'portfolio_holding_percent_check' // 보유 비율 초과 - 포트폴리오 변화 시 재시도 가능
    ];
    
    if (!retryableStages.includes(failureStage) || retryCount >= maxRetries) {
      return {
        shouldRetry: false,
        reason: retryCount >= maxRetries ? '최대 재시도 횟수 초과' : '재시도 불가능한 실패 원인'
      };
    }
    
    // 지수 백오프: 1시간, 3시간, 6시간
    const backoffDelays = [60, 180, 360]; // 분 단위
    const retryDelayMinutes = backoffDelays[retryCount] || 360;
    
    // 다음 재시도 시간 계산
    const nextRetryTime = new Date();
    nextRetryTime.setMinutes(nextRetryTime.getMinutes() + retryDelayMinutes);
    
    return {
      shouldRetry: true,
      retryDelay: retryDelayMinutes,
      nextRetryTime: nextRetryTime,
      retryCount: retryCount + 1
    };
  }
  
  /**
   * 실패한 분석에 대한 재시도 예약 주문 생성
   * @param {Object} user - 사용자 정보
   * @param {Object} analysis - 실패한 분석 결과
   * @param {Object} tradeConfig - 거래 설정
   * @param {Object} retryStrategy - 재시도 전략
   * @returns {Object} 예약 주문 정보
   */
  async scheduleRetry(user, analysis, tradeConfig, retryStrategy) {
    try {
      const userId = user.id || user._id || user.userId;
      const isPaper = user.trading?.is_paper_trading !== false;
      
      // 기존 재시도 예약 주문 삭제 (중복 방지)
      await ScheduledOrder.deleteMany({
        user_id: userId,
        is_paper_trading: isPaper,
        symbol: analysis.symbol.toUpperCase(),
        order_type: tradeConfig.order_type,
        status: 'pending',
        'metadata.ai_retry': true,
        'metadata.analysis_id': analysis._id.toString()
      });
      
      // 재시도 예약 주문 생성
      const scheduledOrder = await scheduledOrderService.createScheduledOrder(user, {
        symbol: analysis.symbol,
        stock_name: analysis.stock_name || analysis.symbol,
        order_type: tradeConfig.order_type,
        quantity: tradeConfig.quantity,
        price: tradeConfig.price,
        order_method: tradeConfig.order_method || 'limit',
        scheduled_time: retryStrategy.nextRetryTime,
        metadata: {
          ai_trade: true,
          ai_retry: true,
          ai_analysis_id: analysis._id.toString(),
          retry_count: retryStrategy.retryCount,
          failure_stage: analysis.execution_result?.failure_stage,
          failed_reason: analysis.execution_result?.error_message,
          original_execution_time: analysis.execution_result?.executed_at || analysis.createdAt
        }
      });
      
      // 분석 결과에 재시도 정보 업데이트
      analysis.execution_result = analysis.execution_result || {};
      analysis.execution_result.retry_scheduled = true;
      analysis.execution_result.retry_count = retryStrategy.retryCount;
      analysis.execution_result.next_retry_time = retryStrategy.nextRetryTime;
      await analysis.save();
      
      console.log(`✅ [재시도 스케줄링] 재시도 예약 주문 생성: ${analysis.symbol}`, {
        scheduled_order_id: scheduledOrder._id,
        next_retry_time: retryStrategy.nextRetryTime.toLocaleString('ko-KR'),
        retry_count: retryStrategy.retryCount,
        failure_stage: analysis.execution_result?.failure_stage
      });
      
      return scheduledOrder;
    } catch (error) {
      console.error('[재시도 스케줄링] 재시도 예약 주문 생성 실패:', error);
      throw error;
    }
  }
  
  /**
   * 실패한 분석 결과에 대한 자동 재시도 스케줄링
   * @param {Object} user - 사용자 정보
   * @param {Object} analysis - 실패한 분석 결과
   * @param {Object} tradeConfig - 거래 설정
   * @returns {Boolean} 재시도 스케줄링 성공 여부
   */
  async autoScheduleRetry(user, analysis, tradeConfig) {
    try {
      const failureStage = analysis.execution_result?.failure_stage || 'unknown';
      const retryCount = analysis.execution_result?.retry_count || 0;
      
      const retryStrategy = this.getRetryStrategy(failureStage, retryCount);
      
      if (!retryStrategy.shouldRetry) {
        console.log(`⏭️  [재시도 스케줄링] 재시도 스킵: ${analysis.symbol}`, {
          reason: retryStrategy.reason,
          failure_stage: failureStage,
          retry_count: retryCount
        });
        return false;
      }
      
      await this.scheduleRetry(user, analysis, tradeConfig, retryStrategy);
      return true;
    } catch (error) {
      console.error('[재시도 스케줄링] 자동 재시도 스케줄링 실패:', error);
      return false;
    }
  }
}

module.exports = new RetrySchedulerService();

