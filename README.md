# ToneTalk

한 문장을 상황에 맞는 다섯 가지 말투로 번역하고, 유용한 표현을 저장·검색하는 로컬 AI 언어 학습 웹 앱입니다.

현재 MVP는 단일 사용자로 동작하지만, 모든 데이터에 `owner_id`가 포함되어 있어 이메일 로그인 도입 시 기존 구조를 유지할 수 있습니다. 외부 AI API를 사용하지 않고 사설망의 Ollama만 서버에서 호출합니다.

## 구현된 핵심 기능

- 영어 원문을 일본어·한국어·프랑스어·스페인어·중국어·독일어로 번역
- Casual, Polite, Formal, Slang, Written 5개 톤 동시 생성
- 구조화 모델 출력 검증과 잘못된 출력 1회 자동 재시도
- 한국어·일본어·중국어 결과의 대상 문자 검증
- 톤별 복사, 저장, 저장 취소
- 저장 문장 검색, 언어 필터, 복사, 삭제
- 저장 문장 기반 플래시카드 복습과 4단계 자기 평가
- 간격 반복 일정, 오늘의 목표, 연속 학습일, 익힌 표현 통계
- 표시 이름·기본 번역 언어·하루 복습 목표 설정
- PostgreSQL·Ollama 연결 상태를 보여주는 로컬 프로필
- 모바일 하단 내비게이션과 데스크톱 사이드 내비게이션
- PostgreSQL 영속 저장과 버전 관리 마이그레이션
- Ollama·DB 상태 확인, 번역 요청 제한, 표준 오류 응답
- 번역 계약·요청 제한·복습 일정·프로필 입력 자동 테스트

## 기술 선택

| 영역 | 기술 | 선택 이유 |
|---|---|---|
| 풀스택 | Next.js 16 App Router, React 19, TypeScript | UI와 BFF를 한 서버로 배포하고 Ollama·DB를 브라우저에서 격리 |
| UI | Tailwind CSS 기반 토큰, Lucide Icons | 반응형·접근 가능한 UI를 작은 의존성으로 구성 |
| DB | PostgreSQL 16, Drizzle ORM | 관계·중복 제약, 검색·정렬, 향후 사용자 소유권을 명확히 관리 |
| 검증 | Zod | 브라우저 입력과 모델 JSON을 동일한 계약으로 검증 |
| LLM | Ollama, `qwen2.5:14b` | 설치된 작은 모델의 의미 보존 실패를 확인해 정확도를 우선 |
| 테스트 | Vitest | 핵심 도메인 계약을 빠르게 회귀 검증 |

14B 모델은 콜드 스타트와 하드웨어에 따라 20~90초가 걸릴 수 있습니다. 빠른 개발 확인은 `.env.local`의 `OLLAMA_MODEL`을 `qwen2.5-coder:3b`로 바꿀 수 있지만 번역 정확도는 낮아집니다.

## 시스템 아키텍처

```text
Browser
  ├─ Translate UI
  └─ Saved UI
        │ same-origin HTTP
        ▼
Next.js Route Handlers
  ├─ Zod input validation
  ├─ in-process rate limit
  ├─ Translation service ──▶ Ollama 192.168.45.140:11434
  ├─ Study scheduler
  └─ Data Access Layer ────▶ PostgreSQL
```

- 클라이언트에는 DB 연결 문자열과 Ollama 주소가 전달되지 않습니다.
- Ollama 응답은 JSON 파싱, Zod 스키마, 대상 문자 검증을 모두 통과해야 저장됩니다.
- 모델이 생성하지 않아도 되는 한국어 사용 맥락과 Slang 주의 문구는 앱에서 일관되게 제공합니다.
- DB와 Ollama 중 하나가 실패해도 표준 오류 코드와 재시도 가능 여부를 반환합니다.

상세 설계는 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)를 참고하세요.

## 파일 구조

```text
tonetalk/
├── compose.yaml                 # 로컬 PostgreSQL
├── drizzle.config.ts            # 마이그레이션 설정
├── drizzle/                     # 버전 관리 SQL 마이그레이션
├── docs/
│   └── ARCHITECTURE.md
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── health/
│   │   │   ├── profile/
│   │   │   ├── translations/
│   │   │   ├── study/
│   │   │   └── saved-phrases/
│   │   ├── profile/
│   │   ├── saved/
│   │   ├── study/
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   │   ├── app-shell.tsx
│   │   ├── profile-workspace.tsx
│   │   ├── translate-workspace.tsx
│   │   ├── study-workspace.tsx
│   │   └── saved-workspace.tsx
│   ├── db/
│   │   └── schema.ts
│   ├── lib/
│   │   ├── api.ts
│   │   ├── dto.ts
│   │   ├── languages.ts
│   │   └── translation-contract.ts
│   └── server/
│       ├── db.ts
│       ├── env.ts
│       ├── ollama.ts
│       ├── owner.ts
│       ├── rate-limit.ts
│       ├── saved-phrases.ts
│       └── translations.ts
└── tests/
```

## 데이터베이스 스키마

