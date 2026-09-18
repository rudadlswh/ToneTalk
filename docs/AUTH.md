# 이메일 로그인과 사용자 데이터 분리

## 대회 게스트 모드

심사 기간에는 Supabase Authentication → Providers에서 **Anonymous Sign-Ins**를 활성화하고 Vercel Production에 `GUEST_MODE=true`를 설정한 뒤 재배포한다. 방문자는 입력 없이 익명 세션을 발급받으며 각 브라우저마다 별도의 Auth UUID와 학습 데이터를 사용한다. 기존 회원 세션은 게스트 모드에서 사용하지 않으며 로그인·회원가입 API도 차단한다. 프로필에는 `게스트 체험`과 `로그인 없이 체험 중`을 표시한다.

심사 종료 후 Vercel의 `GUEST_MODE=false`로 변경해 재배포하면 기존 로그인 방식으로 돌아간다. 필요하면 Supabase에서 Anonymous Sign-Ins도 비활성화한다. 익명 사용자는 브라우저 데이터를 지우거나 다른 기기를 사용하면 기존 기록을 다시 찾을 수 없다. 운영 종료 후 Supabase Auth의 익명 사용자와 연결된 앱 데이터를 정리하는 작업은 별도로 수행한다.

## 구현 범위

- `/login`: 이메일 로그인 링크 발송. 처음 로그인하는 이메일은 Supabase Auth 계정 생성.
- `POST /api/auth/login`: PKCE 로그인 요청, 주소/크기 검증, 메일·IP별 보조 요청 제한.
- `GET /auth/callback`: `code`를 세션으로 교환하고 허용된 내부 페이지로만 이동. 토큰/원본 인증 오류는 로그에 남기지 않음.
- `/auth/complete`: 다른 탭에 계정 변경 알림 후 문서 전체 이동.
- `POST /api/auth/logout`: 현재 세션 로그아웃. 실패를 성공으로 표시하지 않음.
- `GET /api/auth/session`: 검증된 사용자 ID·이메일 조회(로그인 필수).
- 모든 기존 `/api/*` 경로(health/tts/lyrics/chat 포함)는 `withAuth`로 보호. 직접 호출도 401, 외부/누락 Origin 변경 요청은 403.
- 세션은 HttpOnly/SameSite=Lax 쿠키, 운영 HTTPS에서는 Secure. 브라우저 localStorage에 인증 토큰을 두지 않음.
- Proxy는 페이지 쿠키 갱신만 담당. 페이지와 API는 `getUser()`로 별도 검증, 미확인 이메일/익명 사용자 거부.
- 로그인/로그아웃은 전체 문서 이동. 다른 탭의 계정 변경과 포커스 복귀, BFCache 복귀 시 이전 계정 화면을 재검증/초기화.

## 데이터 경계

`app_users.id = auth user UUID`를 사용하며 별도 DB 마이그레이션은 없다. 저장·조회·삭제·복습·프로필·설정은 서버에서 확인한 owner만 사용한다. 요청 body/query/header의 owner는 신뢰하지 않는다. 번역 캐시 키도 owner별로 다르다.

공용 `single-user` 데이터는 그대로 보존한다. 새 계정에 자동 귀속하지 않으며 이메일 일치로 병합하지 않는다. 기존 기록을 옮기려면 대상 Auth UUID를 확인하고 별도 승인된 이전 작업이 필요하다.

앱 테이블은 `tonetalk_dev`/`tonetalk_prod` private schema에 있고 RLS 활성/anon·authenticated 권한 없음 상태를 유지한다. **서버의 postgres 연결은 RLS를 우회하므로 이 구조의 사용자별 접근 제어는 DAL에서 수행한다.** 브라우저용 테이블 권한을 추가하지 않는다. 향후 직접 Data API를 사용하면 별도 소유권 RLS 정책 설계가 필요하다.

이메일은 Supabase Auth가 원본이며 Profile 응답도 검증된 Auth 이메일을 사용한다. `app_users.email`은 기존 컬럼만 유지하고 새 계정 생성/매핑에는 사용하지 않는다. 비밀번호를 앱 DB에 저장하지 않는다.

