/** Name of the short-lived cookie that carries the OAuth CSRF state. */
export const OAUTH_STATE_COOKIE = "logrun_oauth_state";

/** Cookie path is scoped to the callback so the browser sends it nowhere else. */
export const OAUTH_STATE_COOKIE_PATH = "/auth/callback";
