const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bodyParser = require('body-parser');
const rateLimit = require('express-rate-limit');
const { connectDB } = require('./config/mongodb');
require('dotenv').config();

// 환경 변수 로드 확인 (디버깅용)
console.log('🔍 환경 변수 로드 확인:', {
  hasGoogleAIKey: !!process.env.GOOGLE_AI_API_KEY,
  googleAIKeyLength: process.env.GOOGLE_AI_API_KEY ? process.env.GOOGLE_AI_API_KEY.length : 0,
  tradingPort: process.env.TRADING_PORT || '5001',
  nodeEnv: process.env.NODE_ENV || 'development'
});

const app = express();
const PORT = process.env.TRADING_PORT || 5001;

// Rate Limiting 설정
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15분
  max: 300, // 최대 300 요청 (프론트엔드 자동 갱신 대응)
  message: { error: 'Too many requests from this IP, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  // Nginx 프록시를 통한 요청 처리
  validate: {
    xForwardedForHeader: false // X-Forwarded-For 헤더 검증 비활성화 (프록시 환경)
  },
  // 429 에러 시 Retry-After 헤더 설정
  skip: (req) => {
    // Health check는 rate limit 제외
    if (req.path === '/api/health' || req.path === '/health') {
      return true;
    }
    // 사용자 정보 조회는 더 관대한 제한 적용 (중복 요청 방지용)
    if (req.path === '/api/user/me' || req.path === '/user/me') {
      return false; // apiLimiter 적용하되, 별도 limiter로 완화
    }
    return false;
  }
});

// 사용자 정보 조회용 완화된 Rate Limiting (중복 요청 방지)
const userInfoLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1분
  max: 30, // 1분에 최대 30 요청 (여러 컴포넌트에서 동시 조회 대응)
  message: { error: 'Too many user info requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: {
    xForwardedForHeader: false
  }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15분
  max: 5, // 로그인/회원가입 시도는 더 제한적
  message: { error: 'Too many authentication attempts, please try again later.' },
  skipSuccessfulRequests: true, // 성공한 요청은 카운트에서 제외
  standardHeaders: true,
  legacyHeaders: false,
  // Nginx 프록시를 통한 요청 처리
  validate: {
    xForwardedForHeader: false // X-Forwarded-For 헤더 검증 비활성화 (프록시 환경)
  }
});

// MongoDB 연결 (재시도 로직 포함)
let mongoRetryCount = 0;
const maxMongoRetries = 5;
const mongoRetryDelay = 5000; // 5초

async function connectDBWithRetry() {
  try {
    await connectDB();
    console.log('✅ MongoDB 연결 성공');
    mongoRetryCount = 0; // 성공 시 카운터 리셋
  } catch (error) {
    mongoRetryCount++;
    console.error(`❌ MongoDB 연결 실패 (${mongoRetryCount}/${maxMongoRetries}):`, error.message);
    
    if (mongoRetryCount < maxMongoRetries) {
      console.log(`⏳ ${mongoRetryDelay / 1000}초 후 재시도...`);
      await new Promise(resolve => setTimeout(resolve, mongoRetryDelay));
      return connectDBWithRetry();
    } else {
      console.error('❌ MongoDB 연결 최종 실패: 최대 재시도 횟수 초과');
      console.error('💡 해결 방법:');
      console.error('   1. MongoDB 서비스 시작: sudo systemctl start mongod');
      console.error('   2. MongoDB URI 확인: .env 파일의 MONGODB_URI 확인');
      console.error('   3. MongoDB 로그 확인: sudo journalctl -u mongod -n 50');
      process.exit(1);
    }
  }
}

connectDBWithRetry();

// 미들웨어
app.use(helmet({
  contentSecurityPolicy: false // API 서버이므로 CSP는 프론트엔드에서 처리
}));

