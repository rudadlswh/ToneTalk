const destinations = new Set(["/", "/saved", "/study", "/study/mistakes", "/lyrics", "/profile"]);

export function safeAuthNext(value: string | null | undefined) {
  return value && destinations.has(value) ? value : "/";
}

export function isSameOriginRequest(request: Request) {
  return request.headers.get("origin") === new URL(request.url).origin;
}
