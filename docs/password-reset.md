# Password recovery configuration

The application uses Supabase Auth for the recovery token and session, and
Supabase sends the email through its configured SMTP provider. Resend secrets do
not belong in this repository or in Vercel: enter them only in Supabase.

## 1. URLs

In Supabase Dashboard, open **Authentication > URL Configuration**.

- Site URL: `https://decodedsat.com`
- Production redirect URLs:
  - `https://decodedsat.com/auth/callback`
  - `https://decodedsat.com/auth/callback?intent=recovery`
- Local development redirect URL: `http://localhost:3000/**`

In Vercel, set:

```text
NEXT_PUBLIC_SITE_URL=https://decodedsat.com
NEXT_PUBLIC_APP_URL=https://decodedsat.com/dashboard
```

For local development, keep both values on `http://localhost:3000` as shown in
`.env.example`. Preview deployments need an explicit trusted Vercel preview
pattern if recovery emails will be tested there; do not add a broad production
wildcard just for convenience.

## 2. Resend SMTP

1. In Resend, verify the `decodedsat.com` sending domain and create a narrowly
   scoped API key for Supabase Auth mail.
2. In Supabase Dashboard, open **Authentication > SMTP Settings** and enable
   custom SMTP.
3. Enter:
   - Sender email: a verified address such as `auth@decodedsat.com`
   - Sender name: `DecodedSAT`
   - Host: `smtp.resend.com`
   - Port: `465`
   - Username: `resend`
   - Password: the Resend API key
4. Save, then send a test message. Keep Resend link tracking disabled for Auth
   mail so it cannot rewrite Supabase's single-use links.

Port 465 uses implicit TLS. Resend also supports STARTTLS on port 587 if the
Supabase form or network requires it.

## 3. Thirty-minute expiry

In Supabase Dashboard, open **Authentication > Sign In / Providers > Email**,
expand the email provider settings, set **Email OTP expiration** to `1800`
seconds, and save.

This is the real server-side token expiry. Supabase uses this generalized
setting for confirmation, recovery, magic-link, email-change, and invitation
links; there is no separate recovery-only expiry switch. Changing it therefore
makes all of those email links expire after 30 minutes.

If using the Management API instead, the corresponding Auth configuration field
is `mailer_otp_exp: 1800`.

## 4. Recovery email template

In **Authentication > Email Templates > Reset password**, use a server-side
token-hash link. This works with DecodedSAT's HTTP-only SSR cookie architecture
and also lets a student open the email in a different browser from the one that
requested it.

```html
<h2>Reset your DecodedSAT password</h2>
<p>Follow this link to choose a new password. It expires in 30 minutes.</p>
<p>
  <a href="{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=recovery">
    Reset password
  </a>
</p>
<p>If you did not request this, you can safely ignore this email.</p>
```

`requestPasswordResetAction` supplies a `.RedirectTo` value that already ends
in `?intent=recovery`, so the extra parameters intentionally begin with `&`.
Do not put the token hash in application environment variables, logs, or client
storage.

The default `{{ .ConfirmationURL }}` template remains compatible through the
PKCE callback, but it depends on the verifier cookie and therefore normally
needs to be opened in the same browser that requested the reset. The token-hash
template above is the recommended production configuration for this server-only
application.

## 5. Manual test checklist

1. Submit empty and malformed values on login, signup, forgot password, and the
   reset form; confirm field-level messages appear without a network request.
2. Try an incorrect login, an unconfirmed account, and repeated login attempts;
   confirm the messages are contextual and contain no Supabase text.
3. Try signing up with an existing address and a password shorter than eight
   characters.
4. Request resets for an existing and a nonexistent address. Both forms must
   show the same neutral success message.
5. Open a valid recovery email in the same browser and in another browser. Both
   should reach `/auth/reset-password` when the token-hash template is active.
6. Refresh the reset page before submitting; the form should remain usable.
7. Try short and mismatched passwords, then set a valid new password. Confirm
   the recovery session is signed out and the new password can sign in.
8. Reopen the used link; it must show the invalid/already-used state.
9. Request another link, wait more than 30 minutes, and open it; it must show the
   expired state. Do not infer expiry only from UI copy—confirm Supabase Auth
   rejects the token in its Auth logs.

## Security notes

- Reset requests never disclose whether an email exists. Email-specific send
  throttling is intentionally returned as the same neutral success state.
- Recovery tokens are generated, validated, expired, and consumed by Supabase.
- The application stores only the authenticated user id in a short-lived,
  HTTP-only marker cookie; it never stores a recovery token itself.
- Recovery sessions are confined to the reset route and signed out after a
  successful change.
- Raw provider messages are used only in server logs. Passwords, token hashes,
  and recovery URLs are never logged or returned in form state.

## References

- https://supabase.com/docs/guides/auth/passwords
- https://supabase.com/docs/guides/auth/auth-email-passwordless
- https://supabase.com/docs/guides/auth/auth-email-templates
- https://supabase.com/docs/guides/auth/redirect-urls
- https://supabase.com/docs/guides/auth/auth-smtp
- https://resend.com/docs/send-with-smtp
