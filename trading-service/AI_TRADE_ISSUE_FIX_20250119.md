# AI 자동거래 주문/취소 반복 문제 분석 및 개선안

**작성일**: 2025-01-19
**작성자**: Claude Code
**관련 브랜치**: fix/ai-sell-price-fallback

---

## 1. 문제 현상

### 1.1 잔액 부족에도 주문과 취소가 반복되는 현상
- AI 분석 결과에 따라 매수 주문 시도
- 잔액 부족으로 주문 실패
- 재시도 스케줄러가 1시간, 3시간, 6시간 간격으로 재시도 예약
- 잔액이 변하지 않아도 무조건 재시도하여 동일 실패 반복

### 1.2 코드 수정이 반영되지 않는 현상
- 핵심 파일들이 로컬에서 삭제됨 (git status에서 확인)
- 프로덕션 서버에 코드 반영이 누락될 가능성

---

## 2. 원인 분석

### 2.1 핵심 파일 삭제 문제 (심각도: 높음)

**발견 사항**:
```bash
$ git status
삭제함:        backend/server.js
삭제함:        backend/services/ai-order-executor.js
```

**영향**:
- 서버 시작 시 핵심 모듈 로드 실패
- 이전 버전 코드가 캐시에서 실행되거나 서버 오류 발생
- 최근 수정 사항(target_price 폴백, loss-trigger 등)이 적용되지 않음

**해결**: `git checkout HEAD -- backend/server.js backend/services/ai-order-executor.js` 실행 (완료)

---

### 2.2 ai-order-executor.js 버그 (심각도: 높음)

**위치**: `backend/services/ai-order-executor.js` 359~402번 줄

**문제 코드**:
```javascript
// 359번 줄: const로 선언
const orderAmount = buyQty * checkPrice;

// ... 중간 로직 ...

// 402번 줄: const 변수 재할당 시도 (버그!)
orderAmount = buyQty * checkPrice;  // TypeError 발생 가능
```

**영향**:
1. 잔액 부족 시 수량 자동 조정 로직에서 런타임 오류 발생
2. catch 블록으로 예외 처리되어 예상치 못한 동작
3. 주문 실패 원인이 "잔액 부족"이 아닌 "실행 오류"로 기록될 수 있음

---

### 2.3 재시도 스케줄러 로직 문제 (심각도: 중간)

**위치**: `backend/services/retry-scheduler-service.js` 36~47번 줄

**문제 로직**:
```javascript
// 잔액 부족(balance_check)이 재시도 가능 목록에 포함
const retryableStages = [
  'balance_check', // 잔액 부족 - 잔액 충족 시 재시도 가능
  'price_volatility_check',
  'portfolio_holding_percent_check'
];
```

**문제점**:
1. 실제 잔액 변화 여부를 확인하지 않고 무조건 재시도
2. 최대 3회 재시도 (1시간, 3시간, 6시간) 동안 반복 실패
3. 같은 종목에 대해 중복 예약 주문 생성 가능성

---

### 2.4 주문 금액 재계산 누락

**위치**: `backend/services/ai-order-executor.js` 400~403번 줄

**현재 로직**:
```javascript
if (adjustedQty >= minQuantity) {
  // 조정된 수량으로 진행
  console.log(`>> ${ticker} 잔액 부족으로 수량 자동 조정...`);
  buyQty = adjustedQty;
  orderAmount = buyQty * checkPrice;  // 버그: const 재할당
  // 조정된 수량으로 계속 진행
}
```

**개선 필요**: const → let 변경 및 로직 정리

---

## 3. 개선안

### 3.1 ai-order-executor.js 수정

**수정 내용**:
1. `orderAmount`를 `let`으로 선언하여 재할당 허용
2. 수량 조정 후 주문 금액 재계산 로직 정리

```javascript
// 수정 전
const orderAmount = buyQty * checkPrice;

// 수정 후
let orderAmount = buyQty * checkPrice;
```

---

### 3.2 retry-scheduler-service.js 수정

**수정 내용**:
1. 잔액 부족 재시도 전 잔액 확인 로직 추가
2. 재시도 조건 강화 (잔액 증가 시에만 재시도)

