/**
 * auth/index.js — Better-auth instance configured for this app.
 *
 * EXPORTS an async factory `buildAuth()` that resolves to { auth }.
 *
 * Why a factory instead of a top-level const:
 * better-auth (and better-auth/api) ship as ESM-only .mjs from v1.6.9+.
 * Node ≥22.12 enables require(esm) by default, but Railway's nixpacks
 * builder still provisions Node 22.11.0 even with engines.node pinned —
 * silently falling back to its highest known cached version. Dynamic
 * import() works regardless of Node minor version.
 *
 * server.js awaits buildAuth() inside its async bootstrap, then assigns
 * the result to a module-scoped `let auth` so the middleware closures
 * resolve the live binding at request-time.
 *
 * Mounted in server.js at /api/auth/* via toNodeHandler(auth.handler).
 * Uses our custom adapter (auth/adapter.js) so dev (sql.js) and prod (pg)
 * keep working through the existing db/index.js router.
 */
const { ufcAdapter } = require('./adapter');
const { sendMail } = require('./email');
const db = require('../db');

// Account-lockout policy: after MAX_FAIL failures within FAIL_WINDOW_MS, refuse
// further sign-ins for the same email until the window passes.
const MAX_FAIL = 5;
const FAIL_WINDOW_MS = 15 * 60 * 1000;

const NODE_ENV = process.env.NODE_ENV || 'production';
const SECRET = process.env.BETTER_AUTH_SECRET;
const BASE_URL = process.env.BETTER_AUTH_URL || `http://localhost:${process.env.PORT || 3000}`;

if (!SECRET && NODE_ENV === 'production') {
  throw new Error('BETTER_AUTH_SECRET is required when NODE_ENV=production');
}

/**
 * Count failed sign-ins for an email within the lockout window.
 * Resets implicitly when older rows fall out of the window.
 */
async function recentFailures(email) {
  if (!email) return 0;
  const since = new Date(Date.now() - FAIL_WINDOW_MS).toISOString();
  const row = await db.oneRow(
    `SELECT COUNT(*) AS c FROM auth_login_attempts
     WHERE email = ? AND success = 0 AND attempted_at >= ?`,
    [String(email).toLowerCase(), since]
  );
  return row ? Number(row.c) : 0;
}

async function recordAttempt(email, ip, success) {
  if (!email) return;
  await db.run(
    `INSERT INTO auth_login_attempts (email, ip, success, attempted_at) VALUES (?,?,?,?)`,
    [String(email).toLowerCase(), ip || null, success ? 1 : 0, new Date().toISOString()]
  );
  // On success, clear prior failures so the count resets.
  if (success) {
    await db.run(
      `DELETE FROM auth_login_attempts WHERE email = ? AND success = 0`,
      [String(email).toLowerCase()]
    );
  }
}

function getRequestIp(ctx) {
  const h = ctx && ctx.request && ctx.request.headers;
  if (!h) return null;
  return (
    h.get('x-forwarded-for')?.split(',')[0].trim() ||
    h.get('x-real-ip') ||
    null
  );
}

