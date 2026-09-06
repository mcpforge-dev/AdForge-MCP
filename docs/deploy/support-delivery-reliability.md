# Support delivery reliability (C1–C3)

## Delivery truth

- `PENDING` / `FAILED` / `NOT_CONFIGURED` with no message ID may be atomically claimed as `SENDING`.
- Only the claimant calls Telegram. Other executions do not reclaim `SENDING`.
- A valid Telegram `message_id` is confirmed success; `SENT` is terminal.
- A parsed Telegram `ok: false` is an explicit refusal (`FAILED`, bounded BullMQ retry).
- Timeout, transport errors, malformed response or absent message ID are `UNCERTAIN`: no automatic resend.
- A process crash can leave `SENDING`. It must not be blindly reset: the external outcome may be unknown.
- Audit failures are logged separately and cannot downgrade a confirmed delivery.
- If confirmed-delivery persistence fails, the job returns its confirmation to BullMQ and the API; the retained `SENDING` claim prevents a duplicate send. Recovery must use actual message-ID evidence, not resend or an invented ID. BullMQ result retention is bounded; this is not a generic exactly-once guarantee.

## API and browser

The API never writes FAILED merely because waiting for the worker timed out. It rereads delivery evidence. An unconfirmed request returns HTTP 202 with `telegramDelivered: false`; only a confirmed message ID opens the success modal. HTTP 409 means the same key was used for different content. Explicit delivery failure remains an error.

Fingerprint: SHA-256 of normalized category/message/sourceRoute/locale, within the server-selected workspace and user. Persisted immutable request fields are the source of truth, so no fingerprint backfill is invented. Concurrent P2002 handling is limited to the workspace/user/idempotency-key constraint. Changed browser content gets a new key; unchanged retries keep the key.

## Rollout

Migration 0030 only adds `UNCERTAIN` to the delivery enum. No historical requests or message IDs are changed. Deploy API/Web/Worker together with `--no-deps`, retaining PostgreSQL/Redis and the previous immutable image. Do not run old and new worker code concurrently on the support queue after rollout.

No production provider changes are required. Verification uses a fake HTTP Telegram upstream locally and one explicitly labelled controlled production feedback message after deployment.
