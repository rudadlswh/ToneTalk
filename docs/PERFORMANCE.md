# 성능 개선 — 2026-09-09

## 1. 실제 환경

Windows Ryzen 7 4700U, RAM 16GB(사용자 확인), Ollama 0.33.1. 로컬 환경에 설정된 모델은 `qwen2.5:14b`였다. Vercel 모델 환경 변수는 변경하지 않았다.

`/api/ps` 보고값: context 4096에서 1.5B 약 1.09GiB, 14B 약 9.24GiB. 모두 `size_vram=0`으로 CPU 추론이다. 이는 Windows 전체 메모리 사용량이나 프로세스 RSS가 아니다. **실제 스와핑은 미확인**이다. PC에서 추론 중 `scripts/ollama-diagnostics.ps1`을 여러 번 실행해 Available RAM, PagesInputPerSecond, PageReadsPerSecond와 페이지 파일 사용량을 함께 확인해야 한다.

## 2. 모델 비교

`Could you help me?` → 일본어 5개 어투 + 로마자·한글 발음. 한 번에 한 모델씩 cold/warm 각 1회 실행하고 측정 후 언로드했다. 한 문장 탐색 실험이므로 전 언어 품질 평가나 p95가 아니다.

| 조건 | 모델 | Cold | Warm | 생성 속도 |
|---|---|---:|---:|---:|
| 기존 JSON, context 2048 | 1.5B | 16.47초 | 14.68초 | 약 30 token/s |
| 기존 JSON, context 2048 | 14B | 131.03초 | 80.50초 | 약 3.8 token/s |
| JSON Schema, context 4096 | 1.5B | 19.15초 | 13.99초 | 약 29.5 token/s |
| JSON Schema, context 4096 | 14B | 136.02초 | 83.31초 | 약 3.7 token/s |

두 모델 모두 기존 JSON에서는 한글 발음 칸에 로마자를 출력했다. Schema 적용 후 한글 형식은 통과했지만, 예를 들어 `手伝ってくれる？`의 발음을 `tetsudai te kuru?`/`처다이 거루?`로 잘못 표기했다. 1.5B는 화자 반전, 같은 표현을 모든 어투에 반복하는 오류도 보였다. **형식 제약은 번역·발음 정확도를 보장하지 않는다. 기본 모델은 교체하지 않았다.** 새로운 문장의 첫 번역이 수 초 이내에 완료된다고 보장할 수 없다.

재현: `node --env-file=.env.local scripts/benchmark-ollama.mjs`. 모델 이름을 인자로 주면 해당 설치 모델만 실행한다. 새 모델을 다운로드하지 않는다. 운영 요청이 없는 시간에 실행할 것. `BENCH_LEGACY_JSON=1`은 JSON 비교용이지만 현재 스크립트 context는 4096으로 초기 2048 실험과 구분해야 한다.

## 3. 동시 추론과 전체 시간 제한

- Translate, Study Chat, Lyrics(상세 해설 포함)에 전체 **150초** 제한. 본문 읽기, DB 대기, 추론, 저장을 포함하며 Vercel maxDuration 180초보다 짧다.
- 요청별 AbortSignal을 전달한다. Translate에서 페이지를 떠나거나 언어를 바꾸면 요청도 취소한다. 크기를 제한하며 본문을 읽고, 취소 시 reader도 닫는다.
- PostgreSQL `inference_leases`의 원자적 UPSERT로 **동일 DB 스키마를 사용하는 Vercel 인스턴스 전체에서 1건**만 추론한다. 추론 중 DB 연결/트랜잭션은 점유하지 않는다.
- 초과 요청은 429 `AI_BUSY`, `Retry-After: 10`으로 안내한다. 서버 내부에 긴 대기열을 만들지 않는다.
- 정상 완료는 본인 토큰의 lease만 해제한다. 취소·통신 장애는 upstream 종료가 불확실하므로 최대 200초 만료까지 유지한다. 브라우저 취소가 실제 PC 계산 중단을 보장하지는 않는다.
- 형식 오류의 숨은 자동 재시도를 제거했다. 재시도는 사용자가 명시적으로 한다.
- DB statement timeout 8초/query timeout 10초. 기존 pool max 2/idle 5초/TLS 검증 유지.
- 보조적인 프로세스별 IP 제한은 최대 1000개 bucket으로 메모리를 제한한다. 전역 사용자별 quota는 아니다.

### Windows에서 남은 수동 적용

원격 PC 환경 변수는 아직 변경하지 않았다. `scripts/configure-ollama.ps1` 또는 아래 명령 실행 후 **Ollama 완전 종료 → 시작 메뉴에서 재실행**한다.

```powershell
[Environment]::SetEnvironmentVariable('OLLAMA_NUM_PARALLEL', '1', 'User')
[Environment]::SetEnvironmentVariable('OLLAMA_MAX_LOADED_MODELS', '1', 'User')
[Environment]::SetEnvironmentVariable('OLLAMA_MAX_QUEUE', '1', 'User')
```