동일 Supabase 프로젝트의 dev/prod 스키마는 데이터만 분리한다. Auth 계정과 메일 설정은 공유된다. 완전한 인증 환경 분리는 별도 프로젝트가 필요하다.

## 배포 전 필수 설정

1. 로컬 `.env.local`과 Vercel 해당 배포 환경에 설정:

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=https://qsxqnpyrjcbtvjvglqrq.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=프로젝트의_sb_publishable_키
   ```

   secret/service_role 키는 절대 넣지 않는다. `SINGLE_USER_ID`는 무시되며 인증 없이 동작하는 fallback은 없다. `DATABASE_SCHEMA`는 로컬 dev / 운영 prod 유지.

2. Supabase Authentication → URL Configuration:
   - Site URL: 실제 운영 도메인.
   - Redirect URLs: `http://localhost:3000/auth/callback`, 실제 운영 도메인의 `/auth/callback`.
   - 테스트 포트/Preview를 사용하면 해당 정확한 callback URL도 추가. 불필요한 전체 도메인 wildcard는 사용하지 않음.
   - 기본 메일 템플릿의 `ConfirmationURL`을 그대로 사용할 수 있는 PKCE callback 방식. 요청한 기기/브라우저에서 메일 링크를 열어야 함.

3. Email provider 활성화 및 메일 발송 설정:
   - Supabase 기본 SMTP는 조직 멤버 주소만 허용하며 일반 참가자에게 발송할 수 없음.
   - 외부 사용자에게 이메일을 보내려면 사용자 소유의 SMTP 공급자/발신 도메인을 설정해야 함.
   - 앱의 발송 제한은 인스턴스별 보조 제한. Supabase Auth의 프로젝트별 발송 제한을 유지하며 공개 서비스 확대 시 CAPTCHA/공유 rate-limit 추가.

4. Vercel 재배포 후 확인. `/api/health`도 인증 필수이므로 쿠키 없는 모니터링 요청은 401이 정상.

## 검증

```bash
pnpm test:run
pnpm lint
pnpm build
# 임시 두 사용자 데이터만 생성하고 종료 시 정리. 운영 스키마 거부.
AUTH_DB_TEST=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run tests/auth-isolation-db.test.ts --disableConsoleIntercept
```

단위 테스트: 미인증/익명/미확인 이메일/위조 헤더 거부, 인증 장애 503, 동일 프로세스의 동시 A/B 요청 격리, 요청별 bootstrap 중복 제거, CSRF Origin, 모든 앱 API의 인증 누락 방지.

DB 통합 테스트: 검증된 Auth 응답만 stub하고 실제 API·DAL·개발 DB로 A/B 프로필과 설정·문장 목록·복습 통계 분리, 타인 variant 저장/삭제/복습 404, owner 입력 변조 무효, 캐시 키 분리를 검증. 테스트 사용자 데이터는 정리한다. **이 테스트는 실제 메일 수신/토큰 발급을 대체하지 않는다.**

실제 운영 수동 확인:

1. Chrome A 계정과 Safari B 계정으로 각각 이메일 링크 로그인.
2. A가 저장한 문장이 B의 Saved/Study/Profile 통계에 나타나지 않는지 확인.
3. A가 로그아웃한 뒤 같은 브라우저에서 B로 로그인했을 때 이전 결과가 남지 않는지 확인.
4. 만료된 링크/다른 브라우저 링크에는 재요청 안내, 세션 만료 API에는 401, 다른 탭 로그아웃·뒤로가기 시 이전 계정 화면 재검증 확인.
5. 비로그인 직접 API 호출, 타인 문장 ID의 저장/삭제/복습 요청 거부 확인.

운영 배포·SMTP·실제 두 이메일 로그인은 코드 테스트와 별도로 완료해야 한다.

## 참고

- https://supabase.com/docs/guides/auth/server-side/creating-a-client
- https://supabase.com/docs/guides/auth/sessions/pkce-flow
- https://supabase.com/docs/guides/auth/auth-smtp
- https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier
