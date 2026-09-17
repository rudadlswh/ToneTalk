# AI 사용량 제한·장애 대응

## 정책

앱 서버가 실제 AI 전송을 승인할 때 DB에서 횟수를 차감한다. 번역, 가사 번역, 한 줄 상세 해설, 롤플레이, 오늘의 문제 생성이 같은 한도를 사용한다. 한 번의 다섯 말투 번역/다섯 문제 생성은 각각 1회이며, 가사는 배치 요청마다, 대화는 답변마다, 상세 해설은 요청마다 1회다.

| 서버 환경 변수 | 기본값 | 의미 |
|---|---:|---|
| `AI_ENABLED` | `true` | `false`이면 새로운 AI 전송 중단 |
| `AI_USER_DAILY_LIMIT` | `30` | 계정당 한국 날짜 기준 일일 한도 |
| `AI_GLOBAL_DAILY_LIMIT` | `100` | 현재 공급자·사용량 범위의 전체 일일 한도 |
| `AI_USER_MINUTE_LIMIT` | `5` | 계정당 고정된 1분 구간의 한도 |
| `AI_GLOBAL_MINUTE_LIMIT` | `10` | 같은 범위의 전체 1분 한도 |
| `AI_MAX_CONCURRENT` | `2` | 동시에 전송할 수 있는 최대 요청 수 |
| `AI_USAGE_SCHEMA` | `DATABASE_SCHEMA` | 카운터·임대·장애 대기 상태를 저장할 스키마 |
| `AI_USAGE_SCOPE` | `primary` | 같은 공급자 내에서 한도를 공유할 이름 |

실패·시간 초과·취소도 이미 승인한 전송은 환불하지 않는다. 승인 직후 취소되어 실제 전송이 안 된 좁은 경계도 보수적으로 포함한다. 동일 요청의 수동 재시도는 새 전송이면 다시 차감한다. 입력 검증 실패, 사용량/동시성 제한에 의한 거부, 번역 캐시 적중, 저장된 오늘의 문제 조회·답안 제출, 저장 문장 복습, Health 메타데이터 조회는 차감하지 않는다. 독립 진단 스크립트와 Google AI Studio 등 앱 밖의 사용은 집계하지 않는다.

