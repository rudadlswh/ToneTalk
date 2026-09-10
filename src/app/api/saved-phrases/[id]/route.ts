import { z } from "zod";
import { jsonError } from "@/lib/api";
import { deleteSavedPhrase } from "@/server/saved-phrases";

import { withAuth } from "@/server/auth";

export const runtime = "nodejs";
export const DELETE = withAuth(handleDELETE);

const idSchema = z.string().uuid();

async function handleDELETE(
  _request: Request,
  context: RouteContext<"/api/saved-phrases/[id]">,
) {
  const requestId = crypto.randomUUID();
  const { id } = await context.params;
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) {
    return jsonError(requestId, 400, "VALIDATION_ERROR", "저장 문장 ID가 올바르지 않습니다.");
  }

  try {
    const deleted = await deleteSavedPhrase(parsedId.data);
    if (!deleted) {
      return jsonError(requestId, 404, "NOT_FOUND", "이미 삭제되었거나 존재하지 않는 문장입니다.");
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("saved_phrase_delete_failed", { requestId, error });
    return jsonError(requestId, 500, "INTERNAL_ERROR", "문장을 삭제하지 못했습니다.", true);
  }
}
