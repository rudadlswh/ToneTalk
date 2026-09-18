import "server-only";

export function isGuestMode() {
  return process.env.GUEST_MODE === "true";
}
