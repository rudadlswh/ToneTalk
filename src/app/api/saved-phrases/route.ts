import { getRequestId, logFailure } from "@/server/diagnostics";
import { readLimitedJson, PayloadTooLargeError } from "@/server/request-body";
import { z, ZodError } from "zod";
import { jsonError } from "@/lib/api";
import { languageCodes } from "@/lib/languages";
import { listSavedPhrases, savePhrase } from "@/server/saved-phrases";

import { withAuth } from "@/server/auth";

export const runtime = "nodejs";
export const GET = withAuth(handleGET);
export const POST = withAuth(handlePOST);

const saveSchema = z.object({ variantId: z.string().uuid() });
const querySchema = z.object({
  q: z.string().trim().max(100).optional(),
  language: z.enum(languageCodes).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

async function handleGET(request: Request) {
  const requestId = getRequestId();
  try {
    const url = new URL(request.url);
    const query = querySchema.parse({
      q: url.searchParams.get("q") || undefined,
      language: url.searchParams.get("language") || undefined,
      limit: url.searchParams.get("limit") || undefined,
    });
    const items = await listSavedPhrases({
      query: query.q,
      language: query.language,
      limit: query.limit,
    });
    return Response.json(
      { items, totalCount: items.length, requestId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonError(requestId, 400, "VALIDATION_ERROR", "검색 조건을 확인해 주세요.");
    }
    logFailure("saved_phrases_list_failed", requestId, error);
    return jsonError(requestId, 500, "INTERNAL_ERROR", "저장 문장을 불러오지 못했습니다.", true);
  }
}

async function handlePOST(request: Request) {
  const requestId = getRequestId();
  try {
    const input = saveSchema.parse(await readLimitedJson(request, 4096));
    const result = await savePhrase(input.variantId);
    if (!result) {
      return jsonError(requestId, 404, "VARIANT_NOT_FOUND", "저장할 번역 결과를 찾지 못했습니다.");
    }
    return Response.json(
      { savedPhraseId: result.id, requestId },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return jsonError(requestId, 413, "PAYLOAD_TOO_LARGE", "요청 본문이 너무 큽니다.");
    if (error instanceof SyntaxError) return jsonError(requestId, 400, "INVALID_JSON", "올바른 JSON 본문을 보내 주세요.");
    if (error instanceof ZodError) {
      return jsonError(requestId, 400, "VALIDATION_ERROR", "번역 결과 ID가 올바르지 않습니다.");
    }
    logFailure("saved_phrase_create_failed", requestId, error);
    return jsonError(requestId, 500, "INTERNAL_ERROR", "문장을 저장하지 못했습니다.", true);
  }
}
