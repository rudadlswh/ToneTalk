"use client";
import { createContext, useContext } from "react";
export const AiProviderContext = createContext<"ollama" | "gemini">("ollama");
export function useAiProvider() { return useContext(AiProviderContext); }
