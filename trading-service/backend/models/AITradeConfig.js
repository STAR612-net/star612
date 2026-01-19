const mongoose = require('mongoose');

// AI 거래 설정 스키마
const aiTradeConfigSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  // 모의투자/실전투자 구분
  is_paper_trading: {
    type: Boolean,
    required: true,
    default: true, // 기본값: 모의투자
    index: true
  },
  // Google AI API 설정
  google_api_key: {
    type: String,
    trim: true,
    default: ''
  },
  // AI 거래 활성화 여부
  is_active: {
    type: Boolean,
    default: false
  },
  // 분석 설정
  analysis_config: {
    // 분석 기간 (일)
    analysis_period_days: {
      type: Number,
      default: 365 // 1년
    },
    // 분석 깊이 (LOW, MEDIUM, HIGH)
    analysis_depth: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH'],
      default: 'HIGH'
    },
    // 웹 검색 포함 여부
    include_web_search: {
      type: Boolean,
      default: true
    },
    // 기업 자료 포함 여부
    include_company_data: {
      type: Boolean,
      default: true
    },
    // 갱신 주기 (주 단위)
    update_frequency_weeks: {
      type: Number,
      default: 1 // 매주
    },
    // Gemini 3 Flash 사용 여부 (기본값: false, Gemini 2.5 Flash 사용)
    use_gemini_3_flash: {
      type: Boolean,
      default: false,
      description: 'Gemini 3 Flash 사용 여부. true인 경우 Gemini 3 Flash 사용, false인 경우 Gemini 2.5 Flash 사용 (기본값)'
    }
  },
  // 종목별 AI 거래 설정
  symbol_configs: [{
    symbol: {
      type: String,
      required: true,
      trim: true
    },
    stock_name: {
      type: String,
      trim: true
    },
    // AI 추천 설정
    ai_recommendation: {
      action: {
        type: String,
        enum: ['buy', 'sell', 'hold', 'none'],
        default: 'none'
      },
      confidence: {
        type: Number,
        min: 0,
        max: 100,
        default: 0
      },
      reasoning: {
        type: String,
        default: ''
      },
      target_price: {
        type: Number,
        default: 0
      },
      stop_loss_price: {
        type: Number,
        default: 0
      }
    },
    // 예약 주문 설정
    scheduled_orders: [{
      order_type: {
        type: String,
        enum: ['buy', 'sell'],
        required: true
      },
      quantity: {
        type: Number,
        required: true,
        min: 1
      },
      price: {
        type: Number,
        required: true,
        min: 0
      },
      scheduled_time: {
        type: Date,
        required: true
      },
      repeat_weekly: {
        type: Boolean,
        default: true
      }
    }],
    // 마지막 분석 시간
    last_analysis_time: {
      type: Date
    },
    // 다음 갱신 시간
    next_update_time: {
      type: Date
    }
  }],
  // 마지막 전체 분석 시간
  last_full_analysis_time: {
    type: Date
  },
  // 다음 전체 갱신 시간
  next_full_update_time: {
    type: Date
  },
  // 자동 매수 설정
  auto_buy: {
    enabled: {
      type: Boolean,
      default: true
    },
    confidence_threshold: {
      type: Number,
      default: 70,
      min: 0,
      max: 100
    },
    quantity_percent: {
      type: Number,
      default: 10,
      min: 1,
      max: 100
    },
    max_daily_purchases: {
      type: Number,
      default: 5,
      min: 1
    },
    max_holding_percent: {
      type: Number,
      default: 20,
      min: 1,
      max: 100
    },
    max_holdings_count: {
      type: Number,
      default: 20,
      min: 1
    },
    max_price_change_percent: {
      type: Number,
      default: 10,
      min: 1,
      max: 20,
      description: '가격 변동률 임계값 (기본: 10%)'
    },
    adjust_price_on_volatility: {
      type: Boolean,
      default: true,
      description: '가격 변동률 초과 시 현재가로 주문가 조정 여부 (기본: true)'
    },
    balance_limits: {
      max_balance_usage_percent: {
        type: Number,
        default: 80,
        min: 1,
        max: 100
      },
      reserved_balance: {
        type: Number,
        default: 0,
        min: 0
      },
      designated_cash_balance: {
        type: Number,
        default: 0,
        min: 0
      }
    },
    min_investment_amount: {
      type: Number,
      default: 100000, // 기본값 10만원
      min: 0,
      description: '최소 투자 금액 (기본: 100,000원). 이 금액 이상으로 투자하도록 수량이 조정됩니다.'
    }
  },
  // 자동 매도 설정
  auto_sell: {
    enabled: {
      type: Boolean,
      default: true
    },
    confidence_threshold: {
      type: Number,
      default: 70,
      min: 0,
      max: 100
    },
    quantity_percent: {
      type: Number,
      default: 50,
      min: 1,
      max: 100
    },
    max_price_change_percent: {
      type: Number,
      default: 10,
      min: 1,
      max: 20,
      description: '가격 변동률 임계값 (기본: 10%)'
    },
    adjust_price_on_volatility: {
      type: Boolean,
      default: true,
      description: '가격 변동률 초과 시 현재가로 주문가 조정 여부 (기본: true)'
    },
    // 손실 트리거(사용자 정의)
    loss_trigger: {
      enabled: {
        type: Boolean,
        default: false,
        description: '손실 트리거 사용 여부 (기본: false)'
      },
      percent_threshold: {
        type: Number,
        default: 3,
        min: 0,
        description: '손실률(%) 임계값 (예: 3 → -3% 손실시 트리거)' 
      },
      amount_threshold: {
        type: Number,
        default: 0,
        min: 0,
        description: '손실액(KRW) 임계값 (0이면 사용 안 함)' 
      },
      sell_percentage: {
        type: Number,
        default: 50,
        min: 1,
        max: 100,
        description: '트리거 발생 시 매도할 보유 비율(기본: 50%)'
      },
      order_method: {
        type: String,
        enum: ['market', 'limit'],
        default: 'market'
      },
      min_holding_days: {
        type: Number,
        default: 0,
        min: 0,
        description: '최소 보유 기간(일) 미만이면 매도 안함'
      },
      action: {
        type: String,
        enum: ['force','recommend'],
        default: 'force',
        description: "'force'는 즉시 매도 시도, 'recommend'는 알림/권고만 생성"
      },
      check_interval_minutes: {
        type: Number,
        default: 15,
        min: 1,
        description: '트리거 체크 주기(분) - 스케줄러에서 참고'
      }
    },
    // 기존 하드코딩된 10% 강제 매도 설정(하위 호환)
    force_sell_on_loss_10_percent: {
      type: Boolean,
      default: false,
      description: '손실 10% 초과 시 AI 추천과 무관하게 강제 매도 (기본: false)'
    },
    loss_10_percent_sell_quantity_percent: {
      type: Number,
      default: 100,
      min: 1,
      max: 100,
      description: '손실 10% 초과 시 강제 매도 수량 비율 (기본: 100%, 전체 매도)'
    }
  },
  // 즉시 실행 여부
  execute_immediately: {
    type: Boolean,
    default: true
  },
  // 사용자 프로필 (투자 성향 및 개인 설정)
  user_profile: {
    // 프로필 표시 여부
    profile_visible: {
      type: Boolean,
      default: true
    },
    // 투자 성향
    risk_tolerance: {
      type: String,
      enum: ['conservative', 'moderate', 'aggressive', ''],
      default: ''
    },
    // 재무 상태
    financial_status: {
      monthly_income: {
        type: Number,
        default: 0
      },
      investable_assets: {
        type: Number,
        default: 0
      },
      investment_experience_years: {
        type: Number,
        default: 0
      }
    },
    // 투자 목표
    investment_goals: {
      primary_goal: {
        type: String,
        enum: ['capital_growth', 'income', 'preservation', 'speculation', ''],
        default: ''
      },
      time_horizon: {
        type: String,
        enum: ['short_term', 'medium_term', 'long_term', ''],
        default: ''
      },
      target_return_percent: {
        type: Number,
        default: 0
      }
    },
    // 선호 설정
    preferences: {
      preferred_sectors: [{
        type: String
      }],
      excluded_sectors: [{
        type: String
      }],
      preferred_market_cap: {
        type: String,
        enum: ['large', 'mid', 'small', 'all', ''],
        default: ''
      },
      max_position_size_percent: {
        type: Number,
        default: 20
      }
    }
  },
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true,
  collection: 'ai_trade_configs'
});

// 인덱스
// user_id 단독 인덱스는 제거 (복합 인덱스로 대체)
// aiTradeConfigSchema.index({ user_id: 1 }); // 제거: 복합 인덱스로 대체
aiTradeConfigSchema.index({ user_id: 1, is_paper_trading: 1 }, { unique: true });
aiTradeConfigSchema.index({ 'symbol_configs.symbol': 1 });
aiTradeConfigSchema.index({ next_full_update_time: 1 });

const AITradeConfig = mongoose.model('AITradeConfig', aiTradeConfigSchema);

module.exports = AITradeConfig;

