import { z, ZodError } from "zod";
import { jsonError } from "@/lib/api";
import { getStudySummary, listDueStudyItems } from "@/server/study";

import { withAuth } from "@/server/auth";

export const runtime = "nodejs";
export const GET = withAuth(handleGET);

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

async function handleGET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const url = new URL(request.url);
    const query = querySchema.parse({
      limit: url.searchParams.get("limit") || undefined,
    });
    const [items, summary] = await Promise.all([
      listDueStudyItems(query.limit),
      getStudySummary(),
    ]);
    return Response.json(
      { items, summary, requestId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonError(requestId, 400, "VALIDATION_ERROR", "학습 조건을 확인해 주세요.");
    }
    console.error("study_list_failed", { requestId, error });
    return jsonError(requestId, 500, "INTERNAL_ERROR", "학습 카드를 불러오지 못했습니다.", true);
  }
}
