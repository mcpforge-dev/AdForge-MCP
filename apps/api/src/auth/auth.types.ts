export type HumanPrincipal = {
  kind: "human";
  userId: string;
  sessionId: string;
};

export type RequestWithAuth = {
  requestId?: string;
  cookies?: Record<string, string | undefined>;
  user?: HumanPrincipal;
  csrfToken?: string;
  params?: Record<string, string>;
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
};

export const SESSION_COOKIE = "hm_v2_session";
export const CSRF_COOKIE = "hm_v2_csrf";
