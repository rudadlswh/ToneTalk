# Gemini 무료 등급 테스트

서버 환경 변수: AI_PROVIDER=gemini, GEMINI_MODEL=gemini-3.1-flash-lite,
GEMINI_API_KEY(비밀 값). 로컬은 .env.local 변경 후 개발 서버를 재시작한다.

키 분산과 자동 전환이 필요하면 `GEMINI_API_KEYS=키1,키2`를 서버 환경 변수로 등록한다. 요청 ID를 기준으로 시작 키를 고르게 분산하고, 선택된 키가 401·403·API 키 관련 400·429를 반환하면 다음 키로 전환한다. 최대 5개까지 지원한다. 5xx와 네트워크 오류는 첫 요청이 이미 처리됐을 가능성이 있어 자동 재전송하지 않는다. Gemini 할당량은 키가 아니라 프로젝트 단위이므로 실제 할당량 분산을 위해서는 키를 서로 다른 Google Cloud 프로젝트에서 발급해야 한다. 같은 프로젝트의 키 두 개는 요청 경로만 나뉘고 할당량은 공유한다. `GEMINI_API_KEYS`가 있으면 기존 `GEMINI_API_KEY`보다 우선한다. 키 값은 브라우저에 노출되는 `NEXT_PUBLIC_` 변수에 넣지 않는다.

Vercel Runtime Logs의 `gemini_usage` 이벤트는 요청 ID, 모델, 비밀 값이 아닌 키 순번(`keySlot`), 입력·캐시·출력·사고·총 토큰, 처리 시간을 기록한다. `gemini_key_failover`는 실패 키 순번과 다음 키 순번 및 HTTP 상태만 기록한다. Gemini GenerateContent 응답은 프로젝트의 정확한 잔여 토큰을 제공하지 않으므로 `remainingTokens`는 `null`, `remainingTokensReason`은 `not_provided_by_gemini_api`로 기록한다. 실제 RPM/TPM/RPD 잔여량은 Google AI Studio의 Rate limits/Usage에서 확인한다. API 키, 프롬프트, 생성 결과와 공급자 오류 본문은 로그에 기록하지 않는다.
Vercel은 해당 환경에 같은 변수를 저장한 뒤 새로 배포해야 한다.
키에 NEXT_PUBLIC_ 접두사를 붙이거나 Git에 커밋하지 않는다.

번역, 가사, 가사 해설, 롤플레이는 기존 검증을 거쳐 Gemini를 사용한다.
모델/공급자별 캐시가 분리된다. Gemini는 Ollama PC 임대를 사용하지 않는다.
대신 계정별/전체 DB 사용 한도와 공통 동시 호출 제한을 적용한다. 프로필에서 앱의 오늘 사용량을 확인할 수 있다. 기본 한도·운영 DB 적용·장애 대기는 [AI-USAGE.md](AI-USAGE.md)를 따른다.
각 호출은 45초 제한이며 자동 재시도와 모델 대체는 없다.
무료 한도 초과는 HTTP 429로 안내한다. 앱은 Google 프로젝트의 결제 상태를
제어하지 않으므로 무료 테스트 프로젝트의 결제를 활성화하지 않는다.

Health는 모델 메타데이터 접근 여부만 확인한다. 생성 성공이나 잔여 할당량을
보장하지 않는다. 무료 등급의 입력/출력은 Google 제품 개선에 사용될 수 있으므로
민감한 정보를 입력하지 않는다.

공식 요금: https://ai.google.dev/gemini-api/docs/pricing
독립 예문 테스트: node --env-file=.env.local scripts/test-gemini.mjs
Ollama 복귀: AI_PROVIDER=ollama 후 재시작/재배포.
