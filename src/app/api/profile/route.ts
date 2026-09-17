import { getRequestId, logFailure } from "@/server/diagnostics";
import { readLimitedJson, PayloadTooLargeError } from "@/server/request-body";
import { ZodError } from "zod";
import { jsonError } from "@/lib/api";
import { updateProfileSchema } from "@/lib/profile-contract";
import { getProfile, updateProfile } from "@/server/profile";

import { withAuth } from "@/server/auth";

export const runtime = "nodejs";
export const GET = withAuth(handleGET);
export const PATCH = withAuth(handlePATCH);

async function handleGET() {
  const requestId = getRequestId();
  try {
    const data = await getProfile();
    return Response.json(
      { ...data, requestId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logFailure("profile_read_failed", requestId, error);
    return jsonError(requestId, 500, "INTERNAL_ERROR", "프로필을 불러오지 못했습니다.", true);
  }
}

async function handlePATCH(request: Request) {
  const requestId = getRequestId();
  try {
    const input = updateProfileSchema.parse(await readLimitedJson(request, 4096));
    const data = await updateProfile(input);
    return Response.json(
      { ...data, requestId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return jsonError(requestId, 413, "PAYLOAD_TOO_LARGE", "요청 본문이 너무 큽니다.");
    if (error instanceof SyntaxError) return jsonError(requestId, 400, "INVALID_JSON", "올바른 JSON 본문을 보내 주세요.");
    if (error instanceof ZodError) {
      return jsonError(
        requestId,
        400,
        "VALIDATION_ERROR",
        error.issues[0]?.message ?? "프로필 정보를 확인해 주세요.",
      );
    }
    logFailure("profile_update_failed", requestId, error);
    return jsonError(requestId, 500, "INTERNAL_ERROR", "프로필을 저장하지 못했습니다.", true);
  }
}