async function buildAuth() {
  // Dynamic import — see header comment for why.
  const betterAuthMod = await import('better-auth');
  const betterAuthApiMod = await import('better-auth/api');

  const { betterAuth, APIError } = betterAuthMod;
  const { createAuthMiddleware } = betterAuthApiMod;

  if (typeof betterAuth !== 'function') {
    throw new TypeError(
      `better-auth did not export 'betterAuth' as a function. Got: ${typeof betterAuth}. ` +
      `Check that better-auth is installed (npm install) and that the package version ` +
      `(${require('../package.json').dependencies['better-auth']}) still ships these exports.`
    );
  }
  if (typeof createAuthMiddleware !== 'function') {
    throw new TypeError(
      `better-auth/api did not export 'createAuthMiddleware' as a function. Got: ${typeof createAuthMiddleware}.`
    );
  }
  if (typeof APIError !== 'function') {
    throw new TypeError(
      `better-auth did not export 'APIError' as a constructor. Got: ${typeof APIError}.`
    );
  }

  const auth = betterAuth({
    appName: 'UFC Tactical',
    baseURL: BASE_URL,
    secret: SECRET || 'dev-only-secret-replace-in-production-do-not-ship-this-string-anywhere',
    database: ufcAdapter,

    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      // Non-blocking: verification email is sent on signup but users can sign in
      // immediately. Flip to true once auth/email.js is wired to a real provider.
      requireEmailVerification: false,
      sendResetPassword: async ({ user, url }) => {
        await sendMail({
          to: user.email,
          subject: 'Reset your UFC Tactical password',
          html:
            `<p>Hi${user.name ? ' ' + user.name : ''},</p>` +
            `<p>Click the link below to reset your password. It expires in 1 hour.</p>` +
            `<p><a href="${url}">${url}</a></p>` +
            `<p>If you didn't request this, you can ignore this email.</p>`,
        });
      },
    },

    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendMail({
          to: user.email,
          subject: 'Verify your UFC Tactical email',
          html:
            `<p>Welcome${user.name ? ' ' + user.name : ''}!</p>` +
            `<p>Click below to verify your email address:</p>` +
            `<p><a href="${url}">${url}</a></p>`,
        });
      },
    },

    // App-extension columns on the users table — kept snake_case to match the
    // existing DB schema and the legacy db.createUser() code path.
    user: {
      additionalFields: {
        display_name: { type: 'string', required: false },
        avatar_key:   { type: 'string', required: false },
        is_guest:     { type: 'number', required: false, defaultValue: 0 },
      },
      // Email change requires confirmation from the OLD (verified) address before
      // taking effect — protects against account hijack via change-email. The
      // confirmation only fires for users whose current email is already verified;
      // unverified users can change immediately. Until the link is clicked, the
      // email stays at its current value.
      changeEmail: {
        enabled: true,
        sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
          await sendMail({
            to: user.email,
            subject: 'Confirm your UFC Tactical email change',
            html:
              `<p>Hi${user.name ? ' ' + user.name : ''},</p>` +
              `<p>Someone (hopefully you) requested to change your account email to <strong>${newEmail}</strong>.</p>` +
              `<p>Click below to confirm — the change won't take effect until you do:</p>` +
              `<p><a href="${url}">${url}</a></p>` +
              `<p>If you didn't request this, ignore this email and your address will stay the same.</p>`,
          });
        },
      },
    },

    // Hooks: account-lockout middleware on /sign-in/email.
    // before — refuse if too many recent failures for the same email.
    // after  — record success/failure based on the response status.
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-in/email') return;
        const email = ctx.body && ctx.body.email;
        if (!email) return;
        const fails = await recentFailures(email);
        if (fails >= MAX_FAIL) {
          throw new APIError('TOO_MANY_REQUESTS', {
            message: `Too many failed sign-in attempts. Try again in ${Math.ceil(FAIL_WINDOW_MS / 60000)} minutes.`,
            code: 'ACCOUNT_LOCKED',
            lockedFor: FAIL_WINDOW_MS,
          });
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-in/email') return;
        const email = ctx.body && ctx.body.email;
        if (!email) return;
        // ctx.context.returned holds the response — APIError on failure, success object otherwise.
        const ret = ctx.context && ctx.context.returned;
        const success = ret && !(ret instanceof Error) && !ret.error;
        await recordAttempt(email, getRequestIp(ctx), success);
      }),
    },

    session: {
      expiresIn: 60 * 60 * 24 * 7,            // 7 days
      updateAge: 60 * 60 * 24,                // refresh once per day
      cookieCache: { enabled: true, maxAge: 60 * 5 },
    },

    advanced: {
      defaultCookieAttributes: {
        httpOnly: true,
        secure: NODE_ENV === 'production',
        sameSite: 'lax',
      },
    },
  });

  return { auth };
}

module.exports = { buildAuth };
