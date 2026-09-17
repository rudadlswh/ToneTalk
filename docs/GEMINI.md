# Gemini 무료 등급 테스트

서버 환경 변수: AI_PROVIDER=gemini, GEMINI_MODEL=gemini-3.1-flash-lite,
GEMINI_API_KEY(비밀 값). 로컬은 .env.local 변경 후 개발 서버를 재시작한다.
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
