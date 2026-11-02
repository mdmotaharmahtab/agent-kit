/* Example quiz bank: shows the exact format, written as module 01's bank. A real bank is quizzes/mNN.js,
   registered under window.QUIZ_BANKS["mNN"], with question ids mNN-q01, mNN-q02, ... No page loads this file.

   IMPORTANT FORMAT RULE: everything between the first "[" and the final "]" must be
   STRICT JSON (double-quoted keys and strings, no trailing commas, no comments, no
   single quotes). The course checker parses it with a JSON parser. Only the two
   wrapper lines are JavaScript. */
window.QUIZ_BANKS = window.QUIZ_BANKS || {};
window.QUIZ_BANKS["m01"] = [
  {
    "id": "m01-q01",
    "type": "single",
    "domain": "Token validation",
    "difficulty": "hard",
    "scenario": "A Python web API accepts JWTs issued by the company's identity provider. A developer copies a valid access token that was issued for a <em>different</em> API of the same company and sends it to this one. The backend verifies the signature against the provider's JWKS, checks <code>exp</code>, and accepts the request.",
    "question": "What is the root cause of the vulnerability?",
    "options": [
      { "text": "The backend never checks the <code>aud</code> claim, so a token minted for another API passes.", "correct": true,
        "why": "Signature and expiry only prove the token is genuine and current. <code>aud</code> is what binds a token to <em>this</em> API. Without it, any valid tenant token works." },
      { "text": "The backend should require the ID token instead, because the ID token is the one that names the signed-in user.", "correct": false,
        "why": "ID tokens are for the client to learn who the user is. APIs should never accept ID tokens as authorization." },
      { "text": "The backend cached the tenant's JWKS too long, so it accepted a token signed with a key the tenant had already rotated out.", "correct": false,
        "why": "Nothing in the scenario involves key rotation. The token is genuinely signed by the tenant." },
      { "text": "The token should have been validated with HS256 instead of RS256.", "correct": false,
        "why": "HS256 would require sharing a secret with the IdP and is the weaker choice for third-party issued tokens." }
    ],
    "explanation": "Full JWT validation is: signature (against JWKS for the expected <code>iss</code>), <code>iss</code>, <code>aud</code>, <code>exp</code>/<code>nbf</code>, and any required scopes/roles. Skipping <code>aud</code> is the classic 'token confusion' bug and is heavily tested."
  },
  {
    "id": "m01-q02",
    "type": "multi",
    "domain": "SPA security",
    "difficulty": "hard",
    "scenario": "A React SPA stores its access and refresh tokens in <code>localStorage</code> so users stay logged in across tabs. A dependency with an XSS bug ships to production.",
    "question": "Which TWO changes most directly reduce the impact of the XSS on the user's session?",
    "options": [
      { "text": "Move the tokens to a backend-for-frontend (BFF) and give the browser only an <code>HttpOnly</code> session cookie.", "correct": true,
        "why": "Script cannot read HttpOnly cookies, so an XSS payload cannot exfiltrate the tokens." },
      { "text": "Add a strict Content-Security-Policy that disallows inline scripts and unknown script origins.", "correct": true,
        "why": "CSP limits what an injected script can do and where it can send data, reducing blast radius even if injection succeeds." },
      { "text": "Switch the refresh token to a longer lifetime so fewer token requests are visible to the attacker.", "correct": false,
        "why": "Longer-lived tokens increase, not reduce, the value of a stolen token." },
      { "text": "Encrypt the tokens before writing them to <code>localStorage</code>, with an AES key that the app's JavaScript generates and keeps in memory.", "correct": false,
        "why": "If script can run, it can read the key too. This is obfuscation, not protection." },
      { "text": "Use PKCE in the authorization request.", "correct": false,
        "why": "PKCE protects the code exchange from interception; it does nothing for tokens already stored in the browser." }
    ],
    "explanation": "XSS is the threat model that drives 'where do tokens live?'. The strongest answer keeps tokens out of JavaScript's reach entirely (BFF + HttpOnly cookie); CSP is the defense-in-depth layer. PKCE, encryption-in-JS, and lifetimes are distractors that sound security-flavored but do not address the stated threat."
  }
];
