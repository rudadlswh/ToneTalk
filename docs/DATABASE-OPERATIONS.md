# 현재 DB 운영 절차

앱 실행 환경은 로컬 Next.js와 Vercel 모두 Supabase PostgreSQL이다. 로컬은 `DATABASE_SCHEMA=tonetalk_dev`, 운영은 `tonetalk_prod`를 사용한다. 연결은 Supabase CA를 검증하는 TLS를 유지한다. `compose.yaml`은 과거 개발용이며 현재 앱 연결 경로가 아니다. TLS 검증을 끄지 않는다.

## 새 빈 환경 초기화

`node scripts/print-db-bootstrap.mjs tonetalk_dev` 또는 `tonetalk_prod`로 SQL을 출력한다. 이 명령은 DB에 접속하지 않는다. 현재 Drizzle 스키마에서 테이블·제약·인덱스를 생성하고, 모든 테이블의 RLS를 켜며 PUBLIC/anon/authenticated 접근을 회수한다.

출력 SQL을 검토한 후 **빈 대상 스키마에서만** Supabase SQL Editor로 실행한다. 전체가 한 트랜잭션이며 기존 테이블이 있으면 실패한다. 기존 환경에 초기화 SQL을 재실행하거나 테이블을 지워 맞추지 않는다. SQL 실행 역할과 앱 연결 역할이 다르면 필요한 서버 역할 권한을 별도로 검토해야 한다. 앱은 서버의 privileged SQL과 owner 조건으로 접근하며 브라우저 Data API 접근을 열지 않는다.

검증: `BOOTSTRAP_DB_TEST=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run tests/bootstrap-db.test.ts`는 명시적 dev 연결에서 고유 이름의 임시 스키마를 만들고, 8개 테이블/RLS 확인 후 롤백한다. 2026-09-10 실제 개발 DB에서 통과했다. 전용 빈 DB 전체를 생성한 테스트는 아니다.

## 기존 환경 업그레이드

기존 `drizzle/`은 legacy public 스키마 이력이다. 현재 private 스키마에 `pnpm db:migrate`로 재생하지 않는다. 앞으로의 변경은 `supabase/migrations/`에 추가 SQL로 작성하고 dev 적용 → 스키마·회귀 테스트 → 운영 백업/복구 계획 확인 → 운영 적용 순서로 진행한다. 이번 정확성/본문 제한 변경은 DB 마이그레이션을 요구하지 않는다. 변경 SQL 적용 여부는 배포 기록에 남긴다.

## 같은 Ollama PC를 사용하는 경우

로컬 `.env.local`과 Vercel 운영 환경 모두 `OLLAMA_LEASE_SCHEMA=tonetalk_prod`로 지정한다. 두 DATABASE_URL은 **같은 PostgreSQL DB**의 해당 잠금 테이블에 접근할 수 있어야 한다. 사용자 데이터의 DATABASE_SCHEMA는 변경하지 않는다. 키 미설정 시 호환성을 위해 기존 데이터 스키마의 임대를 사용한다.

양쪽 앱을 재시작/재배포해야 한다. 전환 중 기존 dev 임대가 남아 있을 수 있으므로 추론을 멈추고 마지막 요청 종료 및 최대 200초 임대 만료를 기다린 뒤 양쪽을 전환한다. 잠금 행을 수동 삭제하지 않는다. ngrok/Ollama 자체 변경은 필요 없다. 현재 작업에서는 환경 변수나 배포를 변경하지 않았다.

## 성능 측정

인증 API 응답 `Server-Timing`의 `auth`는 검증 시간, `app`은 핸들러 시간이다. 브라우저 Network에서 콜드/웜 요청을 나누어 측정한다. 개인 정보·토큰·SQL은 헤더에 넣지 않는다. 검증된 getUser 인증과 max=2 풀은 유지한다. 반복 owner 초기화와 Profile 집계 변경은 운영 측정 후 결정하며, 측정 없는 속도 개선 수치를 제시하지 않는다.
