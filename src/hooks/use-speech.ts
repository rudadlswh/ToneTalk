"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getLanguage, type LanguageCode } from "@/lib/languages";

type SpeechRequest = {
  id: string;
  text: string;
  language: LanguageCode | string;
};

export function useSpeech() {
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const errorTimerRef = useRef<number | null>(null);

  const clearAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    clearAudio();
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    utteranceRef.current = null;
    activeIdRef.current = null;
    setSpeakingId(null);
  }, [clearAudio]);

  const showSpeechError = useCallback((message: string) => {
    setSpeechError(message);
    if (errorTimerRef.current) window.clearTimeout(errorTimerRef.current);
    errorTimerRef.current = window.setTimeout(() => setSpeechError(null), 2600);
  }, []);

  const finish = useCallback(
    (id: string) => {
      if (activeIdRef.current !== id) return;
      clearAudio();
      utteranceRef.current = null;
      activeIdRef.current = null;
      setSpeakingId(null);
    },
    [clearAudio],
  );

  const playLocalAudio = useCallback(
    async ({ id, text, language }: SpeechRequest) => {
      const controller = new AbortController();
      requestRef.current = controller;
      try {
        const response = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, language }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Local TTS request failed");
        const audioBlob = await response.blob();
        if (activeIdRef.current !== id) return;

        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        audioUrlRef.current = audioUrl;
        audioRef.current = audio;
        audio.onended = () => finish(id);
        audio.onerror = () => {
          finish(id);
          showSpeechError("음성을 재생하지 못했습니다.");
        };
        await audio.play();
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        finish(id);
        showSpeechError("로컬 음성을 만들지 못했습니다.");
      } finally {
        if (requestRef.current === controller) requestRef.current = null;
      }
    },
    [finish, showSpeechError],
  );

  const speak = useCallback(
    (request: SpeechRequest) => {
      if (activeIdRef.current === request.id) {
        stop();
        return;
      }

      stop();
      setSpeechError(null);
      activeIdRef.current = request.id;
      setSpeakingId(request.id);

      const supportsBrowserSpeech =
        typeof window !== "undefined" &&
        "speechSynthesis" in window &&
        "SpeechSynthesisUtterance" in window;
      if (!supportsBrowserSpeech) {
        void playLocalAudio(request);
        return;
      }

      const synthesis = window.speechSynthesis;
      const locale = getLanguage(request.language)?.speechLocale ?? request.language;
      const utterance = new SpeechSynthesisUtterance(request.text);
      const normalizedLocale = locale.toLowerCase();
      const languagePrefix = normalizedLocale.split("-")[0];
      const voices = synthesis.getVoices();
      const voice =
        voices.find((candidate) => candidate.lang.toLowerCase() === normalizedLocale) ??
        voices.find((candidate) =>
          candidate.lang.toLowerCase().startsWith(`${languagePrefix}-`),
        );

      utterance.lang = locale;
      utterance.rate = 0.9;
      utterance.pitch = 1;
      if (voice) utterance.voice = voice;
      utterance.onend = () => finish(request.id);
      utterance.onerror = (event) => {
        if (activeIdRef.current !== request.id) return;
        utteranceRef.current = null;
        if (event.error === "canceled" || event.error === "interrupted") {
          finish(request.id);
          return;
        }
        void playLocalAudio(request);
      };

      utteranceRef.current = utterance;
      synthesis.resume();
      synthesis.speak(utterance);
    },
    [finish, playLocalAudio, stop],
  );

  useEffect(
    () => () => {
      requestRef.current?.abort();
      if (errorTimerRef.current) window.clearTimeout(errorTimerRef.current);
      clearAudio();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      utteranceRef.current = null;
      activeIdRef.current = null;
    },
    [clearAudio],
  );

  return { speakingId, speechError, speak, stop };
}