```javascript
// 수정: 잔액 부족은 재시도 불가 목록으로 이동
// 또는 재시도 전 잔액 확인 로직 추가
const nonRetryableStages = [
  'blocked_symbol_check',
  'confidence_check',
  'duplicate_order_check',
  'portfolio_holdings_count_check',
  'balance_check'  // 추가: 잔액 부족은 재시도하지 않음
];
```

**대안**: 잔액 부족 재시도 시 잔액 확인
```javascript
// 재시도 실행 전 잔액 확인
async shouldRetryBalanceCheck(user, requiredAmount) {
  const balance = await kisAPI.getBalance(user);
  const availableCash = balance?.availableCash || 0;
  return availableCash >= requiredAmount;
}
```

---

### 3.3 예약 주문 중복 방지 강화

**위치**: `backend/services/retry-scheduler-service.js` 78~87번 줄

**현재 로직**: 동일 분석 ID의 예약 주문만 삭제
```javascript
await ScheduledOrder.deleteMany({
  user_id: userId,
  'metadata.analysis_id': analysis._id.toString()
});
```

**개선안**: 동일 종목의 모든 대기 중 AI 재시도 예약 주문 삭제
```javascript
await ScheduledOrder.deleteMany({
  user_id: userId,
  is_paper_trading: isPaper,
  symbol: analysis.symbol.toUpperCase(),
  order_type: tradeConfig.order_type,
  status: 'pending',
  'metadata.ai_retry': true
  // analysis_id 조건 제거하여 모든 재시도 예약 삭제
});
```

---

## 4. 권장 수정 순서

1. **즉시 수정 필요**
   - [ ] ai-order-executor.js의 `const orderAmount` → `let orderAmount` 변경
   - [ ] 삭제된 파일 복원 확인 및 커밋

2. **단기 개선**
   - [ ] retry-scheduler-service.js에서 balance_check 재시도 정책 변경
   - [ ] 예약 주문 중복 방지 로직 강화

3. **중장기 개선**
   - [ ] 잔액 변화 감지 시스템 구축 (잔액 증가 시에만 재시도)
   - [ ] 주문 실패 대시보드에서 반복 실패 패턴 모니터링

---

## 5. 코드 변경 사항

### 5.1 ai-order-executor.js 변경

**파일**: `backend/services/ai-order-executor.js`
**변경 위치**: 359번 줄

```diff
- const orderAmount = buyQty * checkPrice;
+ let orderAmount = buyQty * checkPrice;
```

### 5.2 retry-scheduler-service.js 변경

**파일**: `backend/services/retry-scheduler-service.js`
**변경 위치**: 20~26번 줄

```diff
  const nonRetryableStages = [
    'blocked_symbol_check',
    'confidence_check',
    'duplicate_order_check',
-   'portfolio_holdings_count_check' // 포트폴리오 종목 수 초과는 재시도 불가
+   'portfolio_holdings_count_check', // 포트폴리오 종목 수 초과는 재시도 불가
+   'balance_check' // 잔액 부족은 재시도 불가 (잔액 증가 없이 재시도해도 동일 결과)
  ];
```

---

## 6. 배포 체크리스트

- [ ] 로컬 테스트 완료
- [ ] 스테이징 환경 테스트 완료
- [ ] git add && git commit
- [ ] git push
- [ ] 프로덕션 서버 배포
- [ ] 서버 재시작 후 로그 모니터링
- [ ] 24시간 동안 주문/취소 반복 패턴 모니터링

---

## 7. 참고 파일 목록

| 파일 | 역할 |
|------|------|
| `backend/services/ai-order-executor.js` | AI 분석 결과 기반 주문 실행 |
| `backend/services/retry-scheduler-service.js` | 실패 주문 재시도 스케줄링 |
| `backend/services/balance-prediction-service.js` | 잔액 예측 및 예약 관리 |
| `backend/server.js` | 메인 서버 및 스케줄러 |
| `backend/models/AITradeConfig.js` | AI 거래 설정 스키마 |
