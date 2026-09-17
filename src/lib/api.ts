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
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function readJson<T>(response: Response): Promise<T> {
  if (response.status === 401 && typeof window !== "undefined") {
    window.location.replace("/login");
    throw new Error("세션이 만료되었습니다. 다시 로그인해 주세요.");
  }
  const body = (await response.json()) as T | ApiErrorBody;
  if (!response.ok) {
    const maybeError = body as ApiErrorBody;
    const message = maybeError.error?.message ?? "요청을 완료하지 못했습니다.";
    const wait = Number(response.headers.get("retry-after"));
    const delay = Number.isFinite(wait) && wait > 0 ? ` (약 ${wait < 60 ? `${Math.ceil(wait)}초` : `${Math.ceil(wait / 60)}분`} 후 다시 요청해 주세요.)` : "";
    throw new Error(message + delay);
  }
  return body as T;
}