dev/prod lease는 분리되어 있다. 두 환경이나 다른 클라이언트까지 포함한 PC 전체 추론 제한은 이 설정이 담당한다. [Ollama 공식 문서](https://docs.ollama.com/faq)

## 4. 반복 번역 캐시

일반 Translate 결과를 PostgreSQL `translation_cache`에 저장한다. Lyrics/Chat 캐시는 이번 범위에 포함하지 않았다.

- 키: 프롬프트/검증 버전, Ollama 주소·모델, owner, trim한 원문, 입력 언어(auto 포함), 대상 언어의 SHA-256.
- TTL 7일, 스키마당 최근 최대 1000개. 저장 시 만료·초과 **캐시만** 정리한다. 사용자 번역·저장 기록은 삭제하지 않는다.
- 조회 시에도 Zod 검증. 실패·취소·형식 오류는 저장하지 않는다. 의미/발음 정확성까지 자동 검증하는 것은 아니다.
- hit는 추론 슬롯과 AI 호출을 건너뛴다. 새 session/variant ID를 만들어 다른 요청의 저장 ID를 재사용하지 않는다.
- DTO `cacheHit`로 UI에 재사용을 표시한다. hit의 `latencyMs=0`은 추론 미실행이지 HTTP 전체 시간이 아니다.
- 동일 모델 태그의 내용을 덮어썼다면 캐시 버전을 올리거나 캐시를 비워야 한다. 모델 이름 변경은 자동 분리된다.

## 5–6. Profile / Study / 렌더링

| 경로 | 기존 SQL 왕복 | 변경 후(최초 owner 생성 제외) |
|---|---:|---:|
| Translate 기본 설정 | 전체 Profile 약 10회 | `/api/settings` 1회 |
| Profile | 약 10회 | 3회 |
| Study 목록 + 요약 | 약 9회 | 2회 |
| Study 요약 | owner 생성 + 6회 | 집계 1회 |

owner 생성은 인스턴스당 한 번이며 동시 초기화를 합친다. 인증 캐시가 아니며 이메일 로그인 도입 시 resolver를 교체해야 한다. Profile/Health는 독립 로딩하여 Ollama 장애가 프로필 편집 화면을 막지 않는다. 늦은 기본 설정 응답이 사용자의 언어 선택을 덮어쓰지 않는다.

Study 통계는 한 번의 JOIN으로 집계하고 복습 이벤트는 DB에서 한국 시간 기준 날짜별로 묶는다. 기존 370일 스트릭 조회 창은 유지한다. 기본 예문 퀴즈/퍼즐에서는 저장 API를 호출하지 않고, 저장 문장 선택 시에만 조회한다. 퍼즐 후보는 useMemo, Segmenter는 지원 언어별 재사용, Saved 날짜 formatter는 모듈에서 재사용한다.

## 검증

- 단위·경로 테스트 71개 통과. 기본 실행에서 skip되는 실제 DB 테스트 3개도 별도 실행에서 통과.
- 실제 개발 DB에 임시 소유자/데이터를 만들고 집계·한국 시간 날짜 경계·캐시 만료·10개 요청 중 단일 추론 진입을 검증했다. 임시 데이터는 삭제했다.
- 개발 DB에서 집계 함수 31ms, cache 조회 21ms(각 1회 관측).
- production build를 localhost:3100에서 실행하고 Supabase 개발 DB로 GET 각 3회 확인: warm 설정 약 20ms, Profile 약 40ms, Study 약 30ms.
- **Vercel 운영 p95 또는 배포 전후 비교가 아니다.** 운영 배포 후 동일 조건으로 다시 측정해야 한다.
- lint, TypeScript, production build 통과. 실제 LLM 품질 한계는 위에 별도 기록했다.

```bash
pnpm test:run
pnpm lint
pnpm build
PERF_DB_TEST=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run tests/performance-db.test.ts --disableConsoleIntercept
```

## DB 변경 및 배포 상태

`supabase/migrations/20260908151431_performance_runtime.sql`은 기존 두 스키마에 runtime 테이블 두 개씩만 추가하는 멱등 SQL이며 적용·검증했다. CLI로 파일을 생성하고 execute_sql로 적용했다. 로컬 Supabase stack이 없어 db pull은 실행하지 않았고 원격 migration history 등록은 하지 않았다.

기존 Drizzle snapshot은 `public` 기반의 이전 로컬 DB 이력이므로 자동 schema diff로 재생성하지 않았다. 이 SQL을 기존 테이블을 재생성하는 마이그레이션과 혼용하지 않는다.

runtime 테이블은 RLS 활성화 및 PUBLIC/anon/authenticated 권한 회수 상태이다. PostgreSQL 서버 역할만 사용한다. Advisor의 'RLS enabled no policy' INFO는 의도적인 클라이언트 접근 금지 상태다. [관련 설명](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)

앱의 Vercel 배포, git commit/push, PC 설정 적용은 하지 않았다. 기존 미커밋 가사 기능 변경은 그대로 보존했다.
