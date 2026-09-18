"use client";
import { useAiProvider } from "@/components/ai-provider";
import { useToast } from "@/hooks/use-toast";
import { SignOutButton } from "@/components/sign-out-button";
import { StudyPointsHistory } from "@/components/study-points-history";
import { AiUsagePanel } from "@/components/ai-usage-panel";

import { useEffect, useState } from "react";
import {
  BookMarked,
  Brain,
  Check,
  Database,
  Flame,
  Languages,
  LoaderCircle,
  LockKeyhole,
  Server,
  Sparkles,
} from "lucide-react";
import { readJson } from "@/lib/api";
import type { ProfileDto, ProfileStatsDto } from "@/lib/dto";
import { languages, type TargetLanguage } from "@/lib/languages";

type ProfileResponse = {
  profile: ProfileDto;
  stats: ProfileStatsDto;
  requestId: string;
};

type HealthResponse = {
  status: "ok" | "degraded";
  database: boolean;
  ollama: boolean;
};

export function ProfileWorkspace() {
  const provider = useAiProvider();
  const [profile, setProfile] = useState<ProfileDto | null>(null);
  const [stats, setStats] = useState<ProfileStatsDto | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [displayName, setDisplayName] = useState("");
  const [defaultLanguage, setDefaultLanguage] = useState<TargetLanguage>("ja");
  const [dailyGoal, setDailyGoal] = useState(10);
  const [memberDays, setMemberDays] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast, showToast } = useToast();

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const profileResponse = await fetch("/api/profile", { cache: "no-store", signal: controller.signal });
        const profileData = await readJson<ProfileResponse>(profileResponse);
        setProfile(profileData.profile);
        setStats(profileData.stats);
        setDisplayName(profileData.profile.displayName);
        setDefaultLanguage(profileData.profile.defaultTargetLanguage);
        setDailyGoal(profileData.profile.dailyStudyGoal);
        setMemberDays(
          Math.max(
            1,
            Math.ceil(
              (Date.now() - new Date(profileData.profile.createdAt).getTime()) /
                86_400_000,
            ),
          ),
        );
      } catch (caught) {
        if (caught instanceof Error && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : "프로필을 불러오지 못했습니다.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/health", { cache: "no-store", signal: controller.signal })
      .then((response) => response.json())
      .then((data: HealthResponse) => { if (!controller.signal.aborted) setHealth(data); })
      .catch(() => { /* Health failure must not hide editable profile settings. */ })
      .finally(() => { if (!controller.signal.aborted) setHealthLoading(false); });
    return () => controller.abort();
  }, []);

  const save = async () => {
    if (!displayName.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName,
          defaultTargetLanguage: defaultLanguage,
          dailyStudyGoal: dailyGoal,
        }),
      });
      const data = await readJson<ProfileResponse>(response);
      setProfile(data.profile);
      setStats(data.stats);
      setDisplayName(data.profile.displayName);
      showToast("학습 설정을 저장했어요.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "프로필을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="profile-loading"><LoaderCircle className="spin" size={30} /><span>프로필을 불러오고 있어요</span></div>;
  }

  if (!profile || !stats) {
    return <div className="profile-loading is-error"><span>{error ?? "프로필을 불러오지 못했습니다."}</span><SignOutButton /></div>;
  }

  const initial = profile.displayName.trim().charAt(0).toUpperCase() || "T";
  const isGuest = profile.email === "guest@users.tonetalk.invalid";

  return (
    <div className="page-wrap profile-page">
      {!isGuest && <SignOutButton />}
      <header className="page-header profile-header">
        <div>
          <span className="eyebrow">YOUR LEARNING SPACE</span>
          <h1>Profile</h1>
          <p>학습 목표와 기본 환경을 나에게 맞게 설정하세요.</p>
        </div>
      </header>

      <section className="profile-hero">
        <div className="profile-avatar">{initial}</div>
        <div className="profile-identity">
          <span className="single-user-badge"><LockKeyhole size={13} /> {isGuest ? "게스트 체험" : "개인 계정"}</span>
          <h2>{profile.displayName}</h2>
          <p>{isGuest ? "로그인 없이 체험 중" : profile.email?.replace(/@users\.tonetalk\.invalid$/, "")}</p>
        </div>
        <div className="profile-joined">함께한 지<strong>{memberDays}일</strong></div>
      </section>

      <section className="profile-stats" aria-label="학습 통계">
        <div><span className="stat-icon is-violet"><Languages size={19} /></span><strong>{stats.translationCount}</strong><small>번역</small></div>
        <div><span className="stat-icon is-coral"><BookMarked size={19} /></span><strong>{stats.savedPhraseCount}</strong><small>저장 표현</small></div>
        <div><span className="stat-icon is-green"><Brain size={19} /></span><strong>{stats.masteredCount}</strong><small>익힌 표현</small></div>
        <div><span className="stat-icon is-yellow"><Flame size={19} /></span><strong>{stats.streakDays}</strong><small>연속 학습일</small></div>
      </section>

      <StudyPointsHistory />

      <div className="profile-grid">
        <section className="settings-panel">
          <div className="panel-heading">
            <div><span className="section-label">LEARNING PREFERENCES</span><h2>학습 설정</h2></div>
            <Sparkles size={19} />
          </div>

          <label className="field-label">
            <span>표시 이름</span>
            <input value={displayName} maxLength={80} onChange={(event) => setDisplayName(event.target.value)} />
          </label>

          <fieldset className="profile-language-field">
            <legend>기본 번역 언어</legend>
            <div className="profile-language-grid">
              {languages.map((language) => (
                <button
                  type="button"
                  className={defaultLanguage === language.code ? "is-selected" : ""}
                  aria-pressed={defaultLanguage === language.code}
                  key={language.code}
                  onClick={() => setDefaultLanguage(language.code)}
                >
                  <span>{language.flag}</span>{language.name}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="goal-field">
            <span><strong>하루 복습 목표</strong><small>매일 학습할 카드 수</small></span>
            <span className="goal-stepper">
              <button type="button" onClick={() => setDailyGoal((value) => Math.max(1, value - 1))}>−</button>
              <output>{dailyGoal}</output>
              <button type="button" onClick={() => setDailyGoal((value) => Math.min(100, value + 1))}>+</button>
            </span>
          </div>

          {error && <div className="inline-error" role="alert">{error}</div>}
          <button type="button" className="primary-button" disabled={!displayName.trim() || saving} onClick={() => void save()}>
            {saving ? <LoaderCircle className="spin" size={19} /> : <Check size={19} />}
            {saving ? "저장하고 있어요" : "설정 저장"}
          </button>
        </section>

        <aside className="profile-side">
          <AiUsagePanel />
          <section className="system-panel">
            <div className="panel-heading"><div><span className="section-label">SERVICE STATUS</span><h2>서비스 상태</h2></div></div>
            <div className="service-row"><span className="service-icon"><Database size={18} /></span><div><strong>PostgreSQL</strong><small>학습 데이터 저장소</small></div><span className={`service-status ${healthLoading ? "" : health?.database ? "is-online" : "is-offline"}`}>{healthLoading ? "확인 중" : health?.database ? "정상" : "확인 필요"}</span></div>
            <div className="service-row"><span className="service-icon"><Server size={18} /></span><div><strong>{provider === "gemini" ? "Gemini" : "Ollama"}</strong><small>{provider === "gemini" ? "API 연결 확인 · 잔여 한도는 별도" : "로컬 번역 모델"}</small></div><span className={`service-status ${healthLoading ? "" : health?.ollama ? "is-online" : "is-offline"}`}>{healthLoading ? "확인 중" : health?.ollama ? "정상" : "연결 안 됨"}</span></div>
          </section>

          {/*<section className="privacy-panel">*/}
          {/*  <span className="privacy-icon"><UserRound size={20} /></span>*/}
          {/*  <div><strong>내 계정에 보관되는 학습 기록</strong><p>저장 문장과 학습 기록은 계정별로 보관됩니다. {provider === "gemini" ? "AI 입력은 Google Gemini로 전송됩니다. 무료 등급 입력·출력은 제품 개선에 사용될 수 있으므로 민감한 정보를 입력하지 마세요." : "번역은 사설 Ollama에서 처리됩니다."}</p></div>*/}
          {/*</section>*/}
        </aside>
      </div>

     {/*<Link className="practice-review-link" href="/study/mistakes"><Brain size={21} /><span><strong>오답 복습으로 이어가기</strong><small>틀린 퀴즈·퍼즐을 유형과 어투별로 모아 다시 풀어보세요.</small></span></Link>*/}
      {toast && <div className="toast" role="status"><Check size={17} />{toast}</div>}
    </div>
  );
}
