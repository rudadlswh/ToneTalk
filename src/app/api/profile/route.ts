import { ZodError } from "zod";
import { jsonError } from "@/lib/api";
import { updateProfileSchema } from "@/lib/profile-contract";
import { getProfile, updateProfile } from "@/server/profile";

export const runtime = "nodejs";

export async function GET() {
  const requestId = crypto.randomUUID();
  try {
    const data = await getProfile();
    return Response.json(
      { ...data, requestId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("profile_read_failed", { requestId, error });
    return jsonError(requestId, 500, "INTERNAL_ERROR", "프로필을 불러오지 못했습니다.", true);
  }
}

export async function PATCH(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const input = updateProfileSchema.parse(await request.json());
    const data = await updateProfile(input);
    return Response.json(
      { ...data, requestId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonError(
        requestId,
        400,
        "VALIDATION_ERROR",
        error.issues[0]?.message ?? "프로필 정보를 확인해 주세요.",
      );
    }
    console.error("profile_update_failed", { requestId, error });
    return jsonError(requestId, 500, "INTERNAL_ERROR", "프로필을 저장하지 못했습니다.", true);
  }
}
