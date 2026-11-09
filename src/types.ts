/**
 * One WEBFLEET.connect connection. The host is fixed, so these four values
 * are the whole credential: `account` and `apiKey` go on the query string
 * (as the reference requires), `username` and `password` only ever in the
 * HTTP Basic Auth header.
 */
export interface WebfleetCredentials {
  account: string;
  username: string;
  password: string;
  apiKey: string;
}

/** Caller-supplied arguments failed validation. Never reaches Webfleet. */
export class ArgumentError extends Error {}

/** Credentials are missing or malformed. Messages never contain a credential value. */
export class CredentialError extends Error {}

/** Any vendor error, redirect, oversized, malformed, or unreachable upstream response. */
export class WebfleetApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** WEBFLEET.connect response code (X-Webfleet-Errorcode or the body's error id). */
    readonly code?: string,
  ) {
    super(message);
  }
}

/** Refused locally so the account never crosses a WEBFLEET.connect request limit. */
export class ThrottleError extends Error {
  constructor(
    message: string,
    readonly retryAfterSeconds: number,
  ) {
    super(message);
  }
}