app.use(cors({
  origin: [
    'https://star612.net',
    'http://localhost:3000',
    'http://localhost:5000'
  ],
  credentials: true
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Rate Limiting 적용
app.use('/api/', apiLimiter);

// 사용자 정보 조회 엔드포인트에 완화된 rate limiting 적용
app.use('/api/user/me', userInfoLimiter);

// Health check 핸들러 함수 (공통)
const healthCheckHandler = async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 
                     mongoose.connection.readyState === 2 ? 'connecting' :
                     mongoose.connection.readyState === 3 ? 'disconnecting' : 'disconnected';
    
    const response = {
      status: dbStatus === 'connected' ? 'ok' : 'degraded',
      service: 'trading-service',
      database: {
        status: dbStatus,
        readyState: mongoose.connection.readyState
      },
      timestamp: new Date().toISOString()
    };
    
    res.json(response);
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({
      status: 'error',
      service: 'trading-service',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

// Health check 엔드포인트 (다른 라우터보다 먼저 등록하여 라우팅 충돌 방지)
app.get('/health', healthCheckHandler);
app.get('/api/health', healthCheckHandler);

// 로깅 미들웨어
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// 라우트
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const tradingRoutes = require('./routes/trading');
const portfolioRoutes = require('./routes/portfolio');
const aiRoutes = require('./routes/ai-analysis');
const aiTradeRoutes = require('./routes/ai-trade');
const notificationRoutes = require('./routes/notification');
const statisticsRoutes = require('./routes/statistics');
const watchlistRoutes = require('./routes/watchlist');
const userFavoriteStocksRoutes = require('./routes/user-favorite-stocks');

// 공개 라우트 (인증 불필요) - Rate Limiting 적용
app.use('/api/auth', authLimiter);
app.use('/api/auth', authRoutes);

// 보호된 라우트 (인증 필요)
app.use('/api/user', userRoutes);
app.use('/api/trading', tradingRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/ai-trade', aiTradeRoutes);
app.use('/api/notification', notificationRoutes);
app.use('/api/statistics', statisticsRoutes);
app.use('/api/watchlist', watchlistRoutes);
app.use('/api/user-favorite-stocks', userFavoriteStocksRoutes);

// 에러 핸들러
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 핸들러
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// 자동거래 스케줄러 설정
const autoTradeService = require('./services/auto-trade-service');
const User = require('./models/User');

// 한국 공휴일 목록 (2024-2025년)
const KOREAN_HOLIDAYS_2024 = [
  '2024-01-01', '2024-03-01', '2024-05-05', '2024-05-06',
  '2024-06-06', '2024-08-15', '2024-09-16', '2024-09-17', '2024-09-18',
  '2024-10-03', '2024-10-09', '2024-12-25', '2024-12-31'
];

const KOREAN_HOLIDAYS_2025 = [
  '2025-01-01', '2025-01-28', '2025-01-29', '2025-01-30',
  '2025-03-01', '2025-05-05', '2025-05-06', '2025-06-06',
  '2025-08-15', '2025-10-03', '2025-10-06', '2025-10-07', '2025-10-08',
  '2025-10-09', '2025-12-25'
];

// 공휴일 체크 함수
function isHoliday(date = new Date()) {
  const koreaTime = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const year = koreaTime.getFullYear();
  const month = String(koreaTime.getMonth() + 1).padStart(2, '0');
  const day = String(koreaTime.getDate()).padStart(2, '0');
  const dateStr = `${year}-${month}-${day}`;
  
  const holidays = year === 2024 ? KOREAN_HOLIDAYS_2024 : 
                   year === 2025 ? KOREAN_HOLIDAYS_2025 : [];
  
  return holidays.includes(dateStr);
}

// 거래시간 체크 함수
function isTradingHours() {
  const now = new Date();
  const koreaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const day = koreaTime.getDay(); // 0: 일요일, 6: 토요일
  const hour = koreaTime.getHours();
  const minutes = koreaTime.getMinutes();
  
  // 평일(월~금) 9:00~15:30
  const isWeekday = day >= 1 && day <= 5;
  const isTradingTime = hour >= 9 && (hour < 15 || (hour === 15 && minutes <= 30));
  
  return isWeekday && isTradingTime;
}

// 개장 여부 확인 (거래시간 + 평일 + 공휴일 아님)
function isMarketOpen() {
  const now = new Date();
  const koreaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const day = koreaTime.getDay();
  const isWeekday = day >= 1 && day <= 5;
  const isHolidayDay = isHoliday(now);
  const isTradingTime = isTradingHours();
  
  return isWeekday && !isHolidayDay && isTradingTime;
}

// 거래 시작 30분 전 체크 함수 (8:30)
function isBeforeTradingStart() {
  const now = new Date();
  const koreaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const day = koreaTime.getDay();
  const hour = koreaTime.getHours();
  const minutes = koreaTime.getMinutes();
  
  const isWeekday = day >= 1 && day <= 5;
  // 8:30 ~ 8:59 사이
  const isBeforeStart = isWeekday && hour === 8 && minutes >= 30;
  
  return isBeforeStart;
}

// 거래 종료 후 체크 함수 (15:30 이후)
function isAfterTradingClose() {
  const now = new Date();
  const koreaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const day = koreaTime.getDay();
  const hour = koreaTime.getHours();
  const minutes = koreaTime.getMinutes();
  
  const isWeekday = day >= 1 && day <= 5;
  // 15:30 이후 또는 주말/공휴일
  const isAfterClose = !isWeekday || hour > 15 || (hour === 15 && minutes > 30);
  
  return isAfterClose;
}

// 다음 거래일 거래 시작 30분 전 시간 계산
function getNextTradingDayPreStartTime() {
  const now = new Date();
  const koreaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const day = koreaTime.getDay();
  const hour = koreaTime.getHours();
  const minutes = koreaTime.getMinutes();
  
  const targetTime = new Date(koreaTime);
  
  // 오늘이 평일이고 8:30 이전이면 오늘 8:30
  if (day >= 1 && day <= 5 && (hour < 8 || (hour === 8 && minutes < 30))) {
    targetTime.setHours(8, 30, 0, 0);
    return targetTime;
  }
  
  // 다음 평일 8:30 계산
  let daysToAdd = 1;
  if (day === 5) { // 금요일이면 월요일까지
    daysToAdd = 3;
  } else if (day === 6) { // 토요일이면 월요일까지
    daysToAdd = 2;
  } else if (day === 0) { // 일요일이면 월요일까지
    daysToAdd = 1;
  }
  
  targetTime.setDate(targetTime.getDate() + daysToAdd);
  targetTime.setHours(8, 30, 0, 0);
  
  return targetTime;
}

// 다음 거래일 거래 종료 후 시간 계산 (15:31)
function getNextTradingDayPostCloseTime() {
  const now = new Date();
  const koreaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const day = koreaTime.getDay();
  const hour = koreaTime.getHours();
  const minutes = koreaTime.getMinutes();
  
  const targetTime = new Date(koreaTime);
  
  // 오늘이 평일이고 15:30 이후이지만 15:31 이전이면 오늘 15:31
  // 이미 15:31이 지났으면 다음 거래일로 계산
  if (day >= 1 && day <= 5) {
    if (hour === 15 && minutes >= 30 && minutes < 31) {
      // 15:30 ~ 15:31 사이
      targetTime.setHours(15, 31, 0, 0);
      return targetTime;
    } else if (hour < 15 || (hour === 15 && minutes < 30)) {
      // 15:30 이전
      targetTime.setHours(15, 31, 0, 0);
      return targetTime;
    }
    // 15:31 이후이면 다음 거래일로 계산 (아래 로직 계속)
  }
  
  // 다음 평일 15:31 계산
  let daysToAdd = 1;
  if (day === 5) { // 금요일이면 월요일까지
    daysToAdd = 3;
  } else if (day === 6) { // 토요일이면 월요일까지
    daysToAdd = 2;
  } else if (day === 0) { // 일요일이면 월요일까지
    daysToAdd = 1;
  } else if (day >= 1 && day <= 5) {
    // 평일이지만 15:31 이후이면 다음 거래일
    daysToAdd = 1;
  }
  
  targetTime.setDate(targetTime.getDate() + daysToAdd);
  targetTime.setHours(15, 31, 0, 0);
  
  return targetTime;
}

// 자동거래 실행 함수 (API 호출 제한 방지)
let isRunningAutoTrade = false;
let lastAutoTradeTime = 0;

async function runAutoTrades() {
  // 이미 실행 중이면 스킵
  if (isRunningAutoTrade) {
    return;
  }
  
  // 최근 15분 이내 실행했으면 스킵 (API 호출 제한 방지 및 CPU 부하 감소)
  const now = Date.now();
  if (now - lastAutoTradeTime < 15 * 60 * 1000) {
    return;
  }
  
  // 개장 여부 확인 (거래시간 + 평일 + 공휴일 아님)
  if (!isMarketOpen()) {
    const now = new Date();
    const koreaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const day = koreaTime.getDay();
    const dayNames = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
    const isWeekday = day >= 1 && day <= 5;
    const isHolidayDay = isHoliday(now);
    
    if (!isWeekday) {
      console.log(`[AI 분석 스케줄러] 주말이므로 실행하지 않음 (${dayNames[day]})`);
    } else if (isHolidayDay) {
      console.log(`[AI 분석 스케줄러] 공휴일이므로 실행하지 않음`);
    } else {
      console.log(`[AI 분석 스케줄러] 거래시간이 아니므로 실행하지 않음`);
    }
    return; // 개장 시간이 아니면 실행하지 않음
  }
  
  isRunningAutoTrade = true;
  lastAutoTradeTime = now;
  
  try {
    // 자동거래가 활성화된 모든 사용자 조회
    const users = await User.find({ 
      'trading.is_paper_trading': { $exists: true },
      'trading.paper_app_key': { $exists: true, $ne: '' }
    });
    
    if (users.length === 0) {
      isRunningAutoTrade = false;
      return;
    }
    
    console.log(`[자동거래] ${users.length}명의 사용자 자동거래 체크 시작`);
    
    // 사용자별로 순차 실행 (API 호출 제한 방지)
    for (const user of users) {
      try {
        // 각 사용자 간 2초 대기 (API 호출 제한 방지)
        if (users.indexOf(user) > 0) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
        const result = await autoTradeService.executeAutoTrades(user);
        if (result.executed > 0) {
          console.log(`[자동거래] 사용자 ${user.email}: ${result.executed}건 실행, ${result.skipped}건 건너뜀`);
        }
      } catch (error) {
        console.error(`[자동거래] 사용자 ${user.email} 자동거래 실행 실패:`, error.message);
        // API 호출 제한 에러인 경우 더 긴 대기
        if (error.message?.includes('호출 제한') || error.message?.includes('초당 거래건수')) {
          console.log('[자동거래] API 호출 제한 감지, 30초 대기');
          await new Promise(resolve => setTimeout(resolve, 30000));
        }
      }
    }
  } catch (error) {
    console.error('[자동거래] 자동거래 실행 중 오류:', error);
  } finally {
    isRunningAutoTrade = false;
  }
}

// 자동거래 스케줄러 시작 (10분마다 실행, API 호출 제한 방지)
let autoTradeInterval;
if (process.env.ENABLE_AUTO_TRADE !== 'false') {
  // 서버 시작 후 5분 후 첫 실행, 이후 15분마다 실행 (CPU 부하 감소)
  setTimeout(() => {
    runAutoTrades();
    autoTradeInterval = setInterval(runAutoTrades, 15 * 60 * 1000); // 15분 (CPU 부하 감소를 위해 10분 → 15분으로 증가)
    console.log('✅ 자동거래 스케줄러 시작 (15분 간격, API 호출 제한 방지)');
  }, 5 * 60 * 1000); // 5분 (CPU 부하 감소를 위해 2분 → 5분으로 증가)
}

// 예약 주문 스케줄러 시작 (1분마다 실행)
const scheduledOrderService = require('./services/scheduled-order-service');
const aiTradeService = require('./services/ai-trade-service');
// User는 이미 133번째 줄에서 선언됨
setInterval(async () => {
  try {
    await scheduledOrderService.executeScheduledOrders();
  } catch (error) {
    console.error('[스케줄러] 예약 주문 실행 오류:', error);
  }
}, 60 * 1000); // 1분
console.log('✅ 예약 주문 스케줄러 시작 (1분 간격)');

// 오래된 예약 주문 정리 (거래 외 시간 주문 포함)
const cleanupScheduledOrders = async () => {
  try {
    const result = await scheduledOrderService.cleanupOldScheduledOrders(30); // 30일 이상 경과된 주문 삭제
    if (result.deletedCount > 0 || result.cancelledCount > 0) {
      console.log(`✅ [예약주문 정리] 완료: 삭제 ${result.deletedCount}건, 취소 ${result.cancelledCount}건`);
    }
  } catch (error) {
    console.error('[스케줄러] 예약 주문 정리 오류:', error);
  }
};

// 매일 자정 실행 + 주문 상태 업데이트 스케줄러에서도 함께 실행
const scheduleCleanup = () => {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  
  const msUntilMidnight = tomorrow.getTime() - now.getTime();
  
  setTimeout(() => {
    cleanupScheduledOrders();
    // 이후 매일 실행
    setInterval(cleanupScheduledOrders, 24 * 60 * 60 * 1000);
  }, msUntilMidnight);
  
  console.log('✅ 예약 주문 정리 스케줄러 시작 (매일 자정)');
};

scheduleCleanup();

// 주문 상태 업데이트 스케줄러에서도 예약 주문 정리 실행 (6시간마다)
setInterval(async () => {
  try {
    await cleanupScheduledOrders();
  } catch (error) {
    console.error('[스케줄러] 예약 주문 정리 오류:', error);
  }
}, 6 * 60 * 60 * 1000); // 6시간마다

// 주문 상태 자동 업데이트 스케줄러 (5분마다 실행)
const Trading = require('./models/Trading');
const Portfolio = require('./models/Portfolio');
const kisAPI = require('./services/kis-api');

async function updatePendingOrderStatus() {
  try {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    // 한국은행 정책발표 같은 특수 상황 감지 (예: 긴급 상황, 시장 변동성 증가)
    // TODO: 외부 API나 뉴스 피드를 통해 특수 상황 감지
    const isSpecialSituation = false; // 향후 구현 예정
    
    // 최근 7일 내 pending 상태인 주문 조회
    const pendingOrders = await Trading.find({
      status: 'pending',
      order_id: { $exists: true, $ne: null },
      createdAt: { $gte: sevenDaysAgo }
    }).populate('user_id').sort({ createdAt: 1 }); // 오래된 주문부터 처리

    if (pendingOrders.length === 0) {
      return;
    }

    console.log(`[주문 상태 업데이트] 스케줄러 실행: ${pendingOrders.length}건 확인`);
    
    if (pendingOrders.length === 0) {
      console.log(`[주문 상태 업데이트] 업데이트할 주문 없음`);
      return;
    }

    let updatedCount = 0;
    let cancelledCount = 0;
    let errorCount = 0;

    for (const order of pendingOrders) {
      try {
        const user = order.user_id;
        if (!user) {
          continue;
        }

        const isPaper = user.trading?.is_paper_trading !== false;
        const orderAge = Date.now() - new Date(order.createdAt).getTime();
        const hoursSinceOrder = orderAge / (1000 * 60 * 60);

        // 주문 만료 시간 확인 및 자동 취소
        if (order.metadata && order.metadata.expiry_time) {
          const expiryTime = new Date(order.metadata.expiry_time);
          if (new Date() > expiryTime) {
            await Trading.findByIdAndUpdate(order._id, {
              status: 'cancelled',
              cancelled_at: new Date(),
              $set: {
                'metadata.cancellation_reason': '주문 만료 시간 초과로 인한 자동 취소',
                'metadata.cancelled_at': new Date()
              }
            });
            cancelledCount++;
            console.log(`⏰ [주문 만료] ${order.symbol}: 만료 시간 초과로 취소 (만료 시간: ${expiryTime.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })})`);
            
            // 만료 알림 발송
            try {
              const notificationService = require('./services/notification-service');
              const userId = user.id || user._id;
              await notificationService.sendNotification({
                userId: userId,
                type: 'order_failed',
                title: '주문 만료',
                message: `${order.symbol} ${order.order_type === 'buy' ? '매수' : '매도'} 주문이 만료 시간을 초과하여 자동 취소되었습니다.`,
                data: {
                  symbol: order.symbol,
                  order_type: order.order_type,
                  expiry_time: expiryTime,
                  action: '만료로 인한 취소'
                }
              });
            } catch (notificationError) {
              console.warn(`⚠️ [주문 만료] 알림 발송 실패: ${order.symbol}`, notificationError.message);
            }
            
            continue;
          }
        }

        // 실시간 가격 모니터링 및 주문가 자동 조정 (지정가 주문인 경우)
        if (order.order_method === 'limit' && order.status === 'pending') {
          try {
            const stockPrice = await kisAPI.getStockPrice(order.symbol, user);
            if (stockPrice && stockPrice.price && stockPrice.price > 0) {
              const currentPrice = stockPrice.price;
              const priceChangePercent = ((currentPrice - order.price) / order.price * 100);
              
              // 사용자 설정 조회
              const AITradeConfig = require('./models/AITradeConfig');
              const userId = user.id || user._id;
              let maxPriceChangePercent = 10; // 기본값
              let adjustPrice = true; // 기본값
              
              if (userId) {
                try {
                  const aiConfig = await AITradeConfig.findOne({ 
                    user_id: userId,
                    is_paper_trading: isPaper 
                  });
                  
                  if (order.order_type === 'buy' && aiConfig?.auto_buy) {
                    maxPriceChangePercent = aiConfig.auto_buy.max_price_change_percent || 10;
                    adjustPrice = aiConfig.auto_buy.adjust_price_on_volatility !== false;
                  } else if (order.order_type === 'sell' && aiConfig?.auto_sell) {
                    maxPriceChangePercent = aiConfig.auto_sell.max_price_change_percent || 10;
                    adjustPrice = aiConfig.auto_sell.adjust_price_on_volatility !== false;
                  }
                } catch (configError) {
                  console.warn(`[주문가 조정] 설정 조회 실패 (기본값 사용): ${order.symbol}`, configError.message);
                }
              }
              
              // 매수 주문: 주문가가 현재가보다 높으면 조정 필요
              if (order.order_type === 'buy' && order.price > currentPrice) {
                const priceDiffPercent = ((order.price - currentPrice) / order.price * 100);
                
                // 가격 변동률이 20% 이상이면 시장가 주문으로 전환
                if (Math.abs(priceChangePercent) >= 20) {
                  const originalPrice = order.price;
                  
                  // metadata 가져오기 및 업데이트
                  let existingMetadata = order.metadata || new Map();
                  if (!(existingMetadata instanceof Map)) {
                    const metadataMap = new Map();
                    if (typeof existingMetadata === 'object' && existingMetadata !== null) {
                      Object.entries(existingMetadata).forEach(([key, value]) => {
                        metadataMap.set(key, value);
                      });
                    }
                    existingMetadata = metadataMap;
                  }
                  
                  existingMetadata.set('converted_to_market', true);
                  existingMetadata.set('conversion_reason', `가격 변동률(${priceChangePercent.toFixed(2)}%)이 매우 커서 시장가 주문으로 전환`);
                  existingMetadata.set('converted_at', new Date());
                  existingMetadata.set('original_limit_price', originalPrice);
                  
                  await Trading.findByIdAndUpdate(order._id, {
                    $set: { 
                      order_method: 'market',
                      price: currentPrice,
                      metadata: existingMetadata
                    }
                  });
                  
                  console.log(`🔄 [시장가 전환] ${order.symbol} (매수): 지정가 → 시장가 (변동률: ${priceChangePercent.toFixed(2)}%, 원래가격: ${originalPrice.toLocaleString()}원, 현재가: ${currentPrice.toLocaleString()}원)`);
                  
                  // 시장가 전환 알림 발송
                  try {
                    const notificationService = require('./services/notification-service');
                    await notificationService.sendNotification({
                      userId: userId,
                      type: 'order_executed',
                      title: '주문 시장가 전환',
                      message: `${order.symbol} 매수 주문이 가격 변동률(${priceChangePercent.toFixed(2)}%)이 커서 시장가 주문으로 전환되었습니다. (원래가격: ${originalPrice.toLocaleString()}원 → 현재가: ${currentPrice.toLocaleString()}원)`,
                      data: {
                        symbol: order.symbol,
                        order_type: 'buy',
                        original_price: originalPrice,
                        current_price: currentPrice,
                        price_change_percent: priceChangePercent.toFixed(2),
                        action: '시장가 전환'
                      }
                    });
                  } catch (notificationError) {
                    console.warn(`⚠️ [시장가 전환] 알림 발송 실패: ${order.symbol}`, notificationError.message);
                  }
                  
                  updatedCount++;
                  continue;
                }
                
                if (Math.abs(priceChangePercent) > maxPriceChangePercent) {
                  if (adjustPrice) {
                    // 현재가로 주문가 조정
                    const originalPrice = order.price;
                    
                    // metadata 가져오기 및 업데이트
                    let existingMetadata = order.metadata || new Map();
                    if (!(existingMetadata instanceof Map)) {
                      const metadataMap = new Map();
                      if (typeof existingMetadata === 'object' && existingMetadata !== null) {
                        Object.entries(existingMetadata).forEach(([key, value]) => {
                          metadataMap.set(key, value);
                        });
                      }
                      existingMetadata = metadataMap;
                    }
                    
                    // price_adjustments 배열 가져오기
                    let priceAdjustments = existingMetadata.get('price_adjustments') || [];
                    if (!Array.isArray(priceAdjustments)) {
                      priceAdjustments = [];
                    }
                    
                    // 새로운 조정 기록 추가
                    priceAdjustments.push({
                      original_price: originalPrice,
                      adjusted_price: currentPrice,
                      price_change_percent: priceChangePercent.toFixed(2),
                      adjusted_at: new Date()
                    });
                    existingMetadata.set('price_adjustments', priceAdjustments);
                    existingMetadata.set('last_price_adjustment', new Date());
                    
                    await Trading.findByIdAndUpdate(order._id, {
                      $set: { 
                        price: currentPrice,
                        metadata: existingMetadata
                      }
                    });
                    console.log(`📊 [주문가 조정] ${order.symbol} (매수): ${originalPrice.toLocaleString()}원 → ${currentPrice.toLocaleString()}원 (변동률: ${priceChangePercent.toFixed(2)}%, 임계값: ±${maxPriceChangePercent}%)`);
                    
                    // 가격 조정 알림 발송
                    try {
                      const notificationService = require('./services/notification-service');
                      await notificationService.sendNotification({
                        userId: userId,
                        type: 'order_executed',
                        title: '주문가 자동 조정',
                        message: `${order.symbol} 매수 주문가가 ${originalPrice.toLocaleString()}원에서 ${currentPrice.toLocaleString()}원으로 조정되었습니다. (변동률: ${priceChangePercent.toFixed(2)}%)`,
                        data: {
                          symbol: order.symbol,
                          order_type: 'buy',
                          original_price: originalPrice,
                          adjusted_price: currentPrice,
                          price_change_percent: priceChangePercent.toFixed(2),
                          action: '가격 조정됨'
                        }
                      });
                    } catch (notificationError) {
                      console.warn(`⚠️ [주문가 조정] 알림 발송 실패: ${order.symbol}`, notificationError.message);
                    }
                    
                    updatedCount++;
                    continue; // 가격 조정 후 다음 주문으로
                  } else {
                    // 가격 조정 비활성화 시 주문 취소
                    await Trading.findByIdAndUpdate(order._id, {
                      status: 'cancelled',
                      cancelled_at: new Date(),
                      $set: {
                        'metadata.cancellation_reason': `가격 변동률(${priceChangePercent.toFixed(2)}%)이 임계값(±${maxPriceChangePercent}%)을 초과하여 취소됨`,
                        'metadata.cancelled_at': new Date()
                      }
                    });
                    cancelledCount++;
                    console.log(`❌ [주문 취소] ${order.symbol} (매수): 가격 변동률 초과 (${priceChangePercent.toFixed(2)}%, 임계값: ±${maxPriceChangePercent}%)`);
                    continue;
                  }
                } else if (priceDiffPercent > 1) {
                  // 가격 차이가 1% 이상이면 자동 조정
                  const originalPrice = order.price;
                  
                  // metadata 가져오기 및 업데이트
                  let existingMetadata = order.metadata || new Map();
                  if (!(existingMetadata instanceof Map)) {
                    const metadataMap = new Map();
                    if (typeof existingMetadata === 'object' && existingMetadata !== null) {
                      Object.entries(existingMetadata).forEach(([key, value]) => {
                        metadataMap.set(key, value);
                      });
                    }
                    existingMetadata = metadataMap;
                  }
                  
                  let priceAdjustments = existingMetadata.get('price_adjustments') || [];
                  if (!Array.isArray(priceAdjustments)) {
                    priceAdjustments = [];
                  }
                  
                  priceAdjustments.push({
                    original_price: originalPrice,
                    adjusted_price: currentPrice,
                    price_change_percent: priceChangePercent.toFixed(2),
                    adjusted_at: new Date()
                  });
                  existingMetadata.set('price_adjustments', priceAdjustments);
                  existingMetadata.set('last_price_adjustment', new Date());
                  
                  await Trading.findByIdAndUpdate(order._id, {
                    $set: { 
                      price: currentPrice,
                      metadata: existingMetadata
                    }
                  });
                  console.log(`📊 [주문가 자동 조정] ${order.symbol} (매수): ${originalPrice.toLocaleString()}원 → ${currentPrice.toLocaleString()}원 (차이: ${priceDiffPercent.toFixed(2)}%)`);
                  updatedCount++;
                  continue;
                }
              }
              
              // 매도 주문: 주문가가 현재가보다 낮으면 조정 필요
              if (order.order_type === 'sell' && order.price < currentPrice) {
                const priceDiffPercent = ((currentPrice - order.price) / order.price * 100);
                
                // 가격 변동률이 20% 이상이면 시장가 주문으로 전환
                if (Math.abs(priceChangePercent) >= 20) {
                  const originalPrice = order.price;
                  
                  // metadata 가져오기 및 업데이트
                  let existingMetadata = order.metadata || new Map();
                  if (!(existingMetadata instanceof Map)) {
                    const metadataMap = new Map();
                    if (typeof existingMetadata === 'object' && existingMetadata !== null) {
                      Object.entries(existingMetadata).forEach(([key, value]) => {
                        metadataMap.set(key, value);
                      });
                    }
                    existingMetadata = metadataMap;
                  }
                  
                  existingMetadata.set('converted_to_market', true);
                  existingMetadata.set('conversion_reason', `가격 변동률(${priceChangePercent.toFixed(2)}%)이 매우 커서 시장가 주문으로 전환`);
                  existingMetadata.set('converted_at', new Date());
                  existingMetadata.set('original_limit_price', originalPrice);
                  
                  await Trading.findByIdAndUpdate(order._id, {
                    $set: { 
                      order_method: 'market',
                      price: currentPrice,
                      metadata: existingMetadata
                    }
                  });
                  
                  console.log(`🔄 [시장가 전환] ${order.symbol} (매도): 지정가 → 시장가 (변동률: ${priceChangePercent.toFixed(2)}%, 원래가격: ${originalPrice.toLocaleString()}원, 현재가: ${currentPrice.toLocaleString()}원)`);
                  
                  // 시장가 전환 알림 발송
                  try {
                    const notificationService = require('./services/notification-service');
                    await notificationService.sendNotification({
                      userId: userId,
                      type: 'order_executed',
                      title: '주문 시장가 전환',
                      message: `${order.symbol} 매도 주문이 가격 변동률(${priceChangePercent.toFixed(2)}%)이 커서 시장가 주문으로 전환되었습니다. (원래가격: ${originalPrice.toLocaleString()}원 → 현재가: ${currentPrice.toLocaleString()}원)`,
                      data: {
                        symbol: order.symbol,
                        order_type: 'sell',
                        original_price: originalPrice,
                        current_price: currentPrice,
                        price_change_percent: priceChangePercent.toFixed(2),
                        action: '시장가 전환'
                      }
                    });
                  } catch (notificationError) {
                    console.warn(`⚠️ [시장가 전환] 알림 발송 실패: ${order.symbol}`, notificationError.message);
                  }
                  
                  updatedCount++;
                  continue;
                }
                
                if (Math.abs(priceChangePercent) > maxPriceChangePercent) {
                  if (adjustPrice) {
                    const originalPrice = order.price;
                    
                    // metadata 가져오기 및 업데이트
                    let existingMetadata = order.metadata || new Map();
                    if (!(existingMetadata instanceof Map)) {
                      const metadataMap = new Map();
                      if (typeof existingMetadata === 'object' && existingMetadata !== null) {
                        Object.entries(existingMetadata).forEach(([key, value]) => {
                          metadataMap.set(key, value);
                        });
                      }
                      existingMetadata = metadataMap;
                    }
                    
                    let priceAdjustments = existingMetadata.get('price_adjustments') || [];
                    if (!Array.isArray(priceAdjustments)) {
                      priceAdjustments = [];
                    }
                    
                    priceAdjustments.push({
                      original_price: originalPrice,
                      adjusted_price: currentPrice,
                      price_change_percent: priceChangePercent.toFixed(2),
                      adjusted_at: new Date()
                    });
                    existingMetadata.set('price_adjustments', priceAdjustments);
                    existingMetadata.set('last_price_adjustment', new Date());
                    
                    await Trading.findByIdAndUpdate(order._id, {
                      $set: { 
                        price: currentPrice,
                        metadata: existingMetadata
                      }
                    });
                    console.log(`📊 [주문가 조정] ${order.symbol} (매도): ${originalPrice.toLocaleString()}원 → ${currentPrice.toLocaleString()}원 (변동률: ${priceChangePercent.toFixed(2)}%, 임계값: ±${maxPriceChangePercent}%)`);
                    
                    // 가격 조정 알림 발송
                    try {
                      const notificationService = require('./services/notification-service');
                      await notificationService.sendNotification({
                        userId: userId,
                        type: 'order_executed',
                        title: '주문가 자동 조정',
                        message: `${order.symbol} 매도 주문가가 ${originalPrice.toLocaleString()}원에서 ${currentPrice.toLocaleString()}원으로 조정되었습니다. (변동률: ${priceChangePercent.toFixed(2)}%)`,
                        data: {
                          symbol: order.symbol,
                          order_type: 'sell',
                          original_price: originalPrice,
                          adjusted_price: currentPrice,
                          price_change_percent: priceChangePercent.toFixed(2),
                          action: '가격 조정됨'
                        }
                      });
                    } catch (notificationError) {
                      console.warn(`⚠️ [주문가 조정] 알림 발송 실패: ${order.symbol}`, notificationError.message);
                    }
                    
                    updatedCount++;
                    continue;
                  } else {
                    await Trading.findByIdAndUpdate(order._id, {
                      status: 'cancelled',
                      cancelled_at: new Date(),
                      $set: {
                        'metadata.cancellation_reason': `가격 변동률(${priceChangePercent.toFixed(2)}%)이 임계값(±${maxPriceChangePercent}%)을 초과하여 취소됨`,
                        'metadata.cancelled_at': new Date()
                      }
                    });
                    cancelledCount++;
                    console.log(`❌ [주문 취소] ${order.symbol} (매도): 가격 변동률 초과 (${priceChangePercent.toFixed(2)}%, 임계값: ±${maxPriceChangePercent}%)`);
                    continue;
                  }
                } else if (priceDiffPercent > 1) {
                  const originalPrice = order.price;
                  
                  // metadata 가져오기 및 업데이트
                  let existingMetadata = order.metadata || new Map();
                  if (!(existingMetadata instanceof Map)) {
                    const metadataMap = new Map();
                    if (typeof existingMetadata === 'object' && existingMetadata !== null) {
                      Object.entries(existingMetadata).forEach(([key, value]) => {
                        metadataMap.set(key, value);
                      });
                    }
                    existingMetadata = metadataMap;
                  }
                  
                  let priceAdjustments = existingMetadata.get('price_adjustments') || [];
                  if (!Array.isArray(priceAdjustments)) {
                    priceAdjustments = [];
                  }
                  
                  priceAdjustments.push({
                    original_price: originalPrice,
                    adjusted_price: currentPrice,
                    price_change_percent: priceChangePercent.toFixed(2),
                    adjusted_at: new Date()
                  });
                  existingMetadata.set('price_adjustments', priceAdjustments);
                  existingMetadata.set('last_price_adjustment', new Date());
                  
                  await Trading.findByIdAndUpdate(order._id, {
                    $set: { 
                      price: currentPrice,
                      metadata: existingMetadata
                    }
                  });
                  console.log(`📊 [주문가 자동 조정] ${order.symbol} (매도): ${originalPrice.toLocaleString()}원 → ${currentPrice.toLocaleString()}원 (차이: ${priceDiffPercent.toFixed(2)}%)`);
                  updatedCount++;
                  continue;
                }
              }
            }
          } catch (priceError) {
            console.warn(`⚠️ [주문가 조정] 현재가 조회 실패: ${order.symbol}`, priceError.message);
          }
        }

        if (isPaper) {
          // 모의투자: 포트폴리오 확인
          const portfolio = await Portfolio.findOne({
            user_id: order.user_id,
            symbol: order.symbol.toUpperCase(),
            is_paper_trading: true
          });

          if (order.order_type === 'buy') {
            // 매수 주문: 가격 조건 확인 후 포트폴리오 확인
            // 지정가 주문인 경우 현재가가 주문가 이하인지 확인
            let canExecute = true;
            if (order.order_method === 'limit') {
              try {
                const stockPrice = await kisAPI.getStockPrice(order.symbol, user);
                if (stockPrice && stockPrice.price && stockPrice.price > 0) {
                  // 매수 주문: 현재가가 주문가 이하일 때만 체결 가능
                  if (stockPrice.price > order.price) {
                    canExecute = false;
                    console.log(`⏸️ [${order.symbol}] 매수 주문 대기: 현재가(${stockPrice.price.toLocaleString()}원) > 주문가(${order.price.toLocaleString()}원)`);
                  }
                }
              } catch (priceError) {
                console.warn(`⚠️ [${order.symbol}] 가격 확인 실패 (체결 조건 확인 스킵):`, priceError.message);
              }
            }
            
            // 가격 조건을 만족하고 포트폴리오에 종목이 있고 수량이 있으면 체결
            if (canExecute && portfolio && portfolio.holdings) {
              const holding = portfolio.holdings.find(h => 
                h && h.symbol && h.symbol.toUpperCase() === order.symbol.toUpperCase()
              );
              
              if (holding && holding.quantity >= order.quantity) {
                // 주문 수량 이상 보유하고 있으면 체결된 것으로 간주
                await Trading.findByIdAndUpdate(order._id, {
                  status: 'completed',
                  executed_at: order.executed_at || new Date(order.createdAt)
                });
                updatedCount++;
                console.log(`✅ [${order.symbol}] 매수 주문 상태 업데이트: pending -> completed (포트폴리오 확인, 가격 조건 만족)`);
                continue;
              }
            }
          } else if (order.order_type === 'sell') {
            // 매도 주문: 가격 조건 확인 후 포트폴리오 확인
            // 지정가 주문인 경우 현재가가 주문가 이상인지 확인
            let canExecute = true;
            if (order.order_method === 'limit') {
              try {
                const stockPrice = await kisAPI.getStockPrice(order.symbol, user);
                if (stockPrice && stockPrice.price && stockPrice.price > 0) {
                  // 매도 주문: 현재가가 주문가 이상일 때만 체결 가능
                  if (stockPrice.price < order.price) {
                    canExecute = false;
                    console.log(`⏸️ [${order.symbol}] 매도 주문 대기: 현재가(${stockPrice.price.toLocaleString()}원) < 주문가(${order.price.toLocaleString()}원)`);
                  }
                }
              } catch (priceError) {
                console.warn(`⚠️ [${order.symbol}] 가격 확인 실패 (체결 조건 확인 스킵):`, priceError.message);
              }
            }
            
            // 가격 조건을 만족하고 포트폴리오에 종목이 없거나 수량이 줄었으면 체결
            if (canExecute) {
              if (!portfolio || !portfolio.holdings) {
                // 포트폴리오에 종목이 없으면 체결된 것으로 간주
                await Trading.findByIdAndUpdate(order._id, {
                  status: 'completed',
                  executed_at: order.executed_at || new Date(order.createdAt)
                });
                updatedCount++;
                console.log(`✅ [${order.symbol}] 매도 주문 상태 업데이트: pending -> completed (포트폴리오 확인, 가격 조건 만족)`);
                continue;
              } else {
                const holding = portfolio.holdings.find(h => 
                  h && h.symbol && h.symbol.toUpperCase() === order.symbol.toUpperCase()
                );
                
                if (!holding || holding.quantity === 0) {
                  // 보유 수량이 0이면 체결된 것으로 간주
                  await Trading.findByIdAndUpdate(order._id, {
                    status: 'completed',
                    executed_at: order.executed_at || new Date(order.createdAt)
                  });
                  updatedCount++;
                  console.log(`✅ [${order.symbol}] 매도 주문 상태 업데이트: pending -> completed (포트폴리오 확인, 가격 조건 만족)`);
                  continue;
                }
              }
            }
          }

          // 거래 외 시간에 생성된 주문 확인 및 정리
          const orderCreatedAt = new Date(order.createdAt);
          const koreaTime = new Date(orderCreatedAt.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
          const orderDay = koreaTime.getDay(); // 0: 일요일, 6: 토요일
          const orderHour = koreaTime.getHours();
          const orderMinutes = koreaTime.getMinutes();
          const isWeekday = orderDay >= 1 && orderDay <= 5;
          const isTradingHours = orderHour >= 9 && (orderHour < 15 || (orderHour === 15 && orderMinutes <= 30));
          const isOutsideTradingHours = !isWeekday || !isTradingHours;
          
          // 거래 외 시간에 생성된 주문이고 12시간 이상 지났으면 취소
          // 특수 상황(한국은행 정책발표 등)에서는 더 짧은 시간(6시간)으로 단축 가능
          const cancellationHours = isSpecialSituation ? 6 : 12;
          if (isOutsideTradingHours && hoursSinceOrder >= cancellationHours) {
            await Trading.findByIdAndUpdate(order._id, {
              status: 'cancelled',
              cancelled_at: new Date(),
              $set: {
                'metadata.cancellation_reason': isSpecialSituation 
                  ? '특수 상황(정책발표 등)으로 인한 거래 외 시간 주문 자동 취소'
                  : '거래 외 시간에 생성된 주문으로 인한 자동 취소',
                'metadata.cancelled_at': new Date()
              }
            });
            cancelledCount++;
            console.log(`🗑️ [${order.symbol}] 거래 외 시간 주문 정리: pending -> cancelled (${hoursSinceOrder.toFixed(1)}시간 경과${isSpecialSituation ? ', 특수 상황' : ''})`);
            continue;
          }
          
          // 24시간 이상 지난 주문 처리 (더 적극적인 정리)
          if (hoursSinceOrder >= 24) {
            if (order.order_type === 'buy') {
              // 매수 주문: 24시간 이상 지났는데 포트폴리오에 없으면 취소
              const holding = portfolio?.holdings?.find(h => 
                h && h.symbol && h.symbol.toUpperCase() === order.symbol.toUpperCase()
              );
              
              if (!holding || !holding.quantity || holding.quantity < order.quantity) {
                // 포트폴리오에 없거나 주문 수량보다 적으면 취소
                await Trading.findByIdAndUpdate(order._id, {
                  status: 'cancelled',
                  cancelled_at: new Date(),
                  $set: {
                    'metadata.cancellation_reason': '24시간 경과 후 미체결로 인한 자동 취소',
                    'metadata.cancelled_at': new Date()
                  }
                });
                cancelledCount++;
                console.log(`⚠️ [${order.symbol}] 매수 주문 상태 업데이트: pending -> cancelled (24시간 경과, 미체결)`);
                continue; // 다음 주문으로
              }
            } else if (order.order_type === 'sell') {
              // 매도 주문: 24시간 이상 지났는데 포트폴리오에 종목이 있으면 취소
              const holding = portfolio?.holdings?.find(h => 
                h && h.symbol && h.symbol.toUpperCase() === order.symbol.toUpperCase()
              );
              
              if (holding && holding.quantity > 0) {
                // 포트폴리오에 종목이 있으면 미체결로 간주하고 취소
                await Trading.findByIdAndUpdate(order._id, {
                  status: 'cancelled',
                  cancelled_at: new Date(),
                  $set: {
                    'metadata.cancellation_reason': '24시간 경과 후 미체결로 인한 자동 취소',
                    'metadata.cancelled_at': new Date()
                  }
                });
                cancelledCount++;
                console.log(`⚠️ [${order.symbol}] 매도 주문 상태 업데이트: pending -> cancelled (24시간 경과, 미체결)`);
                continue; // 다음 주문으로
              }
            }
          }
          
          // 48시간 이상 지난 주문은 무조건 취소 (더 적극적인 정리)
          if (hoursSinceOrder >= 48) {
            await Trading.findByIdAndUpdate(order._id, {
              status: 'cancelled',
              cancelled_at: new Date(),
              $set: {
                'metadata.cancellation_reason': '48시간 경과 후 미체결로 인한 자동 취소',
                'metadata.cancelled_at': new Date()
              }
            });
            cancelledCount++;
            console.log(`🗑️ [${order.symbol}] 주문 강제 취소: pending -> cancelled (48시간 경과)`);
            continue; // 다음 주문으로
          }
        } else {
          // 실전투자: 거래 외 시간 주문 정리 및 시간 기반 처리
          const orderCreatedAt = new Date(order.createdAt);
          const koreaTime = new Date(orderCreatedAt.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
          const orderDay = koreaTime.getDay();
          const orderHour = koreaTime.getHours();
          const orderMinutes = koreaTime.getMinutes();
          const isWeekday = orderDay >= 1 && orderDay <= 5;
          const isTradingHours = orderHour >= 9 && (orderHour < 15 || (orderHour === 15 && orderMinutes <= 30));
          const isOutsideTradingHours = !isWeekday || !isTradingHours;
          
          // 거래 외 시간에 생성된 주문이고 12시간 이상 지났으면 취소
          // 특수 상황(한국은행 정책발표 등)에서는 더 짧은 시간(6시간)으로 단축 가능
          const cancellationHours = isSpecialSituation ? 6 : 12;
          if (isOutsideTradingHours && hoursSinceOrder >= cancellationHours) {
            await Trading.findByIdAndUpdate(order._id, {
              status: 'cancelled',
              cancelled_at: new Date(),
              $set: {
                'metadata.cancellation_reason': isSpecialSituation 
                  ? '특수 상황(정책발표 등)으로 인한 거래 외 시간 주문 자동 취소'
                  : '거래 외 시간에 생성된 주문으로 인한 자동 취소',
                'metadata.cancelled_at': new Date()
              }
            });
            cancelledCount++;
            console.log(`🗑️ [${order.symbol}] 거래 외 시간 주문 정리 (실전투자): pending -> cancelled (${hoursSinceOrder.toFixed(1)}시간 경과${isSpecialSituation ? ', 특수 상황' : ''})`);
            continue;
          }
          
          // 24시간 이상 지난 주문은 취소 처리 (실전투자에서는 KIS API 조회 필요)
          if (hoursSinceOrder >= 24) {
            // TODO: KIS API에서 주문 상태 조회 기능 추가 후 활성화
            // const orderStatus = await kisAPI.getOrderStatus(order.order_id, user);
            // if (orderStatus === 'completed' || orderStatus === 'executed') {
            //   await Trading.findByIdAndUpdate(order._id, {
            //     status: 'completed',
            //     executed_at: order.executed_at || new Date(order.createdAt)
            //   });
            //   updatedCount++;
            //   continue;
            // }
            
            // KIS API 조회가 불가능한 경우 24시간 경과 시 취소
            await Trading.findByIdAndUpdate(order._id, {
              status: 'cancelled',
              cancelled_at: new Date(),
              $set: {
                'metadata.cancellation_reason': '24시간 경과 후 미체결로 인한 자동 취소',
                'metadata.cancelled_at': new Date()
              }
            });
            cancelledCount++;
            console.log(`⚠️ [${order.symbol}] 실전투자 주문 상태 업데이트: pending -> cancelled (24시간 경과)`);
            continue; // 다음 주문으로
          }
          
          // 48시간 이상 지난 주문은 무조건 취소 (더 적극적인 정리)
          if (hoursSinceOrder >= 48) {
            await Trading.findByIdAndUpdate(order._id, {
              status: 'cancelled',
              cancelled_at: new Date(),
              $set: {
                'metadata.cancellation_reason': '48시간 경과 후 미체결로 인한 자동 취소',
                'metadata.cancelled_at': new Date()
              }
            });
            cancelledCount++;
            console.log(`🗑️ [${order.symbol}] 실전투자 주문 강제 취소: pending -> cancelled (48시간 경과)`);
            continue; // 다음 주문으로
          }
        }
      } catch (error) {
        errorCount++;
        console.error(`[주문 상태 업데이트] 실패: ${order._id} (${order.symbol})`, error.message);
      }
    }

    if (updatedCount > 0 || cancelledCount > 0) {
      console.log(`[주문 상태 업데이트] 완료: 체결 ${updatedCount}건, 취소 ${cancelledCount}건, 오류 ${errorCount}건`);
      
      // 남은 pending 주문 수 확인
      const remainingPending = await Trading.countDocuments({
        status: 'pending',
        order_id: { $exists: true, $ne: null },
        createdAt: { $gte: sevenDaysAgo }
      });
      
      if (remainingPending > 0) {
        console.log(`ℹ️ [주문 상태 업데이트] 남은 pending 주문: ${remainingPending}건 (다음 스케줄러에서 처리 예정)`);
      }
    } else if (pendingOrders.length > 0) {
      console.log(`[주문 상태 업데이트] 업데이트할 주문 없음 (${pendingOrders.length}건 확인)`);
      
      // 조건을 만족하지 않는 주문들의 상세 정보 로깅
      const sampleOrders = pendingOrders.slice(0, 5).map(o => ({
        symbol: o.symbol,
        order_type: o.order_type,
        hours: ((Date.now() - new Date(o.createdAt).getTime()) / (1000 * 60 * 60)).toFixed(1),
        createdAt: o.createdAt
      }));
      console.log(`📋 [주문 상태 업데이트] 미처리 주문 샘플:`, sampleOrders);
    }
  } catch (error) {
    console.error('[주문 상태 업데이트] 스케줄러 오류:', error);
  }
}

// 주문 상태 업데이트 스케줄러 시작 (10분마다 실행 - CPU 부하 감소를 위해 5분 → 10분으로 증가)
setInterval(async () => {
  try {
    await updatePendingOrderStatus();
  } catch (error) {
    console.error('[스케줄러] 주문 상태 업데이트 오류:', error);
  }
}, 10 * 60 * 1000); // 10분 (CPU 부하 감소를 위해 5분 → 10분으로 증가, 아래에서 동적 스케줄러로 대체)

// 주문 상태 업데이트 스케줄러 (거래시간 중: 1분마다, 거래시간 외: 5분마다)
async function schedulePendingOrderUpdate() {
  const now = new Date();
  const koreaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const hour = koreaTime.getHours();
  const day = koreaTime.getDay();
  const isWeekday = day >= 1 && day <= 5;
  const isTradingHours = hour >= 9 && (hour < 15 || (hour === 15 && koreaTime.getMinutes() <= 30));
  
  // 거래시간 중: 1분마다 실행 (실시간 가격 모니터링)
  // 거래시간 외: 5분마다 실행 (기존 로직)
  const interval = (isWeekday && isTradingHours) ? 1 * 60 * 1000 : 5 * 60 * 1000;
  
  try {
    await updatePendingOrderStatus();
  } catch (error) {
    console.error('[스케줄러] 주문 상태 업데이트 오류:', error);
  }
  
  // 다음 실행 시간 계산
  setTimeout(schedulePendingOrderUpdate, interval);
}

schedulePendingOrderUpdate();
console.log('✅ 주문 상태 업데이트 스케줄러 시작 (거래시간 중: 2분 간격, 거래시간 외: 10분 간격)');

// 거래 종료 후 주문 정리 함수 (장마감 후 일괄 정리)
async function cleanupOrdersAfterMarketClose() {
  try {
    console.log('[장마감 후 정리] 주문 정리 시작...');
    const now = new Date();
    const koreaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    
    // 거래 종료 후가 아니면 실행하지 않음
    if (!isAfterTradingClose()) {
      console.log('[장마감 후 정리] 거래 시간 중이므로 스킵');
      return;
    }
    
    // 최근 7일 내 pending 상태인 주문 조회
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const pendingOrders = await Trading.find({
      status: 'pending',
      createdAt: { $gte: sevenDaysAgo }
    }).populate('user_id');
    
    if (pendingOrders.length === 0) {
      console.log('[장마감 후 정리] 정리할 주문 없음');
      return;
    }
    
    console.log(`[장마감 후 정리] ${pendingOrders.length}건의 pending 주문 확인`);
    
    let cancelledCount = 0;
    let skippedCount = 0;
    
    for (const order of pendingOrders) {
      try {
        const orderCreatedAt = new Date(order.createdAt);
        const orderKoreaTime = new Date(orderCreatedAt.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
        const orderDay = orderKoreaTime.getDay();
        const orderHour = orderKoreaTime.getHours();
        const orderMinutes = orderKoreaTime.getMinutes();
        const isWeekday = orderDay >= 1 && orderDay <= 5;
        const isTradingHours = isWeekday && orderHour >= 9 && (orderHour < 15 || (orderHour === 15 && orderMinutes <= 30));
        const isOutsideTradingHours = !isWeekday || !isTradingHours;
        
        const hoursSinceOrder = (now.getTime() - orderCreatedAt.getTime()) / (1000 * 60 * 60);
        
        // 거래 외 시간에 생성된 주문이거나, 거래 시간에 생성되었지만 장마감 후 30분 이상 지난 주문은 취소
        if (isOutsideTradingHours || (isTradingHours && hoursSinceOrder >= 0.5)) {
          await Trading.findByIdAndUpdate(order._id, {
            status: 'cancelled',
            cancelled_at: new Date(),
            $set: {
              'metadata.cancellation_reason': '장마감 후 자동 정리',
              'metadata.cancelled_at': new Date()
            }
          });
          cancelledCount++;
          console.log(`🗑️ [장마감 후 정리] 주문 취소: ${order.symbol} (${hoursSinceOrder.toFixed(1)}시간 경과)`);
        } else {
          skippedCount++;
        }
      } catch (error) {
        console.error(`[장마감 후 정리] 주문 ${order._id} 정리 실패:`, error.message);
      }
    }
    
    if (cancelledCount > 0) {
      console.log(`✅ [장마감 후 정리] ${cancelledCount}건의 주문 정리 완료, ${skippedCount}건 스킵`);
    } else {
      console.log(`ℹ️ [장마감 후 정리] 정리할 주문 없음 (${skippedCount}건 스킵)`);
    }
  } catch (error) {
    console.error('[장마감 후 정리] 오류:', error);
  }
}

// 거래 시작 전 갱신 실행 중 플래그 (중복 실행 방지)
let isPreTradingUpdateRunning = false;

// 거래 시작 30분 전 종합 갱신 함수 (8:30)
async function preTradingUpdate() {
  // 중복 실행 방지
  if (isPreTradingUpdateRunning) {
    console.log('⚠️ [거래 시작 전 갱신] 이미 실행 중입니다. 중복 실행 방지.');
    return;
  }
  
  isPreTradingUpdateRunning = true;
  
  try {
    console.log('🔄 [거래 시작 전 갱신] 시작 (8:30)...');
    
    // 1. AI 분석 갱신
    console.log('[거래 시작 전 갱신] AI 분석 갱신 시작...');
    const users = await User.find({});
    let totalUpdated = 0;
    
    for (const user of users) {
      try {
        const config = await aiTradeService.getOrCreateConfig(user.id || user._id, user.trading?.is_paper_trading !== false);
        if (!config.is_active) continue;
        
        // Google AI API 키 체크 제거 - 로컬 AI만 사용하므로 API 키 불필요
        // 자동 실행은 로컬 AI만 사용 (주간 정기분석 제외)
        const result = await aiTradeService.checkAndUpdateExpiredSymbols(user);
        if (result.updated > 0) {
          totalUpdated += result.updated;
          console.log(`[거래 시작 전 갱신] 사용자 ${user.email}: ${result.updated}개 종목 분석 완료`);
        }
      } catch (error) {
        console.error(`[거래 시작 전 갱신] 사용자 ${user.email} 갱신 실패:`, error.message);
      }
    }
    
    console.log(`✅ [거래 시작 전 갱신] 완료: 총 ${totalUpdated}개 종목 분석`);
  } catch (error) {
    console.error('[거래 시작 전 갱신] 오류:', error);
  } finally {
    isPreTradingUpdateRunning = false;
  }
}

// 거래 종료 후 갱신 실행 중 플래그 (중복 실행 방지)
let isPostTradingUpdateRunning = false;

// AI 분석 스케줄러 실행 중 플래그 (중복 실행 방지)
let isAIAnalysisRunning = false;

// 거래 종료 후 종합 갱신 함수 (15:30 이후)
async function postTradingUpdate() {
  // 중복 실행 방지
  if (isPostTradingUpdateRunning) {
    console.log('⚠️ [거래 종료 후 갱신] 이미 실행 중입니다. 중복 실행 방지.');
    return;
  }
  
  isPostTradingUpdateRunning = true;
  
  try {
    console.log('🔄 [거래 종료 후 갱신] 시작 (15:30 이후)...');
    
    // 1. 주문 정리
    console.log('[거래 종료 후 갱신] 주문 정리 시작...');
    await cleanupOrdersAfterMarketClose();
    
    // 2. AI 분석 갱신
    console.log('[거래 종료 후 갱신] AI 분석 갱신 시작...');
    const users = await User.find({});
    let totalUpdated = 0;
    
    for (const user of users) {
      try {
        const config = await aiTradeService.getOrCreateConfig(user.id || user._id, user.trading?.is_paper_trading !== false);
        if (!config.is_active) continue;
        
        // Google AI API 키 체크 제거 - 로컬 AI만 사용하므로 API 키 불필요
        // 자동 실행은 로컬 AI만 사용 (주간 정기분석 제외)
        const result = await aiTradeService.checkAndUpdateExpiredSymbols(user);
        if (result.updated > 0) {
          totalUpdated += result.updated;
          console.log(`[거래 종료 후 갱신] 사용자 ${user.email}: ${result.updated}개 종목 분석 완료`);
        }
      } catch (error) {
        console.error(`[거래 종료 후 갱신] 사용자 ${user.email} 갱신 실패:`, error.message);
      }
    }
    
    console.log(`✅ [거래 종료 후 갱신] 완료: 주문 정리 및 ${totalUpdated}개 종목 분석`);
  } catch (error) {
    console.error('[거래 종료 후 갱신] 오류:', error);
  } finally {
    isPostTradingUpdateRunning = false;
  }
}

// 거래 시작 30분 전 스케줄러 설정 (매일 8:30)
let preTradingUpdateTimeout = null; // 타임아웃 참조 저장 (중복 방지)

function schedulePreTradingUpdate() {
  // 이미 스케줄러가 실행 중이면 중복 등록 방지
  if (preTradingUpdateTimeout) {
    console.log('⚠️ 거래 시작 전 갱신 스케줄러가 이미 등록되어 있습니다.');
    return;
  }
  
  const scheduleNext = () => {
    const nextTime = getNextTradingDayPreStartTime();
    const now = new Date();
    const koreaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const msUntilNext = nextTime.getTime() - koreaTime.getTime();
    
    // 음수인 경우 (이미 지난 시간) 또는 너무 작은 경우 (1분 미만) 다음 거래일로 스케줄링
    if (msUntilNext < 60000) { // 1분 미만이면 다음 거래일로
      console.log('⚠️ 거래 시작 전 갱신 스케줄러: 이미 지난 시간입니다. 다음 거래일로 재스케줄링...');
      // 다음 거래일로 재계산 (현재 시간 기준으로 다시 계산)
      const nextTradingDay = getNextTradingDayPreStartTime();
      const msUntilNextTradingDay = nextTradingDay.getTime() - koreaTime.getTime();
      
      // 여전히 음수이면 최소 1시간 후로 설정 (무한 루프 방지)
      const minDelay = Math.max(msUntilNextTradingDay, 60 * 60 * 1000); // 최소 1시간
      
      preTradingUpdateTimeout = setTimeout(() => {
        preTradingUpdateTimeout = null;
        preTradingUpdate();
        scheduleNext(); // 다음 거래일 스케줄링
      }, minDelay);
      console.log(`✅ 거래 시작 전 갱신 스케줄러: 다음 실행 ${nextTradingDay.toLocaleString('ko-KR')} (${Math.round(minDelay / 1000 / 60)}분 후)`);
      return;
    }
    
    preTradingUpdateTimeout = setTimeout(() => {
      preTradingUpdateTimeout = null;
      preTradingUpdate();
      scheduleNext(); // 다음 거래일 스케줄링
    }, msUntilNext);
    
    console.log(`✅ 거래 시작 전 갱신 스케줄러: 다음 실행 ${nextTime.toLocaleString('ko-KR')}`);
  };
  
  scheduleNext();
}

// 거래 종료 후 스케줄러 설정 (매일 15:31)
let postTradingUpdateTimeout = null; // 타임아웃 참조 저장 (중복 방지)

function schedulePostTradingUpdate() {
  // 이미 스케줄러가 실행 중이면 중복 등록 방지
  if (postTradingUpdateTimeout) {
    console.log('⚠️ 거래 종료 후 갱신 스케줄러가 이미 등록되어 있습니다.');
    return;
  }
  
  const scheduleNext = () => {
    const nextTime = getNextTradingDayPostCloseTime();
    const now = new Date();
    const koreaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const msUntilNext = nextTime.getTime() - koreaTime.getTime();
    
    // 음수인 경우 (이미 지난 시간) 또는 너무 작은 경우 (1분 미만) 다음 거래일로 스케줄링
    if (msUntilNext < 60000) { // 1분 미만이면 다음 거래일로
      console.log('⚠️ 거래 종료 후 갱신 스케줄러: 이미 지난 시간입니다. 다음 거래일로 재스케줄링...');
      // 다음 거래일로 재계산 (현재 시간 기준으로 다시 계산)
      const nextTradingDay = getNextTradingDayPostCloseTime();
      const msUntilNextTradingDay = nextTradingDay.getTime() - koreaTime.getTime();
      
      // 여전히 음수이면 최소 1시간 후로 설정 (무한 루프 방지)
      const minDelay = Math.max(msUntilNextTradingDay, 60 * 60 * 1000); // 최소 1시간
      
      postTradingUpdateTimeout = setTimeout(() => {
        postTradingUpdateTimeout = null;
        postTradingUpdate();
        scheduleNext(); // 다음 거래일 스케줄링
      }, minDelay);
      console.log(`✅ 거래 종료 후 갱신 스케줄러: 다음 실행 ${nextTradingDay.toLocaleString('ko-KR')} (${Math.round(minDelay / 1000 / 60)}분 후)`);
      return;
    }
    
    postTradingUpdateTimeout = setTimeout(() => {
      postTradingUpdateTimeout = null;
      postTradingUpdate();
      scheduleNext(); // 다음 거래일 스케줄링
    }, msUntilNext);
    
    console.log(`✅ 거래 종료 후 갱신 스케줄러: 다음 실행 ${nextTime.toLocaleString('ko-KR')}`);
  };
  
  scheduleNext();
}

// 스케줄러 시작
schedulePreTradingUpdate();
schedulePostTradingUpdate();

// AI 거래 분석 실행 함수
async function runAIAnalysis() {
  // 중복 실행 방지
  if (isAIAnalysisRunning) {
    console.log('⚠️ [AI 스케줄러] 이미 실행 중입니다. 중복 실행 방지.');
    return;
  }
  
  isAIAnalysisRunning = true;
  const startTime = new Date();
  try {
    // 토요일(6)과 일요일(0)에는 AI 정기분석 스킵
    const now = new Date();
    const koreaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const day = koreaTime.getDay(); // 0: 일요일, 6: 토요일
    
    if (day === 0 || day === 6) {
      console.log(`[AI 스케줄러] 주말(토요일/일요일) 스킵: ${day === 0 ? '일요일' : '토요일'}`, {
        currentTime: koreaTime.toLocaleString('ko-KR'),
        dayOfWeek: day
      });
      return;
    }
    
    console.log('[AI 스케줄러] 갱신이 필요한 종목 분석 시작...', {
      startTime: startTime.toISOString(),
      dayOfWeek: day,
      currentTime: koreaTime.toLocaleString('ko-KR')
    });
    
    // 활성화된 모든 사용자 조회
    const users = await User.find({});
    console.log(`[AI 스케줄러] 총 ${users.length}명의 사용자 확인`);
    
    let totalUpdated = 0;
    let totalSkipped = 0;
    let totalErrors = 0;
    
    for (const user of users) {
      try {
        // AI 거래 설정 확인
        const config = await aiTradeService.getOrCreateConfig(user.id || user._id, user.trading?.is_paper_trading !== false);
        
        if (!config.is_active) {
          console.log(`[AI 스케줄러] 사용자 ${user.email || user.id} AI 거래 비활성화 - 스킵`);
          totalSkipped++;
          continue;
        }
        
        // Google AI API 키 체크 제거 - 로컬 AI만 사용하므로 API 키 불필요
        // 자동 실행은 로컬 AI만 사용 (주간 정기분석 제외)
        const result = await aiTradeService.checkAndUpdateExpiredSymbols(user);
        if (result.updated > 0) {
          console.log(`[AI 스케줄러] 사용자 ${user.email || user.id}: ${result.updated}개 종목 분석 완료`);
          totalUpdated += result.updated;
        } else {
          console.log(`[AI 스케줄러] 사용자 ${user.email || user.id}: 갱신 필요 종목 없음`);
        }
      } catch (userError) {
        console.error(`[AI 스케줄러] 사용자 ${user.email || user.id} 분석 실패:`, {
          error: userError.message,
          stack: userError.stack?.split('\n').slice(0, 5).join('\n')
        });
        totalErrors++;
      }
    }
    
    const endTime = new Date();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    console.log(`[AI 스케줄러] 갱신이 필요한 종목 분석 완료`, {
      duration: `${duration}초`,
      totalUsers: users.length,
      totalUpdated,
      totalSkipped,
      totalErrors
    });
  } catch (error) {
    console.error('[AI 스케줄러] AI 거래 분석 오류:', error);
    console.error('[AI 스케줄러] 에러 상세:', error.stack);
  } finally {
    isAIAnalysisRunning = false;
  }
}

// AI 거래 분석 스케줄러 (평일만 실행, 2시간마다)
// 서버 시작 후 10분 후 첫 실행, 이후 2시간마다 실행 (토요일/일요일 제외)
setTimeout(() => {
  runAIAnalysis();
  setInterval(runAIAnalysis, 2 * 60 * 60 * 1000); // 2시간 (CPU 부하 감소를 위해 1시간 → 2시간으로 증가)
}, 10 * 60 * 1000); // 10분 (CPU 부하 감소를 위해 5분 → 10분으로 증가)
console.log('✅ AI 거래 분석 스케줄러 시작 (서버 시작 후 10분 후 첫 실행, 이후 2시간 간격, 평일만 실행)');

// 실패 종목 자동 재분석 함수
async function reanalyzeFailedSymbols() {
  const startTime = new Date();
  try {
    console.log('[실패 종목 재분석 스케줄러] 실패 종목 재분석 시작...', {
      startTime: startTime.toISOString()
    });
    
    const AITradeAnalysis = require('./models/AITradeAnalysis');
    const User = require('./models/User');
    
    // 최근 7일간 실패한 분석 기록 조회 (최대 5개)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const failedAnalyses = await AITradeAnalysis.find({
      execution_status: 'failed',
      createdAt: { $gte: sevenDaysAgo },
      'execution_result.retry_scheduled': { $ne: true } // 이미 재시도 스케줄링된 것은 제외
    })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('user_id', 'email trading');

    if (failedAnalyses.length === 0) {
      console.log('[실패 종목 재분석 스케줄러] 재분석할 실패 종목 없음');
      return;
    }

    console.log(`[실패 종목 재분석 스케줄러] ${failedAnalyses.length}개 종목 재분석 시작`, {
      symbols: failedAnalyses.map(a => a.symbol).join(', ')
    });

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < failedAnalyses.length; i++) {
      const failedAnalysis = failedAnalyses[i];
      const progress = `${i + 1}/${failedAnalyses.length}`;
      
      try {
        console.log(`[실패 종목 재분석 스케줄러] 재분석 진행 중 (${progress}): ${failedAnalysis.symbol} (${failedAnalysis.stock_name || failedAnalysis.symbol})`);
        
        // 사용자 정보 가져오기
        const user = await User.findById(failedAnalysis.user_id);
        if (!user) {
          console.warn(`[실패 종목 재분석 스케줄러] 사용자를 찾을 수 없음: ${failedAnalysis.user_id}`);
          failCount++;
          continue;
        }

        // AI 거래 설정 확인
        const config = await aiTradeService.getOrCreateConfig(user.id || user._id, user.trading?.is_paper_trading !== false);
        if (!config.is_active) {
          console.log(`[실패 종목 재분석 스케줄러] 사용자 ${user.email} AI 거래 비활성화 - 스킵`);
          failCount++;
          continue;
        }

        // 재분석 옵션 설정 (로컬 AI만 사용)
        const analysisOptions = {
          deep_analysis: true,
          analysisDepth: 'deep',
          useGoogleAI: false, // 자동 실행은 로컬 AI만 사용 (주간 정기분석 제외)
          retry_after_failure: true,
          previous_failure_stage: failedAnalysis.execution_result?.failure_stage,
          previous_failure_reason: failedAnalysis.execution_result?.error_message
        };

        // 재분석 실행
        const result = await aiTradeService.analyzeAndUpdateSymbol(
          user,
          failedAnalysis.symbol,
          failedAnalysis.stock_name || failedAnalysis.symbol,
          false, // 전체 분석 시간 업데이트 안 함
          analysisOptions
        );

        // 재시도 스케줄링 플래그 설정
        failedAnalysis.execution_result = failedAnalysis.execution_result || {};
        failedAnalysis.execution_result.retry_scheduled = true;
        failedAnalysis.execution_result.auto_reanalyzed_at = new Date();
        await failedAnalysis.save();

        console.log(`[실패 종목 재분석 스케줄러] 재분석 완료 (${progress}): ${failedAnalysis.symbol}`, {
          recommendation: result.analysis?.recommendation?.action || 'none',
          confidence: result.analysis?.recommendation?.confidence_score || 0
        });
        successCount++;

        // API 호출 제한 방지
        await new Promise(resolve => setTimeout(resolve, 3000));
      } catch (error) {
        console.error(`[실패 종목 재분석 스케줄러] 종목 재분석 실패 (${progress}): ${failedAnalysis.symbol}`, {
          error: error.message,
          stack: error.stack?.split('\n').slice(0, 5).join('\n'),
          previous_failure_stage: failedAnalysis.execution_result?.failure_stage,
          previous_failure_reason: failedAnalysis.execution_result?.error_message
        });
        failCount++;
        
        // 에러 발생해도 다음 종목 계속 처리
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    const endTime = new Date();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    console.log(`[실패 종목 재분석 스케줄러] 재분석 완료`, {
      duration: `${duration}초`,
      total: failedAnalyses.length,
      success: successCount,
      failed: failCount
    });
  } catch (error) {
    console.error('[실패 종목 재분석 스케줄러] 오류:', error);
    console.error('[실패 종목 재분석 스케줄러] 에러 상세:', error.stack);
  }
}

// 실패 종목 자동 재분석 스케줄러 (매일 오전 9시 실행)
// 서버 시작 후 10분 후 첫 실행, 이후 매일 오전 9시 실행
setTimeout(() => {
  reanalyzeFailedSymbols();
  // 매일 오전 9시에 실행하도록 스케줄링
  const scheduleDailyReanalysis = () => {
    const now = new Date();
    const koreaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const targetTime = new Date(koreaTime);
    targetTime.setHours(9, 0, 0, 0);
    
    if (targetTime <= now) {
      targetTime.setDate(targetTime.getDate() + 1);
    }
    
    const msUntilTarget = targetTime.getTime() - now.getTime();
    setTimeout(() => {
      reanalyzeFailedSymbols();
      setInterval(reanalyzeFailedSymbols, 24 * 60 * 60 * 1000); // 매일
    }, msUntilTarget);
  };
  
  scheduleDailyReanalysis();
}, 10 * 60 * 1000); // 10분
console.log('✅ 실패 종목 자동 재분석 스케줄러 시작 (매일 오전 9시 실행)');

// 새로운 종목 자동 발굴 스케줄러 (매주 월요일 오전 9시)
const runStockDiscovery = async () => {
  try {
    console.log('[AI 스케줄러] 새로운 종목 자동 발굴 시작...');
    
    const users = await User.find({});
    
    for (const user of users) {
      try {
        const config = await aiTradeService.getOrCreateConfig(user.id || user._id, user.trading?.is_paper_trading !== false);
        
        if (!config.is_active) {
          continue;
        }
        
        const result = await aiTradeService.discoverNewStocks(user, 10);
        if (result.discovered > 0) {
          console.log(`[AI 스케줄러] 사용자 ${user.email || user.id}: ${result.discovered}개 종목 발굴`);
        }
      } catch (userError) {
        console.error(`[AI 스케줄러] 사용자 ${user.email || user.id} 종목 발굴 실패:`, userError.message);
      }
    }
  } catch (error) {
    console.error('[AI 스케줄러] 종목 발굴 오류:', error);
  }
};

// 매주 월요일 오전 9시에 실행
const scheduleStockDiscovery = () => {
  const now = new Date();
  const koreaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const day = koreaTime.getDay(); // 0: 일요일, 6: 토요일
  const hour = koreaTime.getHours();
  
  // 다음 월요일 9시 계산
  let daysUntilMonday = (8 - day) % 7; // 다음 월요일까지 일수
  if (daysUntilMonday === 0 && hour >= 9) {
    daysUntilMonday = 7; // 오늘이 월요일이고 9시 이후면 다음 주 월요일
  }
  
  const nextMonday = new Date(koreaTime);
  nextMonday.setDate(nextMonday.getDate() + daysUntilMonday);
  nextMonday.setHours(9, 0, 0, 0);
  
  const msUntilNextMonday = nextMonday.getTime() - now.getTime();
  
  setTimeout(() => {
    runStockDiscovery();
    // 이후 매주 실행
    setInterval(runStockDiscovery, 7 * 24 * 60 * 60 * 1000); // 7일
  }, msUntilNextMonday);
  
  console.log(`✅ 새로운 종목 자동 발굴 스케줄러 시작 (다음 실행: ${nextMonday.toLocaleString('ko-KR')})`);
};

scheduleStockDiscovery();

// 손실 10% 초과 종목 자동 분석 스케줄러 (매일 장 시작 전 오전 8시 실행)
const analyzeLossOver10Percent = async () => {
  try {
    console.log('[손실 종목 분석 스케줄러] 손실 10% 초과 종목 분석 시작...');
    
    const AITradeConfig = require('./models/AITradeConfig');
    const aiTradeService = require('./services/ai-trade-service');
    const kisAPI = require('./services/kis-api');
    
    // 모든 활성 사용자 조회
    const users = await User.find({});
    let totalAnalyzed = 0;
    let totalFailed = 0;
    
    for (const user of users) {
      try {
        // AI 거래 활성화 확인
        const config = await AITradeConfig.findOne({ 
          user_id: user.id || user._id,
          is_active: true 
        });
        
        if (!config) {
          continue;
        }
        
        // 포트폴리오 조회
        const isPaper = user.trading?.is_paper_trading !== false;
        let portfolio = [];
        
        if (isPaper) {
          // 모의투자: DB 포트폴리오 조회
          const Portfolio = require('./models/Portfolio');
          const userId = user.id || user._id || user.userId;
          const dbPortfolio = await Portfolio.findOne({ user_id: userId, is_paper_trading: true });
          if (dbPortfolio && dbPortfolio.holdings) {
            portfolio = dbPortfolio.holdings
              .filter(h => h && h.symbol && h.quantity > 0)
              .map(h => ({
                symbol: h.symbol,
                name: h.name || h.stock_name || '',
                quantity: h.quantity || 0,
                currentPrice: h.current_price || 0,
                averagePrice: h.avg_price || 0
              }));
          }
        } else {
          // 실전투자: KIS API 포트폴리오 조회
          portfolio = await kisAPI.getPortfolio(user);
        }
        
        // 손실 10% 초과 종목 필터링
        const lossStocks = portfolio.filter(item => {
          if (!item.averagePrice || !item.currentPrice || item.averagePrice <= 0) return false;
          const profitLossRate = ((item.currentPrice - item.averagePrice) / item.averagePrice) * 100;
          return profitLossRate < -10;
        });
        
        if (lossStocks.length > 0) {
          console.log(`📉 [손실 종목 분석] 사용자 ${user.email || user.id}: ${lossStocks.length}개 종목 발견`);
        }
        
        // 각 종목 강제 분석
        for (const stock of lossStocks) {
          try {
            await aiTradeService.analyzeAndUpdateSymbol(
              user,
              stock.symbol,
              stock.name || stock.stock_name || stock.symbol,
              false,
              {
                analysis_source: 'loss_over_10_percent_scheduler',
                force_analysis: true,
                useGoogleAI: false, // 비용 절감
                useGemini3Flash: false
              }
            );
            
            totalAnalyzed++;
            
            // API 호출 제한 방지
            await new Promise(resolve => setTimeout(resolve, 2000));
          } catch (error) {
            totalFailed++;
            console.error(`⚠️ [손실 종목 분석] ${stock.symbol} 분석 실패:`, error.message);
          }
        }
      } catch (userError) {
        console.error(`⚠️ [손실 종목 분석] 사용자 ${user.email || user.id} 처리 실패:`, userError.message);
      }
    }
    
    console.log(`[손실 종목 분석 스케줄러] 분석 완료:`, {
      성공: totalAnalyzed,
      실패: totalFailed,
      전체: totalAnalyzed + totalFailed
    });
  } catch (error) {
    console.error('❌ [손실 종목 분석 스케줄러] 오류:', error);
  }
};

// 매일 오전 8시 실행
const scheduleLossAnalysis = () => {
  const now = new Date();
  const koreaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const hour = koreaTime.getHours();
  const day = koreaTime.getDay();
  
  // 평일 오전 8시에만 실행
  if (day >= 1 && day <= 5 && hour === 8) {
    analyzeLossOver10Percent();
  }
};

// 1시간마다 체크하여 오전 8시에 실행
setInterval(scheduleLossAnalysis, 60 * 60 * 1000);
// 서버 시작 시 즉시 한 번 실행 (오전 8시인 경우)
scheduleLossAnalysis();
console.log('✅ 손실 10% 초과 종목 자동 분석 스케줄러 시작 (매일 오전 8시 실행)');

// New: Periodic loss-trigger processor (checks user-configured loss triggers every 5분)
const lossTriggerService = require('./services/loss-trigger-service');
const LOSS_TRIGGER_INTERVAL_MS = 5 * 60 * 1000; // 5분
setInterval(async () => {
  try {
    await lossTriggerService.processAllLossTriggers();
  } catch (err) {
    console.error('[Server] Loss trigger periodic check failed:', err.message);
  }
}, LOSS_TRIGGER_INTERVAL_MS);
// Run once at startup
lossTriggerService.processAllLossTriggers().catch(err => console.error('[Server] Initial loss trigger check failed:', err.message));
console.log(`✅ Periodic loss-trigger processor started (interval: ${LOSS_TRIGGER_INTERVAL_MS / 1000 / 60} min)`);

// B3: 임의 매수/수동 매수 종목 자동 등록 및 상태 동기화 스케줄러 (매일 오전 7시 실행)
const syncPortfolioToAIConfig = async () => {
  try {
    console.log('[포트폴리오 동기화] 임의 매수/수동 매수 종목 자동 등록 시작...');
    
    const AITradeConfig = require('./models/AITradeConfig');
    const aiTradeService = require('./services/ai-trade-service');
    const kisAPI = require('./services/kis-api');
    
    // 모든 활성 사용자 조회
    const users = await User.find({});
    let totalSynced = 0;
    let totalFailed = 0;
    
    for (const user of users) {
      try {
        // AI 거래 활성화 확인
        const config = await AITradeConfig.findOne({ 
          user_id: user.id || user._id,
          is_active: true 
        });
        
        if (!config) {
          continue;
        }
        
        // excluded_symbols 확인
        let excludedSymbols = [];
        if (config.metadata) {
          if (config.metadata instanceof Map) {
            excludedSymbols = config.metadata.get('excluded_symbols') || [];
          } else {
            excludedSymbols = config.metadata.excluded_symbols || [];
          }
        }
        
        // 포트폴리오 조회
        const isPaper = user.trading?.is_paper_trading !== false;
        let portfolio = [];
        
        if (isPaper) {
          // 모의투자: DB 포트폴리오 조회
          const Portfolio = require('./models/Portfolio');
          const userId = user.id || user._id || user.userId;
          const dbPortfolio = await Portfolio.findOne({ user_id: userId, is_paper_trading: true });
          if (dbPortfolio && dbPortfolio.holdings) {
            portfolio = dbPortfolio.holdings
              .filter(h => h && h.symbol && h.quantity > 0)
              .map(h => ({
                symbol: h.symbol,
                name: h.name || h.stock_name || '',
                quantity: h.quantity || 0,
                currentPrice: h.current_price || 0,
                averagePrice: h.avg_price || 0
              }));
          }
        } else {
          // 실전투자: KIS API 포트폴리오 조회
          portfolio = await kisAPI.getPortfolio(user);
        }
        
        // symbol_configs에 없는 포트폴리오 종목 찾기
        const missingSymbols = portfolio.filter(item => {
          // 제외 종목이 아니고
          if (excludedSymbols.includes(item.symbol)) {
            return false;
          }
          
          // symbol_configs에 없는 종목
          const existingConfig = config.symbol_configs.find(sc => sc.symbol === item.symbol);
          return !existingConfig;
        });
        
        let userSynced = 0;
        
        if (missingSymbols.length > 0) {
          console.log(`📋 [포트폴리오 동기화] 사용자 ${user.email || user.id}: ${missingSymbols.length}개 종목 자동 등록 필요`);
          
          // 각 종목을 symbol_configs에 추가
          for (const stock of missingSymbols) {
            try {
              const newSymbolConfig = {
                symbol: stock.symbol,
                stock_name: stock.name || stock.symbol,
                ai_recommendation: {
                  action: 'none',
                  confidence: 0,
                  reasoning: '수동 매수 종목 - AI 분석 대기 중',
                  target_price: 0,
                  stop_loss_price: 0
                },
                scheduled_orders: [],
                last_analysis_time: null,
                next_update_time: null
              };
              
              config.symbol_configs.push(newSymbolConfig);
              userSynced++;
              totalSynced++;
              
              console.log(`✅ [${stock.symbol}] 포트폴리오 동기화: AI 거래 설정에 자동 등록됨`);
            } catch (addError) {
              totalFailed++;
              console.error(`⚠️ [${stock.symbol}] 포트폴리오 동기화 실패:`, addError.message);
            }
          }
          
          // 변경사항 저장
          if (userSynced > 0) {
            await config.save();
            console.log(`💾 [포트폴리오 동기화] 사용자 ${user.email || user.id}: ${userSynced}개 종목 등록 완료`);
          }
        }
      } catch (userError) {
        console.error(`⚠️ [포트폴리오 동기화] 사용자 ${user.email || user.id} 처리 실패:`, userError.message);
      }
    }
    
    console.log(`[포트폴리오 동기화] 동기화 완료:`, {
      성공: totalSynced,
      실패: totalFailed
    });
  } catch (error) {
    console.error('❌ [포트폴리오 동기화] 오류:', error);
  }
};

// 매일 오전 7시 실행 (손실 종목 분석 전에 실행)
const schedulePortfolioSync = () => {
  const now = new Date();
  const koreaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const hour = koreaTime.getHours();
  const day = koreaTime.getDay();
  
  // 평일 오전 7시에만 실행
  if (day >= 1 && day <= 5 && hour === 7) {
    syncPortfolioToAIConfig();
  }
};

// 1시간마다 체크하여 오전 7시에 실행
setInterval(schedulePortfolioSync, 60 * 60 * 1000);
// 서버 시작 시 즉시 한 번 실행 (오전 7시인 경우)
schedulePortfolioSync();
console.log('✅ 포트폴리오 동기화 스케줄러 시작 (매일 오전 7시 실행)');

// 서버 시작
const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`=================================`);
  console.log(`🚀 Trading Service Started`);
  console.log(`📍 Port: ${PORT}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`⏰ Started at: ${new Date().toISOString()}`);
  if (process.env.ENABLE_AUTO_TRADE !== 'false') {
    console.log(`🤖 자동거래: 활성화 (5분 간격)`);
  } else {
    console.log(`🤖 자동거래: 비활성화`);
  }
  console.log(`=================================`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  if (autoTradeInterval) {
    clearInterval(autoTradeInterval);
    console.log('자동거래 스케줄러 중지');
  }
  server.close(() => {
    console.log('Trading Service stopped');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  if (autoTradeInterval) {
    clearInterval(autoTradeInterval);
    console.log('자동거래 스케줄러 중지');
  }
  server.close(() => {
    console.log('Trading Service stopped');
    process.exit(0);
  });
});

module.exports = app;

