export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
  requestId: string;
};

export function jsonError(
  requestId: string,
  status: number,
  code: string,
  message: string,
  retryable = false,
) {
  return Response.json(
    { error: { code, message, retryable }, requestId } satisfies ApiErrorBody,
    { status, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } },
  );
}

export class ApiError extends Error {
  constructor(message: string, public readonly code: string, public readonly requestId: string | undefined, public readonly status: number, public readonly retryable: boolean) {
    super(message + (requestId ? ` (문의 ID: ${requestId})` : ""));
    this.name = "ApiError";
  }
}

export async function readJson<T>(response: Response, options: { redirectOnUnauthorized?: boolean } = {}): Promise<T> {
  const body = await response.json().catch((error: unknown) => {
    if (error instanceof Error && error.name === "AbortError") throw error;
    return null;
  }) as T | ApiErrorBody | null;
  const maybeError = body as ApiErrorBody | null;
  const candidateId = maybeError?.requestId ?? response.headers.get("x-request-id");
  const requestId = typeof candidateId === "string" && /^[0-9a-f-]{36}$/i.test(candidateId) ? candidateId : undefined;
  if (response.status === 401 && options.redirectOnUnauthorized !== false && typeof window !== "undefined") {
    window.location.replace("/login");
    throw new ApiError("세션이 만료되었습니다. 다시 로그인해 주세요.", "AUTH_REQUIRED", requestId, 401, false);
  }
  if (!response.ok) {
    const message = maybeError?.error?.message ?? "요청을 완료하지 못했습니다.";
    const wait = Number(response.headers.get("retry-after"));
    const delay = Number.isFinite(wait) && wait > 0 ? ` (약 ${wait < 60 ? `${Math.ceil(wait)}초` : `${Math.ceil(wait / 60)}분`} 후 다시 요청해 주세요.)` : "";
    throw new ApiError(message + delay, maybeError?.error?.code ?? "HTTP_ERROR", requestId, response.status, maybeError?.error?.retryable ?? response.status >= 500);
  }
  if (body === null) throw new ApiError("응답을 읽지 못했습니다.", "INVALID_RESPONSE", requestId, response.status, true);
  return body as T;
}
