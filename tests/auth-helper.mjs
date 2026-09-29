// Shared sign-in helper for the API suites.
//
// The server used to create an account on the spot when an unknown email hit
// /api/auth/login, and every suite below relied on that: `signIn(newEmail)`
// was how a test got a session. That back door is gone — an account now has to
// be registered and pass the OTP step before it can sign in — so those suites
// were signing in as nobody and every assertion after the first was measuring
// an anonymous request, not the thing it named.
//
// This helper restores the one-call shape the suites expect: sign in if the
// account exists (the seeded developer admin does), otherwise register it,
// clear the OTP gate with the code the dev server echoes back, and sign in.
//
// It needs `devOtp` in the register response, which the server returns only
// when IS_DEV and EXPOSE_DEV_OTP !== 'false'. Against a production-like server
// there is no code to read and `user` comes back null — which is the correct
// answer, not a silent pass.

/**
 * @param {string} base      e.g. http://localhost:3000
 * @param {string} email
 * @param {string} password
 * @param {object} [opts]
 * @param {string} [opts.name]
 * @param {string} [opts.referralCode]
 * @returns {Promise<{cookie: string, user: object|null, status: number}>}
 */
export async function signInOrRegister(base, email, password, opts = {}) {
  const post = (path, body) =>
    fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  let res = await post('/api/auth/login', { email, password });
  if (res.status !== 200) {
    const reg = await post('/api/auth/register', {
      email,
      password,
      confirmPassword: password,
      name: opts.name || email.split('@')[0],
      ...(opts.referralCode ? { referralCode: opts.referralCode } : {}),
    });
    let regJson = null;
    try { regJson = await reg.json(); } catch { /* no body */ }

    // Registration may hand back a session directly (SSO path); otherwise the
    // account is parked behind the OTP gate until the code is presented.
    if (regJson?.devOtp) {
      await post('/api/auth/verify-otp', { email, otp: regJson.devOtp });
    }
    res = await post('/api/auth/login', { email, password });
  }

  const cookie = res.headers.get('set-cookie')?.split(';')[0] || '';
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { cookie, user: json?.user || null, status: res.status };
}