이 수치는 **앱의 보호 장치이지 Gemini 무료 할당량이나 요금 상한이 아니다.** Google은 프로젝트별 RPM/TPM/RPD 등을 적용하며 실제 한도는 [공식 한도 문서](https://ai.google.dev/gemini-api/docs/rate-limits)와 해당 프로젝트의 AI Studio에서 확인한다. 앱은 요청 횟수만 기록하고 토큰 수·Google 전체 사용량·결제 상태를 관리하지 않는다. 앱 일일 초기화는 KST 자정이며 공급자 초기화 시각과 다를 수 있다. 1분 한도는 슬라이딩 윈도우가 아니므로 경계 직전/직후에 요청이 몰릴 수 있다. 공급자 429 처리도 함께 유지한다.

## 구조와 계정 분리

인증·입력 검증 → 캐시/기존 문제 조회 → 공통 전송 함수 → `withAiUsage` DB 승인 → 공급자 호출 → 기존 출력 검증·저장 순서다. `ai_usage_state`에 공급자/범위별 전체 행과 검증된 Auth UUID별 행을 보관한다. 전체 행을 먼저 잠근 뒤 사용자 행을 잠그고, 횟수 검사·`inference_leases` 슬롯 획득·횟수 증가를 한 트랜잭션에서 수행한다. 네트워크 호출 전에 DB 연결을 반환한다. 인스턴스 메모리가 아닌 같은 DB 상태를 사용하므로 Vercel 인스턴스가 늘거나 재시작해도 한도가 유지된다.

계정마다 현재 분/날짜의 카운터 한 행만 갱신한다. 원문·응답·API 키를 저장하지 않으며 별도의 전체 사용 이력 테이블은 만들지 않는다. RLS를 켜고 `PUBLIC`, `anon`, `authenticated` 테이블 권한을 회수한다. 브라우저는 서버 API로 자기 횟수만 조회한다. 향후 계정 삭제 기능에는 이 UUID의 카운터 행 삭제도 포함해야 한다. 여러 계정을 만드는 우회까지 막지는 못하므로 공개 규모가 커지면 가입 남용 방지를 별도로 추가한다.

`GET /api/ai/usage`는 인증된 내 계정의 `used`, `limit`, `remaining`, `resetsAt`, `enabled`, `available`, `retryAfterSeconds`를 private/no-store로 반환한다. `available`은 앱 횟수·일시 중단·장애 대기 상태만 뜻하며 동시 슬롯, 공급자 잔여 토큰/할당량 또는 다음 호출 성공을 보장하지 않는다. 조회 실패는 503이며 0회로 바꾸지 않는다. 프로필에서 사용량을 확인·새로고침할 수 있다.

## 장애 처리

| 상황 | 응답 및 대응 |
|---|---|
| 일일/분 한도 | 429 `AI_DAILY_LIMIT` / `AI_RATE_LIMIT`, 다음 KST 날짜/분까지 대기 |
| 동시 슬롯 없음 | 429 `AI_BUSY`, 10초 뒤 수동 재시도 |
| Gemini/Ollama 429 | 429 `AI_QUOTA_EXCEEDED`, 공급자 Retry-After 적용; 없으면 60초 |
| Gemini 400/401/403/404 | 503 `AI_CONFIGURATION_ERROR`, 5분간 같은 범위의 호출 중단, 관리자 설정 확인 |
| 공급자 5xx/통신 장애 | 503, 30초간 같은 범위의 새 호출 중단 |
| Gemini 45초 제한 | 504 `AI_TIMEOUT`, 15초간 새 호출 대기 |
| 불완전·차단·빈 생성 결과 | 502, 저장하지 않음; 입력별 문제일 수 있어 전체 장애로 처리하지 않음 |
| 사용량 DB 오류/테이블 누락 | 503 `AI_GUARD_UNAVAILABLE`, 한도를 우회하지 않고 새 전송 거부 |
| 관리자 일시 중단 | 503 `AI_DISABLED`, 기존 캐시·학습 데이터 이용 유지 |

대기는 같은 DB/사용량 스키마/공급자/범위의 모든 인스턴스와 계정에 적용한다. 자동 재시도, 유료 모델 대체, 공급자 자동 전환은 하지 않는다. 대기 시간이 지난 다음 사용자 요청이 재개를 시도한다. 대기 중 횟수를 차감하지 않는다. 쿨다운 저장 자체가 실패하면 기존 분/일 한도가 추가 요청을 제한하며 `ai_cooldown_save_failed`를 남긴다.

취소·시간 초과·통신 단절은 공급자의 처리 종료가 불확실하므로 동시 슬롯을 최대 200초 유지한다. 따라서 표시된 짧은 대기 시간 후에도 슬롯이 없어 추가로 기다릴 수 있다. 토큰을 검사하여 이전 작업이 새 작업의 슬롯을 삭제하지 못하게 한다. Ollama는 기존 PC 단일 추론 임대도 별도로 유지한다. `Retry-After`는 재시도 가능성을 보장하는 시간이 아니라 가장 이른 권장 대기 시간이다.

번역 입력·기존 결과, 가사의 완료된 배치, 대화 초안·이전 대화, 저장된 문제·답안은 오류만 표시하고 유지한다. 페이지 이탈/새로고침 후 미저장 초안까지 복원하는 기능은 아니다. 전체 요청 제한은 기존 150초를 유지한다. 서버 로그의 `ai_provider_failure`는 공급자·오류 코드·상태만 기록하며 키나 입력 내용은 기록하지 않는다.

## 적용과 운영

2026-09-15: `20260915114541_ai_usage_limits.sql`을 **tonetalk_dev에만** 적용했다. 운영 DB, Vercel 환경 변수, 배포는 변경하지 않았다. 운영에는 3단계의 `20260915081206_daily_practice.sql`과 이번 테이블 변경을 먼저 적용해야 한다. 마이그레이션의 대상 배열을 `['tonetalk_prod']`로 좁혀 검토·적용하고 RLS·권한을 확인한 뒤 앱을 배포한다. 기존 테이블을 삭제하거나 legacy Drizzle 마이그레이션을 재생하지 않는다. 절차는 [DATABASE-OPERATIONS.md](DATABASE-OPERATIONS.md)를 따른다.

개발/운영이 같은 Gemini 프로젝트 또는 Ollama PC를 쓰면서 **한도까지 공유하려면**, 두 환경이 같은 PostgreSQL DB를 사용하고 `AI_USAGE_SCHEMA=tonetalk_prod`, 같은 `AI_USAGE_SCOPE`, 같은 공급자와 한도 값을 지정해야 한다. 먼저 공유 스키마의 `ai_usage_state`와 `inference_leases`가 준비되어 있어야 한다. 사용자 데이터의 `DATABASE_SCHEMA`는 계속 dev/prod로 분리한다. Ollama 하드웨어 공유의 `OLLAMA_LEASE_SCHEMA` 설정은 별도다. 설정이 없으면 개발/운영 카운터는 서로 분리된다.

범위·사용량 스키마·공급자 변경은 새 카운터를 사용하므로 중간에 바꾸면 기존 일일 사용량이 합산되지 않는다. 가능하면 KST 날짜 경계에 생성 중단 후 모든 이전 배포/요청과 200초 임대가 종료된 것을 확인하고 전환한다. 공유 중 일부 배포만 더 높은 한도를 적용하지 않는다. 범위를 새로 만들거나 행을 삭제하여 할당량을 우회하지 않는다.

장애 시 `AI_ENABLED=false`로 저장 후 재배포하면 새 AI 호출을 멈출 수 있다. 이미 진행 중인 호출은 강제로 종료하지 않는다. 배포 설정 수정만으로 즉시 모든 이전 배포가 중단되지는 않으므로 여전히 접근 가능한 이전 배포도 확인한다. 롤백은 이전 앱으로 가능하지만 제한 기능도 사라지므로 신중히 판단하고, 새 테이블을 급히 삭제하지 않는다.

## 검증

실제 공급자를 호출하거나 요금을 발생시키지 않고 전송 오류를 모의 주입했다. DB 테스트는 `tonetalk_dev`에서 고유 테스트 범위·UUID만 사용하고 그 행만 정리한다.

```sh
AI_USAGE_DB_TEST=1 DAILY_PRACTICE_DB_TEST=1 STUDY_POINTS_DB_TEST=1 BOOTSTRAP_DB_TEST=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run tests/ai-usage-db.test.ts tests/daily-practice-db.test.ts tests/study-points-db.test.ts tests/bootstrap-db.test.ts
```

동시 승인/거부, 계정/전체 한도, DB 기준 KST 날짜·분 초기화, 공급자 공통 대기/재개, 타임아웃 임대 유지, 취소/일시 중단, 공유 스키마, DB 오류 시 차단, RLS·권한과 기존 학습 저장 회귀를 검증한다. 별도 단위 테스트는 Gemini 오류 분류·재시도 없음·Retry-After, 인증된 사용량 조회와 공통 화면 오류 안내를 확인한다.

Supabase Advisor 확인에서 새 테이블의 `RLS enabled / no policy` INFO는 브라우저 접근을 열지 않는 설계상 의도된 상태다. 기존 Auth의 [유출 비밀번호 보호 비활성 경고](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)는 남아 있으며 이번 AI 제한 작업에서 인증 설정을 변경하지 않았다.