```text
app_users
  id PK
  email UNIQUE NULL
  display_name, default_target_language, daily_study_goal
  created_at, updated_at

translation_sessions
  id PK
  owner_id FK -> app_users.id
  source_text, source_language, target_language
  status, model, latency_ms, created_at

translation_variants
  id PK
  session_id FK -> translation_sessions.id
  tone, translated_text, transliteration
  context_note, warning, position, created_at
  UNIQUE(session_id, tone)

saved_phrases
  id PK
  owner_id FK -> app_users.id
  variant_id FK -> translation_variants.id
  created_at
  UNIQUE(owner_id, variant_id)

study_progress
  id PK
  owner_id FK -> app_users.id
  saved_phrase_id FK -> saved_phrases.id UNIQUE
  repetitions, interval_days, ease_percent, review_count
  last_reviewed_at, next_review_at, created_at, updated_at

study_review_events
  id PK
  owner_id FK -> app_users.id
  saved_phrase_id FK -> saved_phrases.id
  rating, reviewed_at
```

초기 사용자는 `SINGLE_USER_ID=single-user`로 자동 생성됩니다. 이메일 로그인 도입 시 `getCurrentOwnerId()`만 인증 세션 기반으로 교체하고 기존 DAL의 `owner_id` 조건을 그대로 사용합니다.

## API 엔드포인트

| Method | Endpoint | 설명 |
|---|---|---|
| `GET` | `/api/health` | PostgreSQL과 설정된 Ollama 모델 상태 |
| `POST` | `/api/translations` | 5톤 번역 생성 및 저장 |
| `GET` | `/api/saved-phrases?q=&language=&limit=` | 저장 문장 검색·필터 |
| `POST` | `/api/saved-phrases` | 특정 번역 variant 저장 |
| `DELETE` | `/api/saved-phrases/:id` | 소유자 범위에서 저장 삭제 |
| `GET` | `/api/study?limit=` | 오늘 복습할 카드와 학습 요약 |
| `POST` | `/api/study/reviews` | 자기 평가 기록과 다음 복습일 계산 |
| `GET` | `/api/profile` | 사용자 설정과 학습 통계 |
| `PATCH` | `/api/profile` | 표시 이름·기본 언어·하루 목표 변경 |

### 번역 요청

```json
{
  "sourceText": "How are you?",
  "targetLanguage": "ja"
}
```

### 공통 오류

```json
{
  "requestId": "...",
  "error": {
    "code": "OLLAMA_UNAVAILABLE",
    "message": "로컬 번역 모델에 연결할 수 없습니다.",
    "retryable": true
  }
}
```

## UI 구조

### Translate `/`

- 대상 언어 6개 선택
- 500자 원문 입력과 예문
- 로딩 스켈레톤, 오류 배너
- 5개 톤 결과 카드
- 복사·저장·저장 취소
- 데스크톱 입력/결과 2열, 모바일 단일 열

### Saved `/saved`

- 원문·번역문 검색
- 대상 언어 필터
- 저장 카드 목록
- 복사·삭제와 빈 상태

### Study `/study`

- 저장 표현의 원문을 먼저 보여주는 플래시카드
- 정답 공개 후 `다시·어려움·좋음·쉬움` 자기 평가
- 평가에 따른 다음 복습 일정 자동 계산
- 오늘의 목표, 복습 대기 수, 익힌 표현, 연속 학습일

### Profile `/profile`

- 번역·저장·학습 통계
- 표시 이름, 기본 번역 언어, 하루 복습 목표 설정
- PostgreSQL과 Ollama 연결 상태
- 단일 사용자와 로컬 데이터 처리 안내

## 실행 방법

### 1. 환경 변수

```bash
cp .env.example .env.local
```

기본값은 다음 Ollama 서버와 모델을 사용합니다.

```text
OLLAMA_BASE_URL=http://192.168.45.140:11434
OLLAMA_MODEL=qwen2.5:14b
```

### 2. PostgreSQL

Docker Desktop이 실행 중이라면:

```bash
docker compose up -d postgres
```

이미 PostgreSQL이 있다면 `DATABASE_URL`에 별도 DB를 지정합니다.

### 3. 설치와 마이그레이션

```bash
pnpm install
pnpm db:migrate
```

### 4. 개발 서버

```bash
pnpm dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000)을 엽니다.

## 검증 명령

```bash
pnpm lint
pnpm test:run
pnpm build
curl http://localhost:3000/api/health
```

## 현재 MVP 제약과 다음 단계

1. 단일 Node 프로세스용 요청 제한을 Redis 기반 분산 제한으로 교체
2. 이메일 인증 도입 후 `owner_id`를 실제 사용자 세션으로 연결
3. 번역 평가셋을 추가해 모델·프롬프트 변경 시 의미 보존 회귀 테스트
4. 발음 표기는 DB와 UI 필드만 준비되어 있으며, 현재 모델 지연을 줄이기 위해 생성하지 않음
5. 저장·복습 목록을 커서 페이지네이션과 PostgreSQL 다국어 검색 인덱스로 확장
6. 운영 배포 시 TLS, 비밀 관리, DB 백업, Ollama 네트워크 접근 제어 적용
