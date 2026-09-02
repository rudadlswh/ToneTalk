import { z, ZodError } from "zod";
import { jsonError } from "@/lib/api";
import { studyRatings } from "@/lib/study-schedule";
import { getStudySummary, reviewStudyItem } from "@/server/study";

export const runtime = "nodejs";

const reviewSchema = z.object({
  savedPhraseId: z.string().uuid(),
  rating: z.enum(studyRatings),
});

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const input = reviewSchema.parse(await request.json());
    const progress = await reviewStudyItem(input.savedPhraseId, input.rating);
    if (!progress) {
      return jsonError(requestId, 404, "NOT_FOUND", "복습할 저장 문장을 찾지 못했습니다.");
    }
    const summary = await getStudySummary();
    return Response.json(
      { progress, summary, requestId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonError(requestId, 400, "VALIDATION_ERROR", "복습 평가를 확인해 주세요.");
    }
    console.error("study_review_failed", { requestId, error });
    return jsonError(requestId, 500, "INTERNAL_ERROR", "복습 결과를 저장하지 못했습니다.", true);
  }
}
