# Launch hardening

This is what separates the private beta from a public launch. Each item below is built and switched
off or on by configuration only; there is nothing more to code.

## 1. Exchange-key master key in AWS KMS (do before public launch)

**Why:** today the master key that locks every user's exchange keys sits in Railway's variables.
With KMS, Railway holds only an encrypted copy of it, and only AWS can decrypt it. Someone who reads
your variables can no longer read your users' exchange keys.

**Steps (about 20 minutes):**
1. Create an AWS account at aws.amazon.com. Choose the region nearest your servers, for example
   `eu-central-1`.
2. **KMS → Customer managed keys → Create key**. Choose Symmetric, then Encrypt and decrypt. Alias:
   `atc-credentials`.
3. **IAM → Users → Create user** `atc-app`. Give it an inline policy that allows only `kms:Decrypt`
   on that key's ARN. Create an **access key** for it and save both halves.
4. Encrypt your *current* master-key secret (the part after `v1:` in `CREDENTIAL_KEYS`). Run this
   in AWS CloudShell (the terminal icon in the AWS console):
   ```bash
   aws kms encrypt --key-id alias/atc-credentials --plaintext fileb://<(printf '%s' 'YOUR_SECRET') \
     --query CiphertextBlob --output text
   ```
5. In Railway, on **both** the API and the worker:
   - Add `CREDENTIAL_KEYS_KMS` = `v1:<the output>`.
   - Add `AWS_REGION`, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` (from step 3).
   - Delete `CREDENTIAL_KEYS`.
   - Deploy.
6. Check that the worker still syncs (Exchanges page → "Synced … ago" updates). Keep an offline copy
   of the plain secret in your password manager as disaster recovery.

The same key IDs are used, so no stored data changes. If KMS is misconfigured, the service refuses to
start rather than running with no key.

## 2. Content-Security-Policy

The web app sends `Content-Security-Policy-Report-Only`. The browser reports what *would* be blocked
but blocks nothing.

After deploying with Clerk and Paddle live:
1. Sign in, open every page, and do a sandbox checkout.
2. Look for `[Report Only]` messages in the browser console (F12).
3. When there are none, rename the header key in `apps/web/next.config.ts` to
   `Content-Security-Policy`.

Your Clerk domain (including a production custom domain such as `clerk.yourdomain.com`) is read
from `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` automatically.

## 3. Error monitoring (Sentry)

1. Create a free account on sentry.io, add a Node.js project, and copy its **DSN**.
2. Set `SENTRY_DSN` on the API and the worker.

Only server errors (5xx) and worker failures are sent. Request bodies, cookies, headers and user data
are never sent.

## 4. Rate limiting

Each signed-in user gets 120 requests per minute (stricter on AI, exports and connecting
exchanges), counted in Redis, so the limit holds with several API
instances. If Redis is briefly down, requests are allowed rather than blocked. The Clerk and Paddle
webhooks and `/health` are exempt.

## 5. Legal pages

`/privacy`, `/terms` and `/risk-disclosure` are templates. Before launch:
1. Replace every `[bracketed placeholder]` with your details: company name, address, contact email,
   governing law.
2. Have a lawyer review them.
3. Paddle requires the terms, privacy and refund policy to be live before it approves your account.

## 6. Pre-launch checklist
- [ ] KMS enabled and `CREDENTIAL_KEYS` removed (section 1)
- [ ] Sentry DSN set; test error visible in Sentry
- [ ] CSP enforced (section 2)
- [ ] Legal pages completed and reviewed
- [ ] Paddle switched from sandbox to production (`PADDLE_ENVIRONMENT`, new keys, price IDs,
      client token)
- [ ] `ADMIN_EMAILS` set to your own email only
- [ ] Neon database backups (point-in-time restore) enabled on a paid plan
- [ ] Each exchange connected with a real read-only key and a full sync observed
- [ ] Resend domain verified (SPF/DKIM) so emails do not land in spam
