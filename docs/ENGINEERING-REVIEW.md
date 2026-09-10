# ToneTalk 엔지니어링 검토 — 2026-09-09

## 범위와 한계

현재 작업 트리의 서버·API·클라이언트 데이터 흐름을 오프라인으로 검토했다. 기존 미커밋 변경은 유지했다. 운영 환경 변수, 활성 DB 권한, 실제 회원가입, 부하 테스트는 확인하지 않았다. 모든 의존성·생성 파일을 전수 감사한 결과는 아니다.

## 아키텍처와 데이터 흐름

브라우저 → Next.js Route Handler → Supabase getUser 인증 및 Origin 검사 → Auth UUID 기반 owner → Drizzle/pg → Supabase PostgreSQL.

번역은 사용자별 캐시 확인 → DB 기반 추론 임대 획득 → Ollama 요청 → 응답 스키마 검사 → 캐시 기록 → 번역 세션과 어투별 결과를 트랜잭션으로 저장한다. 클라이언트는 React 텍스트로 결과를 렌더링한다. TTS는 브라우저 음성이 우선이며 서버 대체 기능은 macOS 전용이다.

DB 연결은 privileged connection이므로 사용자별 접근 제어는 DAL의 owner 조건에 의존한다. dev/prod 스키마 분리는 물리적 자원 분리가 아니다.

## 우선순위와 개선 전략

| 우선순위 | 구간 | 문제 / 전략 | 상태·기대 효과 |
|---|---|---|---|
| P1 운영 확인 | password-auth.ts / Supabase 설정 | synthetic email 방식 회원가입이 실제 provider에서 허용되는지 확인. 네임스페이스 변경은 기존 계정 호환성 검토 후 수행 | 미검증. mock 성공만으로 출시 가능 판정 불가 |
| P2 정확성 | translate-workspace.tsx toggleSave | 오래된 응답이 새 세션을 덮음. 현재 세션 ID를 검사하는 functional updater 사용 | 수정·회귀 테스트 추가. 새 번역과 언어 변경 상태 유지 |
| P2 정확성 | server/study.ts 복습 갱신 | 트랜잭션 밖에서 진행 상태를 읽어 동시 요청이 같은 이전 상태로 계산 가능 | 부모 저장 문장을 잠그고 같은 트랜잭션에서 읽기·계산·쓰기. 첫 진행 생성도 포함한 실제 DB 동시성 테스트 필요 |
| P2 정확성 | saved-workspace.tsx 삭제 실패 | 이전 목록 전체로 복원하면 더 최신 조회·삭제를 덮을 수 있음 | 실패 시 현재 검색 조건으로 재조회. 병렬 삭제·필터 변경 테스트 필요 |
| P3 보안 | server/tts.ts | 사용자 text가 native 옵션으로 해석될 가능성 | stdin 또는 검증된 옵션 종료 구분자 사용. 인증된 macOS 노출 환경 조건부; Vercel Linux에서는 해당 실행 불가 |
| P3 보안 | TTS/Profile/Saved/Review API | request.json 전에 스트림 바이트 제한 없음 | 기존 readLimitedJson 재사용, 잘못된 JSON 400·초과 413. 실제 ingress 제한에 따라 영향 제한 |
| P3 유지보수 | Drizzle/Compose/문서 | legacy public 마이그레이션과 private 스키마 운영 절차, TLS 설정 불일치 | 현재 지원하는 초기화·업그레이드 경로를 하나로 문서화하고 빈 DB에서 검증 |
| P3 성능 | owner/Profile/Auth | 반복 owner INSERT, Auth 검증 왕복, max=2 풀에서 여러 조회 대기 | 단계별 시간 측정 후 기존 owner 조회 경량화·집계 병합 검토. 검증되지 않은 세션으로 인증 대체 금지 |
| P3 용량 | inference-limit.ts | 임대는 스키마별이므로 dev/prod가 같은 PC를 쓰면 동시에 추론 가능 | 동일 하드웨어 사용 여부 확인 후 전역 admission 설계. 환경 분리 동작을 무심코 변경하지 않음 |
| P3 중복 | ollama.ts / toast 처리 | 유사한 전송·오류 처리와 타이머 중복 | 프로토콜 동작 유지하는 작은 공통 함수만 추출. benchmark 스크립트의 함수 소스 추출 의존성도 함께 제거 |

P1/P2는 엔지니어링 작업 우선순위이며 보안 심각도와 다르다. Codex Security 보고서의 보안 이슈는 Low 2건이다. 실제 파일 유출 또는 부하 공격은 실행하지 않았다.

## 이번 개선 코드

`src/lib/translation-session-state.ts`의 `updateSessionBookmark`를 저장·저장 취소 양쪽에서 사용한다.

```ts
setSession((current) =>
  updateSessionBookmark(current, session.id, variantId, data.savedPhraseId),
);
```

현재 세션이 null 또는 다른 ID이면 원래 참조를 그대로 반환한다. 같은 세션일 때만 최신 상태의 대상 variant를 변경한다. API 계약·저장 동작·화면 구성은 바꾸지 않는다.

## 검증과 후속 작업

추가 테스트: 세션 초기화 후 늦은 응답, 새 세션 이후 늦은 응답, 최신 상태 보존, 저장/취소 및 원본 불변성.

보안 수정과 DB 동시성 수정은 아직 적용하지 않았다. 운영 데이터나 권한을 변경하지 않았다. 실제 브라우저 재현, DB 동시성, 회원가입 통합 테스트가 남아 있다. CPU 추론 시간이 주 병목인 환경에서 이 클라이언트 수정이 번역 시간을 줄인다는 주장은 하지 않는다.
