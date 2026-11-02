/* =========================================================
   Course widget library (embeds documented in authoring/WIDGETS.md)
   - Self-contained, no dependencies, works from file://, ES2019.
   - Boots on DOMContentLoaded and renders every [data-widget].
   - Pure logic (decoders, simulators, evaluators) is exposed on
     window.WIDGET_LOGIC so it can be self-tested without a browser UI.
   Widgets: jwt, cookie-sim, cors-sim, oauth-stepper, iam-eval,
            netpol-check, rebac, spot-the-bug, terminal-replay,
            defense-lab, self-test
   ========================================================= */
(function () {
  "use strict";

  const LOGIC = {};
  window.WIDGET_LOGIC = LOGIC;

  /* ---------------------------------------------------------
     DOM helpers
     --------------------------------------------------------- */
  function h(tag, attrs) {
    const e = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      const v = attrs[k];
      if (v == null || v === false) return;
      if (k === "class") e.className = v;
      else if (k === "html") e.innerHTML = v;
      else if (k === "text") e.textContent = v;
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, "");
      else e.setAttribute(k, String(v));
    });
    for (let i = 2; i < arguments.length; i++) append(e, arguments[i]);
    return e;
  }
  function append(parent, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(parent, x); }); return; }
    parent.append(c);
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function uid(prefix) { uid.n = (uid.n || 0) + 1; return (prefix || "w") + "-" + uid.n; }

  // Small form helpers. Every control gets a real <label> for keyboard and screen-reader users.
  function field(labelText, control, hint) {
    const id = control.id || uid("f");
    control.id = id;
    return h("div", { class: "w-field" },
      h("label", { for: id }, labelText),
      control,
      hint ? h("span", { class: "w-hint" }, hint) : null);
  }
  function input(attrs) { return h("input", Object.assign({ type: "text", class: "w-input" }, attrs || {})); }
  function textarea(attrs, value) {
    const t = h("textarea", Object.assign({ class: "w-textarea", spellcheck: "false" }, attrs || {}));
    if (value != null) t.value = value;
    return t;
  }
  function select(options, value, attrs) {
    const s = h("select", Object.assign({ class: "w-select" }, attrs || {}));
    options.forEach(function (o) {
      const opt = Array.isArray(o) ? h("option", { value: o[0] }, o[1]) : h("option", { value: o }, o);
      s.append(opt);
    });
    if (value != null) s.value = value;
    return s;
  }
  function checkbox(labelText, checked, attrs) {
    const id = uid("cb");
    const c = h("input", Object.assign({ type: "checkbox", id: id }, attrs || {}));
    c.checked = !!checked;
    return h("label", { class: "w-check", for: id }, c, h("span", {}, labelText));
  }
  function button(text, onclick, secondary, attrs) {
    return h("button", Object.assign({ type: "button", class: "btn w-btn" + (secondary ? " secondary" : ""), onclick: onclick }, attrs || {}), text);
  }
  function pre(text, cls) { return h("pre", { class: "w-pre" + (cls ? " " + cls : "") }, h("code", {}, text)); }
  function badge(kind, text) { return h("span", { class: "w-badge w-badge-" + kind }, text); }
  function verdict(ok, text, extra) {
    return h("div", { class: "w-verdict " + (ok === true ? "ok" : ok === false ? "bad" : "warn"), role: "status" },
      h("strong", {}, text), extra ? h("div", { class: "w-verdict-extra" }, extra) : null);
  }
  function errorBox(msg) { return h("div", { class: "w-error", role: "alert" }, msg); }
  function head(title, sub) {
    return h("div", { class: "w-head" }, h("span", { class: "w-title" }, title), sub ? h("span", { class: "w-sub" }, sub) : null);
  }
  function readJsonChild(host) {
    const s = host.querySelector('script[type="application/json"]');
    if (!s) return { error: "Missing <script type=\"application/json\"> child with the widget data." };
    try { return { value: JSON.parse(s.textContent) }; }
    catch (e) { return { error: "The widget JSON could not be parsed: " + e.message }; }
  }
  function safeJson(text, what) {
    if (!text || !text.trim()) return { empty: true, value: null };
    try { return { value: JSON.parse(text) }; }
    catch (e) { return { error: (what || "JSON") + " is not valid JSON: " + e.message }; }
  }
  LOGIC.safeJson = safeJson;

  /* ---------------------------------------------------------
     base64url + UTF-8
     --------------------------------------------------------- */
  function utf8Encode(str) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(str);
    const s = unescape(encodeURIComponent(str)), out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  function utf8Decode(bytes) {
    if (typeof TextDecoder !== "undefined") return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    let s = ""; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return decodeURIComponent(escape(s));
  }
  function b64urlEncodeBytes(bytes) {
    let s = ""; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64urlEncode(str) { return b64urlEncodeBytes(utf8Encode(str)); }
  function b64urlDecodeBytes(s) {
    s = String(s).replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
    if (/[^A-Za-z0-9+/=]/.test(s)) throw new Error("segment contains characters outside the base64url alphabet");
    while (s.length % 4) s += "=";
    const bin = atob(s), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function b64urlDecode(s) { return utf8Decode(b64urlDecodeBytes(s)); }
  LOGIC.b64urlEncode = b64urlEncode;
  LOGIC.b64urlDecode = b64urlDecode;

  /* =========================================================
     1. JWT decoder and validator
     ========================================================= */
  const JWT_ALLOWED_ALGS = ["RS256", "ES256"];
  const JWT_SAMPLE_NAMES = ["valid", "expired", "wrong-aud", "alg-none", "tampered", "hs256-confusion"];
  const JWT_DEFAULT_ISS = "https://idp.example.com/tenant-7f3a";
  const JWT_DEFAULT_AUD = "api://example-api";
  const JWT_KID = "2026-09-k1";

  function decodeJwt(token) {
    token = String(token || "").trim();
    if (!token) return { error: "Paste a token first." };
    const parts = token.split(".");
    if (parts.length !== 3) {
      return { error: "A JWS compact serialization has exactly three dot-separated segments (header.payload.signature); this string has " + parts.length + "." +
        (parts.length === 5 ? " Five segments means JWE (an encrypted token), which this decoder does not open." : "") };
    }
    let header, payload;
    try { header = JSON.parse(b64urlDecode(parts[0])); } catch (e) { return { error: "Header segment is not base64url-encoded JSON (" + e.message + ")." }; }
    try { payload = JSON.parse(b64urlDecode(parts[1])); } catch (e) { return { error: "Payload segment is not base64url-encoded JSON (" + e.message + ")." }; }
    if (!header || typeof header !== "object" || Array.isArray(header)) return { error: "Header must decode to a JSON object." };
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { error: "Payload must decode to a JSON object." };
    return { header: header, payload: payload, signature: parts[2], signingInput: parts[0] + "." + parts[1], parts: parts };
  }
  LOGIC.decodeJwt = decodeJwt;

  // Pure claim checks (no signature). opts: { iss, aud, now (seconds), skew (seconds), allowedAlgs }
  function checkJwtClaims(decoded, opts) {
    opts = opts || {};
    const now = opts.now != null ? opts.now : Math.floor(Date.now() / 1000);
    const skew = opts.skew != null ? opts.skew : 60;
    const allowed = opts.allowedAlgs || JWT_ALLOWED_ALGS;
    const hd = decoded.header, pl = decoded.payload;
    const out = [];
    function row(name, pass, detail, level) { out.push({ name: name, pass: pass, detail: detail, level: level || (pass ? "pass" : "fail") }); }

    // 1. alg allowlist
    if (hd.alg == null) row("alg allowed", false, "Header has no alg; a verifier cannot know how to check the signature, so reject.");
    else if (String(hd.alg).toLowerCase() === "none") row("alg allowed", false, "alg \"none\" means an unsecured JWT with an empty signature; anyone can mint one, so a verifier must never accept it (RFC 8725).");
    else if (allowed.indexOf(hd.alg) < 0) row("alg allowed", false, "alg " + JSON.stringify(hd.alg) + " is not in the verifier's allowlist (" + allowed.join(", ") + "); the token's own alg must never choose how it is verified (HS256 key confusion).");
    else row("alg allowed", true, "alg " + hd.alg + " is in the allowlist (" + allowed.join(", ") + ").");

    // 2. kid
    if (hd.kid == null || hd.kid === "") row("kid present", false, "No kid: the verifier cannot pick one key from the issuer's JWKS and must not try every key until one works.");
    else row("kid present", true, "kid " + JSON.stringify(hd.kid) + " selects a key from the expected issuer's JWKS.");

    // 3. typ
    if (hd.typ == null) row("typ", true, "No typ header (optional); treat as JWT.", "warn");
    else if (/^(JWT|at\+jwt|application\/at\+jwt)$/i.test(String(hd.typ))) row("typ", true, "typ " + JSON.stringify(hd.typ) + (/at\+jwt/i.test(hd.typ) ? " marks an access token (RFC 9068)." : " is a plain JWT."));
    else row("typ", false, "typ " + JSON.stringify(hd.typ) + " is not a JWT type this API accepts; a different token type (for example an ID token or a logout token) must not be accepted as an access token.");

    // 4. iss
    if (pl.iss == null) row("iss matches", false, "No iss claim; the verifier cannot know which issuer's keys to trust.");
    else if (!opts.iss) row("iss matches", true, "iss is " + JSON.stringify(pl.iss) + " (no expected issuer configured, so not compared).", "warn");
    else if (pl.iss === opts.iss) row("iss matches", true, "iss equals the expected issuer exactly.");
    else row("iss matches", false, "iss is " + JSON.stringify(pl.iss) + " but this API expects " + JSON.stringify(opts.iss) + "; a token from another tenant or IdP must be rejected even if its signature verifies.");

    // 5. aud
    const auds = pl.aud == null ? [] : (Array.isArray(pl.aud) ? pl.aud : [pl.aud]);
    if (!auds.length) row("aud matches", false, "No aud claim; without an audience any API that trusts this issuer would accept the token.");
    else if (!opts.aud) row("aud matches", true, "aud is " + JSON.stringify(pl.aud) + " (no expected audience configured, so not compared).", "warn");
    else if (auds.indexOf(opts.aud) >= 0) row("aud matches", true, "aud contains this API's identifier " + JSON.stringify(opts.aud) + ".");
    else row("aud matches", false, "aud is " + JSON.stringify(pl.aud) + ", not " + JSON.stringify(opts.aud) + "; this token was minted for a different API and replaying it here is exactly what audience checks prevent.");

    // 6. exp
    if (typeof pl.exp !== "number") row("exp in the future", false, "No numeric exp claim; a token that never expires cannot be revoked by time, so require exp.");
    else if (pl.exp + skew > now) row("exp in the future", true, "exp " + pl.exp + " (" + isoTime(pl.exp) + ") is " + relTime(pl.exp - now) + " with " + skew + " s skew.");
    else row("exp in the future", false, "exp " + pl.exp + " (" + isoTime(pl.exp) + ") passed " + relTime(now - pl.exp).replace("in ", "") + " ago, beyond the " + skew + " s skew allowance.");

    // 7. nbf
    if (pl.nbf == null) row("nbf", true, "No nbf claim (optional).", "warn");
    else if (typeof pl.nbf !== "number") row("nbf", false, "nbf must be a NumericDate (seconds since epoch).");
    else if (pl.nbf - skew <= now) row("nbf", true, "nbf " + pl.nbf + " (" + isoTime(pl.nbf) + ") has been reached.");
    else row("nbf", false, "nbf " + pl.nbf + " (" + isoTime(pl.nbf) + ") is still " + relTime(pl.nbf - now) + "; the token is not valid yet even with " + skew + " s skew.");

    // 8. iat sanity
    if (pl.iat == null) row("iat sanity", false, "No iat claim; many APIs require it to bound token age (PyJWT option require: [\"iat\"]).");
    else if (typeof pl.iat !== "number") row("iat sanity", false, "iat must be a NumericDate (seconds since epoch).");
    else if (pl.iat - skew > now) row("iat sanity", false, "iat " + pl.iat + " (" + isoTime(pl.iat) + ") is in the future beyond the skew allowance, which means a forged or badly clocked issuer.");
    else if (typeof pl.exp === "number" && pl.exp < pl.iat) row("iat sanity", false, "exp is earlier than iat; the token expired before it was issued.");
    else if (typeof pl.exp === "number" && pl.exp - pl.iat > 24 * 3600) row("iat sanity", true, "iat " + isoTime(pl.iat) + "; lifetime is " + Math.round((pl.exp - pl.iat) / 3600) + " h, which is long for an access token.", "warn");
    else row("iat sanity", true, "iat " + pl.iat + " (" + isoTime(pl.iat) + ") is not in the future" + (typeof pl.exp === "number" ? "; lifetime " + Math.round((pl.exp - pl.iat) / 60) + " min." : "."));

    // 9. sub
    if (pl.sub == null || pl.sub === "") row("sub present", false, "No sub claim; the API has no principal to authorize.", "warn");
    else row("sub present", true, "sub " + JSON.stringify(pl.sub) + " identifies the principal (key user records on iss + sub, never email).");
    return out;
  }
  LOGIC.checkJwtClaims = checkJwtClaims;

  function isoTime(sec) { try { return new Date(sec * 1000).toISOString().replace(".000Z", "Z"); } catch (e) { return "invalid date"; } }
  function relTime(deltaSec) {
    const d = Math.abs(deltaSec);
    const s = d < 90 ? d + " s" : d < 5400 ? Math.round(d / 60) + " min" : d < 172800 ? Math.round(d / 3600) + " h" : Math.round(d / 86400) + " d";
    return deltaSec >= 0 ? "in " + s : s + " ago";
  }

  // ----- WebCrypto: RSA key pair generated at load, samples minted from it -----
  const subtle = (typeof crypto !== "undefined" && crypto.subtle) ? crypto.subtle : null;
  let jwtKeysPromise = null;
  function jwtKeys() {
    if (!subtle) return Promise.resolve(null);
    if (!jwtKeysPromise) {
      jwtKeysPromise = subtle.generateKey(
        { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
        true, ["sign", "verify"]
      ).then(function (pair) {
        return subtle.exportKey("spki", pair.publicKey).then(function (spki) {
          return { pair: pair, spki: new Uint8Array(spki) };
        });
      }).catch(function (e) { console.warn("widgets.js: RSA key generation failed", e); return null; });
    }
    return jwtKeysPromise;
  }
  function signRs256(keys, signingInput) {
    return subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, keys.pair.privateKey, utf8Encode(signingInput)).then(function (sig) { return b64urlEncodeBytes(new Uint8Array(sig)); });
  }
  function hmacWithPublicKey(keys, signingInput) {
    // The HS256 confusion attack: the attacker uses the RSA *public* key bytes as the HMAC secret.
    return subtle.importKey("raw", keys.spki, { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
      .then(function (k) { return subtle.sign("HMAC", k, utf8Encode(signingInput)); })
      .then(function (sig) { return b64urlEncodeBytes(new Uint8Array(sig)); });
  }
  function mintJwtSamples(keys, opts) {
    opts = opts || {};
    const now = Math.floor(Date.now() / 1000);
    const iss = opts.iss || JWT_DEFAULT_ISS, aud = opts.aud || JWT_DEFAULT_AUD;
    const baseHeader = { alg: "RS256", typ: "JWT", kid: JWT_KID };
    const basePayload = { iss: iss, sub: "a1b2c3d4-9e8f-4c7b-a6d5-0e1f2a3b4c5d", aud: aud, iat: now, nbf: now, exp: now + 600, jti: "7d0f2a3b-1c4e-4f5a-9b8c-2d3e4f5a6b7c", scope: "docs.read" };
    const specs = {
      "valid": { header: baseHeader, payload: basePayload },
      "expired": { header: baseHeader, payload: Object.assign({}, basePayload, { iat: now - 4200, nbf: now - 4200, exp: now - 3600 }) },
      "wrong-aud": { header: baseHeader, payload: Object.assign({}, basePayload, { aud: "https://graph.microsoft.com" }) },
      "alg-none": { header: { alg: "none", typ: "JWT", kid: JWT_KID }, payload: Object.assign({}, basePayload, { sub: "admin", scope: "docs.read docs.admin" }), sig: "none" },
      "tampered": { header: baseHeader, payload: basePayload, tamper: { sub: "admin", scope: "docs.read docs.admin" } },
      "hs256-confusion": { header: { alg: "HS256", typ: "JWT", kid: JWT_KID }, payload: Object.assign({}, basePayload, { sub: "admin", scope: "docs.read docs.admin" }), sig: "hmac-public-key" }
    };
    const out = {};
    const jobs = Object.keys(specs).map(function (name) {
      const s = specs[name];
      const hb = b64urlEncode(JSON.stringify(s.header));
      const pb = b64urlEncode(JSON.stringify(s.payload));
      const signingInput = hb + "." + pb;
      let p;
      if (s.sig === "none") p = Promise.resolve("");
      else if (!keys) p = Promise.resolve("c2lnbmF0dXJlLWNoZWNrLXVuYXZhaWxhYmxl");
      else if (s.sig === "hmac-public-key") p = hmacWithPublicKey(keys, signingInput);
      else p = signRs256(keys, signingInput);
      return p.then(function (sig) {
        if (s.tamper) {
          // keep the original signature, change the payload
          const pb2 = b64urlEncode(JSON.stringify(Object.assign({}, s.payload, s.tamper)));
          out[name] = hb + "." + pb2 + "." + sig;
        } else {
          out[name] = signingInput + "." + sig;
        }
      });
    });
    return Promise.all(jobs).then(function () { return out; });
  }
  LOGIC.mintJwtSamples = mintJwtSamples;

  function verifyJwtSignature(decoded, keys) {
    const alg = decoded.header.alg;
    if (!subtle) return Promise.resolve({ pass: null, detail: "Signature check unavailable in this browser (no WebCrypto)." });
    if (!keys) return Promise.resolve({ pass: null, detail: "Signature check unavailable: the demo key pair could not be generated." });
    if (alg == null || String(alg).toLowerCase() === "none") {
      return Promise.resolve({ pass: false, detail: decoded.signature === "" ? "Empty signature: nothing to verify, so nothing proves who wrote this payload." : "alg none with a non-empty signature segment; still nothing verifiable." });
    }
    if (alg === "HS256" || alg === "HS384" || alg === "HS512") {
      // Show why dispatching on the token's alg is fatal.
      return hmacWithPublicKey(keys, decoded.signingInput).then(function (mac) {
        const same = mac === decoded.signature;
        return { pass: false, detail: same
          ? "Not verified: alg is HMAC. Note the HMAC of this token computed with the RSA public key as the secret DOES match, which is how a library that trusts the token's alg would have accepted this forgery."
          : "Not verified: HMAC algorithms are not allowed for tokens from an IdP that signs with RSA; the verifier must not switch to HMAC because the token asks it to." };
      });
    }
    if (alg !== "RS256") return Promise.resolve({ pass: false, detail: "No verification key for alg " + alg + " in this demo (only the generated RS256 key)." });
    let sig;
    try { sig = b64urlDecodeBytes(decoded.signature); } catch (e) { return Promise.resolve({ pass: false, detail: "Signature segment is not valid base64url." }); }
    return subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, keys.pair.publicKey, sig, utf8Encode(decoded.signingInput)).then(function (ok) {
      return { pass: ok, detail: ok
        ? "RSASSA-PKCS1-v1_5 / SHA-256 signature verifies with the public key for kid " + JSON.stringify(decoded.header.kid) + "."
        : "Signature does not verify: the header or payload was changed after signing, or a different key signed it." };
    }).catch(function (e) { return { pass: false, detail: "Verification threw: " + e.message }; });
  }

  function renderJwt(host) {
    const ds = host.dataset;
    const expectedIss = ds.iss || JWT_DEFAULT_ISS, expectedAud = ds.aud || JWT_DEFAULT_AUD;
    const initial = JWT_SAMPLE_NAMES.indexOf(ds.sample) >= 0 ? ds.sample : "valid";
    let samples = null, keys = null;

    const tokenArea = textarea({ rows: 5, "aria-label": "JWT to decode" });
    const sampleSel = select(JWT_SAMPLE_NAMES.map(function (n) { return [n, n]; }), initial);
    const issIn = input({ value: expectedIss, size: 38 });
    const audIn = input({ value: expectedAud, size: 24 });
    const status = h("div", { class: "w-muted", role: "status" }, subtle ? "Generating a 2048-bit RSA key pair with WebCrypto and minting the samples…" : "Signature check unavailable in this browser (no WebCrypto). Claim checks still run.");
    const decodedBox = h("div", { class: "w-grid3 w-jwt-decoded" });
    const checkBox = h("div", { class: "w-checklist", "aria-live": "polite" });

    function loadSample(name) {
      if (!samples) return;
      tokenArea.value = samples[name] || "";
      clear(checkBox);
      showDecoded();
    }
    function showDecoded() {
      clear(decodedBox);
      const d = decodeJwt(tokenArea.value);
      if (d.error) { decodedBox.append(errorBox(d.error)); return null; }
      decodedBox.append(
        h("div", {}, h("div", { class: "w-label" }, "Header"), pre(JSON.stringify(d.header, null, 2), "w-pre-header")),
        h("div", {}, h("div", { class: "w-label" }, "Payload"), pre(JSON.stringify(d.payload, null, 2), "w-pre-payload")),
        h("div", {}, h("div", { class: "w-label" }, "Signature (base64url, " + d.signature.length + " chars)"),
          pre(d.signature ? d.signature.replace(/(.{32})/g, "$1\n") : "(empty)", "w-pre-sig"),
          h("p", { class: "w-muted" }, "Signed input is header.payload as received. Times: " +
            ["iat", "nbf", "exp"].filter(function (k) { return typeof d.payload[k] === "number"; }).map(function (k) { return k + " = " + isoTime(d.payload[k]); }).join(", "))));
      return d;
    }
    function validate() {
      const d = showDecoded();
      clear(checkBox);
      if (!d) return;
      const rows = checkJwtClaims(d, { iss: issIn.value.trim(), aud: audIn.value.trim(), skew: 60 });
      const table = h("table", { class: "w-table" }, h("thead", {}, h("tr", {}, h("th", {}, "Check"), h("th", {}, "Result"), h("th", {}, "Why"))));
      const tb = h("tbody");
      rows.forEach(function (r) { tb.append(h("tr", { class: "w-row-" + r.level }, h("td", {}, r.name), h("td", {}, badge(r.level, r.level === "pass" ? "pass" : r.level === "warn" ? "note" : "FAIL")), h("td", {}, r.detail))); });
      const sigRow = h("tr", { class: "w-row-warn" }, h("td", {}, "signature verifies"), h("td", {}, badge("warn", "…")), h("td", {}, "checking…"));
      tb.append(sigRow);
      table.append(tb);
      checkBox.append(table);
      const v = h("div");
      checkBox.append(v);
      verifyJwtSignature(d, keys).then(function (res) {
        const level = res.pass === true ? "pass" : res.pass === false ? "fail" : "warn";
        sigRow.className = "w-row-" + level;
        clear(sigRow.children[1]); sigRow.children[1].append(badge(level, res.pass === true ? "pass" : res.pass === false ? "FAIL" : "n/a"));
        sigRow.children[2].textContent = res.detail;
        const fails = rows.filter(function (r) { return r.level === "fail"; }).length + (res.pass === false ? 1 : 0);
        v.append(verdict(fails === 0 && res.pass !== null ? true : fails === 0 ? null : false,
          fails === 0 ? (res.pass === null ? "Claims pass; signature not checked" : "Token accepted") : "Token rejected: " + fails + " check" + (fails > 1 ? "s" : "") + " failed",
          fails === 0 ? "Only now may the API read sub, scope and roles and make an authorization decision." : "Reject with 401 and WWW-Authenticate: Bearer error=\"invalid_token\". Do not read claims from a token that failed any check."));
      });
    }

    host.append(
      head("JWT decoder and validator", "RFC 7519 / 8725 checklist with a real RS256 signature check"),
      h("div", { class: "w-row" },
        field("Sample", sampleSel),
        field("Expected issuer (iss)", issIn),
        field("Expected audience (aud)", audIn)),
      field("Token", tokenArea, "Paste any JWT, or pick a sample. Nothing leaves this page."),
      h("div", { class: "w-btns" }, button("Validate", validate), button("Decode only", function () { clear(checkBox); showDecoded(); }, true), status),
      decodedBox, checkBox);
    sampleSel.addEventListener("change", function () { loadSample(sampleSel.value); });
    tokenArea.addEventListener("input", function () { clear(checkBox); });

    jwtKeys().then(function (k) {
      keys = k;
      return mintJwtSamples(k, { iss: expectedIss, aud: expectedAud });
    }).then(function (s) {
      samples = s;
      status.textContent = keys ? "Samples minted with a fresh in-page RSA key (kid " + JWT_KID + "). Reload the page and every sample changes." : "Signature check unavailable in this browser (no WebCrypto). Samples carry a placeholder signature.";
      loadSample(initial);
    });
  }

  /* =========================================================
     2. Cookie / SameSite simulator
     ========================================================= */
  const COOKIE_SCENARIOS = [
    ["same-site-xhr", "Same-site XHR: page on app.example.com calls api.example.com with credentials"],
    ["toplevel-get", "Top-level cross-site GET navigation: link on evil.example to app.example.com"],
    ["cross-post", "Cross-site form POST: evil.example auto-submits a form to app.example.com"],
    ["cross-img", "Cross-site image / GET subresource: <img src=\"https://app.example.com/...\"> on evil.example"],
    ["iframe", "Iframe embed: portal.partner.example embeds https://app.example.com/widget"],
    ["http", "Request over http://: user opens http://app.example.com/ (no TLS)"],
    ["js-read", "JavaScript document.cookie read on app.example.com"]
  ];
  // opts: { httpOnly, secure, sameSite: "Strict"|"Lax"|"None", domain: ""|"example.com", hostPrefix, scenario }
  function cookieSim(o) {
    const name = o.hostPrefix ? "__Host-sid" : "sid";
    const attrs = [name + "=abc123", "Path=/"];
    if (o.domain) attrs.push("Domain=" + o.domain);
    if (o.secure) attrs.push("Secure");
    if (o.httpOnly) attrs.push("HttpOnly");
    attrs.push("SameSite=" + o.sameSite);
    const setCookie = "Set-Cookie: " + attrs.join("; ");
    const rules = [], seq = [];
    seq.push("Server at https://app.example.com answers a login with: " + setCookie);

    // Step 1: does the browser store it at all?
    let accepted = true;
    if (o.sameSite === "None" && !o.secure) { accepted = false; rules.push("SameSite=None requires Secure; the browser rejects the Set-Cookie outright (RFC 6265bis, \"Lax by default\" rules)."); }
    if (o.hostPrefix) {
      if (!o.secure) { accepted = false; rules.push("__Host- prefix requires the Secure attribute; without it the browser rejects the cookie."); }
      if (o.domain) { accepted = false; rules.push("__Host- prefix forbids a Domain attribute (the cookie must be host-only) and requires Path=/; with Domain=" + o.domain + " the browser rejects it."); }
      if (accepted) rules.push("__Host- prefix accepted: Secure, no Domain, Path=/. No subdomain can overwrite this cookie.");
    }
    if (!accepted) {
      seq.push("Browser: Set-Cookie violates a prefix or SameSite rule, so the cookie is NOT stored.");
      return { name: name, setCookie: setCookie, accepted: false, sent: false, readable: false, rules: rules, seq: seq,
        summary: "The browser never stored this cookie, so it is neither sent nor readable." };
    }
    seq.push("Browser stores " + name + " for " + (o.domain ? "*." + o.domain + " (Domain attribute)" : "app.example.com only (host-only, no Domain attribute)") + ".");

    const readable = !o.httpOnly;
    rules.push(o.httpOnly ? "HttpOnly hides the cookie from document.cookie; the browser still attaches it to requests, so injected script can ride the session but not steal it."
                          : "No HttpOnly: any script on the page, including injected XSS payloads, can read this cookie with document.cookie.");

    if (o.scenario === "js-read") {
      seq.push("Script on https://app.example.com runs document.cookie.");
      seq.push(readable ? "Result includes " + name + "=abc123." : "Result does not include " + name + " (HttpOnly).");
      return { name: name, setCookie: setCookie, accepted: true, sent: null, readable: readable, rules: rules, seq: seq,
        summary: readable ? "Readable by script. An XSS payload could exfiltrate this session." : "Not readable by script. XSS cannot steal it (it can still use it by making requests from the page)." };
    }

    let sent = true;
    const target = o.scenario === "same-site-xhr" ? "api.example.com" : "app.example.com";
    const https = o.scenario !== "http";
    const scenarioLine = {
      "same-site-xhr": "Page on https://app.example.com runs fetch(\"https://api.example.com/threads\", { credentials: \"include\" }). Same site (registrable domain example.com), different origin.",
      "toplevel-get": "User on https://evil.example clicks <a href=\"https://app.example.com/approve?id=7\">. Cross-site, top-level navigation, method GET.",
      "cross-post": "Page on https://evil.example auto-submits <form method=\"POST\" action=\"https://app.example.com/api/share\">. Cross-site, top-level, unsafe method.",
      "cross-img": "Page on https://evil.example loads <img src=\"https://app.example.com/avatar.png\">. Cross-site subresource (not top-level).",
      "iframe": "https://portal.partner.example renders <iframe src=\"https://app.example.com/widget\">. Cross-site embedded document (not top-level).",
      "http": "User opens http://app.example.com/ over plain HTTP. Same host, insecure scheme."
    }[o.scenario];
    seq.push(scenarioLine);
    seq.push("Browser builds the request to " + (https ? "https" : "http") + "://" + target + " and consults the cookie jar.");

    // Domain match
    if (target !== "app.example.com") {
      if (!o.domain) { sent = false; rules.push("Without a Domain attribute the cookie is host-only: it is sent to app.example.com only, never to api.example.com (RFC 6265 §5.1.3)."); }
      else rules.push("Domain=" + o.domain + " makes the cookie domain-matched, so api.example.com receives it as well. Every subdomain, including a compromised blog.example.com, can also receive and overwrite it.");
    }
    // Secure
    if (!https && o.secure) { sent = false; rules.push("Secure requires an https:// request; over http:// the browser withholds the cookie so it cannot be sniffed on the network."); }
    else if (!https && !o.secure) rules.push("No Secure attribute: the cookie travels over plain http:// where any network hop can read it. Always set Secure.");
    // SameSite
    const crossSite = ["toplevel-get", "cross-post", "cross-img", "iframe"].indexOf(o.scenario) >= 0;
    if (crossSite) {
      if (o.sameSite === "Strict") { sent = false; rules.push("SameSite=Strict: never sent on a request initiated by another site, including this one."); }
      else if (o.sameSite === "Lax") {
        if (o.scenario === "toplevel-get") rules.push("SameSite=Lax top-level GET exemption: Lax cookies ARE sent on cross-site top-level navigations with a safe method (GET/HEAD). If /approve changes state on GET, this is a CSRF hole.");
        else { sent = false; rules.push("SameSite=Lax: withheld on cross-site " + (o.scenario === "cross-post" ? "POST (unsafe method)" : o.scenario === "cross-img" ? "subresource loads" : "iframe documents") + "; only top-level GET navigations get the Lax exemption."); }
      } else rules.push("SameSite=None; Secure: sent on every cross-site request, so classic CSRF is back and a second defense (Origin check, synchronizer token, custom header) is mandatory.");
    } else if (o.scenario === "same-site-xhr") {
      rules.push("app.example.com and api.example.com are the same site (scheme + registrable domain), so SameSite=" + o.sameSite + " does not block this request.");
    } else if (o.scenario === "http") {
      rules.push("Modern browsers use schemeful same-site: http://app.example.com and https://app.example.com count as different sites, so Strict/Lax cookies may also be withheld here even without Secure.");
    }
    seq.push(sent ? "Cookie jar: " + name + " matches host, scheme and SameSite rules; header Cookie: " + name + "=abc123 attached."
                  : "Cookie jar: " + name + " fails a rule above; request sent WITHOUT a Cookie header.");
    seq.push(sent ? "Server sees an authenticated request" + (crossSite ? " that the user never intended (CSRF unless a second defense catches it)." : ".")
                  : "Server sees an anonymous request and answers 401 or shows the login page.");
    return { name: name, setCookie: setCookie, accepted: true, sent: sent, readable: readable, rules: rules, seq: seq,
      summary: (sent ? "Cookie sent." : "Cookie not sent.") + (readable ? " Readable by script." : " Not readable by script.") };
  }
  LOGIC.cookieSim = cookieSim;

  function renderCookieSim(host) {
    const ds = host.dataset;
    const httpOnly = checkbox("HttpOnly", ds.httponly !== "false");
    const secure = checkbox("Secure", ds.secure !== "false");
    const hostPrefix = checkbox("__Host- prefix", ds.hostPrefix === "true");
    const sameSite = select(["Strict", "Lax", "None"], ds.samesite || "Lax");
    const domain = select([["", "(none: host-only)"], ["example.com", "example.com"]], ds.domain || "");
    const scenario = select(COOKIE_SCENARIOS, ds.scenario || "cross-post");
    const out = h("div", { class: "w-out", "aria-live": "polite" });
    function run() {
      const r = cookieSim({ httpOnly: httpOnly.firstChild.checked, secure: secure.firstChild.checked, hostPrefix: hostPrefix.firstChild.checked,
        sameSite: sameSite.value, domain: domain.value, scenario: scenario.value });
      clear(out);
      out.append(
        pre(r.setCookie),
        h("div", { class: "w-kv" },
          h("div", {}, h("span", { class: "w-label" }, "Cookie sent: "), r.sent === null ? badge("warn", "n/a (no request)") : badge(r.sent ? "pass" : "fail", r.sent ? "yes" : "no")),
          h("div", {}, h("span", { class: "w-label" }, "Readable by script: "), badge(r.readable ? "fail" : "pass", r.readable ? "yes" : "no"))),
        h("p", {}, r.summary),
        h("div", { class: "w-label" }, "Rules that decided it"),
        h("ul", { class: "w-rules" }, r.rules.map(function (t) { return h("li", {}, t); })),
        h("div", { class: "w-label" }, "What the browser does"),
        h("ol", { class: "w-seq" }, r.seq.map(function (t) { return h("li", {}, t); })));
    }
    host.append(
      head("Cookie and SameSite simulator", "Cookie set by https://app.example.com with Path=/"),
      h("div", { class: "w-row" }, httpOnly, secure, hostPrefix, field("SameSite", sameSite), field("Domain", domain)),
      field("Scenario", scenario),
      h("div", { class: "w-btns" }, button("Run", run)),
      out);
    [httpOnly, secure, hostPrefix, sameSite, domain, scenario].forEach(function (c) { c.addEventListener("change", run); });
    run();
  }

  /* =========================================================
     3. CORS simulator
     ========================================================= */
  const CORS_SAFE_HEADERS = ["accept", "accept-language", "content-language", "content-type", "range"];
  const CORS_SIMPLE_CT = ["application/x-www-form-urlencoded", "multipart/form-data", "text/plain"];
  function parseHeaderList(text) {
    return String(text || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean).map(function (s) {
      const i = s.indexOf(":");
      return i < 0 ? { name: s.toLowerCase(), value: "" } : { name: s.slice(0, i).trim().toLowerCase(), value: s.slice(i + 1).trim() };
    });
  }
  function parseTokenList(text) { return String(text || "").split(",").map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean); }
  function originOf(url) {
    const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)/i.exec(String(url || "").trim());
    return m ? (m[1].toLowerCase() + "://" + m[2].toLowerCase()) : String(url || "").trim().toLowerCase();
  }
  // o: { origin, serverOrigin, method, headers: "Authorization, Content-Type: application/json", credentials,
  //      allowOrigin (value | "*" | "reflect"), allowCredentials, allowMethods, allowHeaders }
  function corsSim(o) {
    const origin = originOf(o.origin), server = originOf(o.serverOrigin || "https://api.example.com");
    const method = String(o.method || "GET").toUpperCase();
    const headers = parseHeaderList(o.headers);
    const reasons = [], steps = [];
    const res = { sameOrigin: false, preflight: false, preflightPass: null, sent: false, readable: false, misconfig: false, reasons: reasons, steps: steps };
    if (origin === server) {
      res.sameOrigin = true; res.sent = true; res.readable = true;
      reasons.push("Request origin equals the server origin: same-origin, CORS is not involved at all.");
      steps.push("Browser: " + method + " " + server + "/… is same-origin. No Origin check, no preflight, response fully readable.");
      return res;
    }
    // Is it a "simple" request?
    const nonSimpleHeaders = headers.filter(function (hd) {
      if (CORS_SAFE_HEADERS.indexOf(hd.name) < 0) return true;
      if (hd.name === "content-type") {
        const v = (hd.value || "application/json").split(";")[0].trim().toLowerCase();
        return CORS_SIMPLE_CT.indexOf(v) < 0;
      }
      return false;
    });
    const simpleMethod = ["GET", "HEAD", "POST"].indexOf(method) >= 0;
    res.preflight = !simpleMethod || nonSimpleHeaders.length > 0;
    steps.push("Page at " + origin + " calls fetch(\"" + server + "/…\", { method: \"" + method + "\"" + (headers.length ? ", headers: {" + headers.map(function (x) { return x.name + (x.value ? ": " + x.value : ""); }).join(", ") + "}" : "") + (o.credentials ? ", credentials: \"include\"" : "") + " }).");
    if (res.preflight) {
      steps.push("Not a simple request (" + (!simpleMethod ? "method " + method : "") + (!simpleMethod && nonSimpleHeaders.length ? " and " : "") + (nonSimpleHeaders.length ? "header " + nonSimpleHeaders.map(function (x) { return x.name; }).join(", ") : "") + "): browser sends OPTIONS preflight with Origin: " + origin + ", Access-Control-Request-Method: " + method + (nonSimpleHeaders.length ? ", Access-Control-Request-Headers: " + nonSimpleHeaders.map(function (x) { return x.name; }).join(", ") : "") + ". No cookies or Authorization on the preflight.");
    } else {
      steps.push("Simple request (GET/HEAD/POST with safelisted headers): browser sends it immediately with Origin: " + origin + (o.credentials ? " and cookies attached" : "") + ". The server processes it whether or not CORS passes.");
    }
    // Effective Allow-Origin
    let acao = String(o.allowOrigin || "").trim();
    if (acao.toLowerCase() === "reflect") { acao = origin; res.misconfig = true; }
    else if (acao && acao !== "*") acao = originOf(acao);
    let originOk;
    if (!acao) { originOk = false; reasons.push("No Access-Control-Allow-Origin header on the response: the browser blocks the page from reading it."); }
    else if (acao === "*") {
      if (o.credentials) { originOk = false; reasons.push("Access-Control-Allow-Origin: * cannot be used with credentials; the browser rejects the combination even if Allow-Credentials is true."); }
      else { originOk = true; reasons.push("Access-Control-Allow-Origin: * accepts any origin for this non-credentialed request."); }
    } else if (acao === origin) { originOk = true; reasons.push("Access-Control-Allow-Origin " + acao + " matches the request Origin exactly" + (res.misconfig ? " because the server reflected it back" : "") + "."); }
    else { originOk = false; reasons.push("origin mismatch: Access-Control-Allow-Origin is " + acao + " but the request Origin is " + origin + "."); }

    const allowMethods = parseTokenList(o.allowMethods), allowHeaders = parseTokenList(o.allowHeaders);
    if (res.preflight) {
      let methodOk = simpleMethod || allowMethods.indexOf(method.toLowerCase()) >= 0 || (allowMethods.indexOf("*") >= 0 && !o.credentials);
      if (!methodOk) reasons.push("method " + method + " not in Access-Control-Allow-Methods (" + (allowMethods.join(", ") || "none") + ")" + (allowMethods.indexOf("*") >= 0 ? "; * is a literal, not a wildcard, on credentialed requests" : "") + ".");
      let headersOk = true;
      nonSimpleHeaders.forEach(function (hd) {
        const ok = allowHeaders.indexOf(hd.name) >= 0 || (allowHeaders.indexOf("*") >= 0 && !o.credentials && hd.name !== "authorization");
        if (!ok) { headersOk = false; reasons.push("header " + hd.name + " not in Access-Control-Allow-Headers (" + (allowHeaders.join(", ") || "none") + ")" + (hd.name === "authorization" && allowHeaders.indexOf("*") >= 0 ? "; Authorization must be listed explicitly, * never covers it" : "") + "."); }
      });
      res.preflightPass = originOk && methodOk && headersOk;
      steps.push("Server answers the preflight: Access-Control-Allow-Origin: " + (o.allowOrigin || "(missing)") + (allowMethods.length ? "; Allow-Methods: " + allowMethods.join(", ") : "") + (allowHeaders.length ? "; Allow-Headers: " + allowHeaders.join(", ") : "") + (o.allowCredentials ? "; Allow-Credentials: true" : "") + ".");
      if (res.preflightPass) { steps.push("Preflight passes; browser sends the real " + method + (o.credentials ? " with cookies" : "") + "."); res.sent = true; }
      else { steps.push("Preflight FAILS: the real request is never sent. This is the only case where CORS stops a request from reaching the server."); res.sent = false; }
    } else {
      res.sent = true;
    }
    if (res.sent) {
      let credOk = true;
      if (o.credentials && !o.allowCredentials) { credOk = false; reasons.push("credentialed request needs Access-Control-Allow-Credentials: true on the response; without it the browser hides the response."); }
      res.readable = originOk && credOk;
      steps.push("Server processes the request and responds" + (o.allowOrigin ? " with Access-Control-Allow-Origin: " + (res.misconfig ? origin + " (reflected)" : acao) : " without Access-Control-Allow-Origin") + (o.allowCredentials ? " and Access-Control-Allow-Credentials: true" : "") + ".");
      steps.push(res.readable ? "Browser lets the page read the response body and safelisted headers." : "Browser blocks the page from reading the response (a \"CORS error\" in the console), even though the server already executed it.");
    }
    if (res.misconfig && o.allowCredentials) reasons.push("DANGER: reflecting the request Origin together with Allow-Credentials: true lets ANY site make cookie-authenticated requests to this API and read the results. Worse than *, because * cannot be combined with credentials.");
    else if (res.misconfig) reasons.push("Reflecting the request Origin is equivalent to * for non-credentialed requests; fine for a public read-only API, dangerous the day someone adds Allow-Credentials.");
    return res;
  }
  LOGIC.corsSim = corsSim;

  const CORS_PRESETS = {
    "simple-get": { origin: "https://app.example.com", method: "GET", headers: "", credentials: false, allowOrigin: "https://app.example.com", allowCredentials: false, allowMethods: "", allowHeaders: "" },
    "json-post-auth": { origin: "https://app.example.com", method: "POST", headers: "Authorization, Content-Type: application/json", credentials: false, allowOrigin: "https://app.example.com", allowCredentials: false, allowMethods: "POST", allowHeaders: "authorization, content-type" },
    "reflected-origin": { origin: "https://evil.example", method: "POST", headers: "Content-Type: application/json", credentials: true, allowOrigin: "reflect", allowCredentials: true, allowMethods: "GET, POST", allowHeaders: "content-type" }
  };
  function renderCorsSim(host) {
    const ds = host.dataset;
    const presetSel = select([["simple-get", "Simple GET"], ["json-post-auth", "JSON POST with Authorization header"], ["reflected-origin", "Reflected-origin misconfiguration"]], CORS_PRESETS[ds.preset] ? ds.preset : "simple-get");
    const origin = input({ size: 28 }), method = select(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]), headers = input({ size: 40, placeholder: "Authorization, Content-Type: application/json" });
    const credentials = checkbox("credentials: \"include\" (send cookies)", false);
    const serverOrigin = input({ value: ds.server || "https://api.example.com", size: 26 });
    const allowOrigin = input({ size: 28, placeholder: "https://app.example.com, * or reflect" });
    const allowCredentials = checkbox("Access-Control-Allow-Credentials: true", false);
    const allowMethods = input({ size: 20, placeholder: "GET, POST" }), allowHeaders = input({ size: 28, placeholder: "authorization, content-type" });
    const out = h("div", { class: "w-out", "aria-live": "polite" });
    function apply(p) {
      origin.value = p.origin; method.value = p.method; headers.value = p.headers; credentials.firstChild.checked = p.credentials;
      allowOrigin.value = p.allowOrigin; allowCredentials.firstChild.checked = p.allowCredentials; allowMethods.value = p.allowMethods; allowHeaders.value = p.allowHeaders;
      run();
    }
    function run() {
      const r = corsSim({ origin: origin.value, serverOrigin: serverOrigin.value, method: method.value, headers: headers.value, credentials: credentials.firstChild.checked,
        allowOrigin: allowOrigin.value, allowCredentials: allowCredentials.firstChild.checked, allowMethods: allowMethods.value, allowHeaders: allowHeaders.value });
      clear(out);
      out.append(
        h("div", { class: "w-kv" },
          h("div", {}, h("span", { class: "w-label" }, "Preflight needed: "), badge(r.sameOrigin ? "pass" : r.preflight ? "warn" : "pass", r.sameOrigin ? "no (same-origin)" : r.preflight ? "yes" : "no")),
          r.preflight ? h("div", {}, h("span", { class: "w-label" }, "Preflight passes: "), badge(r.preflightPass ? "pass" : "fail", r.preflightPass ? "yes" : "no")) : null,
          h("div", {}, h("span", { class: "w-label" }, "Request reaches server: "), badge(r.sent ? "warn" : "pass", r.sent ? "yes" : "no")),
          h("div", {}, h("span", { class: "w-label" }, "Response readable by page: "), badge(r.readable ? (r.misconfig ? "fail" : "pass") : "fail", r.readable ? "yes" : "no"))),
        r.misconfig && r.readable ? verdict(false, "Misconfiguration: any origin can read authenticated responses", "The server echoes whatever Origin it receives. Use an allowlist and send Vary: Origin.") : null,
        h("div", { class: "w-label" }, "Reasons"),
        h("ul", { class: "w-rules" }, r.reasons.map(function (t) { return h("li", {}, t); })),
        h("div", { class: "w-label" }, "Sequence"),
        h("ol", { class: "w-seq" }, r.steps.map(function (t) { return h("li", {}, t); })),
        h("p", { class: "w-muted" }, "Remember: CORS is enforced by browsers only. curl, Python and agents ignore it, and it is not a CSRF defense (the request above was still sent unless a preflight failed)."));
    }
    host.append(
      head("CORS simulator", "Fetch standard rules for simple and preflighted requests"),
      field("Preset", presetSel),
      h("fieldset", { class: "w-fieldset" }, h("legend", {}, "Request (from the page)"),
        h("div", { class: "w-row" }, field("Page origin", origin), field("Method", method), field("Custom headers (comma list, Name or Name: value)", headers), credentials)),
      h("fieldset", { class: "w-fieldset" }, h("legend", {}, "Server response headers"),
        h("div", { class: "w-row" }, field("API origin", serverOrigin), field("Access-Control-Allow-Origin", allowOrigin), allowCredentials, field("Access-Control-Allow-Methods", allowMethods), field("Access-Control-Allow-Headers", allowHeaders))),
      h("div", { class: "w-btns" }, button("Evaluate", run)),
      out);
    presetSel.addEventListener("change", function () { apply(CORS_PRESETS[presetSel.value]); });
    [origin, method, headers, credentials, serverOrigin, allowOrigin, allowCredentials, allowMethods, allowHeaders].forEach(function (c) { c.addEventListener("change", run); });
    apply(CORS_PRESETS[presetSel.value]);
  }

  /* =========================================================
     4. OAuth step-through sequence diagrams
     ========================================================= */
  // Participants: { id, name, kind (box class suffix) }. Steps: { from, to, label, params:[..], why, dashed }
  const OAUTH_FLOWS = {
    "auth-code-pkce": {
      title: "Authorization code + PKCE (RFC 6749 §4.1, RFC 7636, RFC 8707)",
      participants: [
        { id: "user", name: "User (browser)", kind: "accent" },
        { id: "client", name: "Agent app (public client)", kind: "accent" },
        { id: "as", name: "Authorization server", kind: "purple" },
        { id: "rs", name: "MCP server (resource)", kind: "ok" }
      ],
      steps: [
        { from: "user", to: "client", label: "User clicks \"Sign in\"", params: ["client generates: code_verifier = dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk (43-128 chars, kept in memory)", "code_challenge = BASE64URL(SHA256(code_verifier)) = E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", "state = af0ifjsldkj, nonce = n-0S6_WzA2Mj"],
          why: "The client is public (a desktop or CLI agent cannot keep a secret), so it needs proof it can carry across the flow: the code_verifier never leaves its memory, only the hash does." },
        { from: "client", to: "as", label: "302 → GET /authorize (front channel, via the browser)", params: ["response_type=code", "client_id=agent-app", "redirect_uri=http://127.0.0.1:53211/callback", "scope=openid documents.read", "state=af0ifjsldkj", "nonce=n-0S6_WzA2Mj", "code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", "code_challenge_method=S256", "resource=https://mcp.example.com/mcp"],
          why: "code_challenge binds the request to a verifier only this client holds (RFC 7636); state defends the redirect endpoint against CSRF; resource asks for a token whose aud is exactly this MCP server (RFC 8707)." },
        { from: "user", to: "as", label: "User authenticates (MFA) and consents", params: ["credentials go to the AS only", "consent screen shows client name and scopes: documents.read"],
          why: "The client never sees a password. This is the delegation OAuth was built for: the user grants a scoped capability without sharing credentials." },
        { from: "as", to: "client", label: "302 → redirect_uri?code=…&state=… (front channel)", params: ["code=SplxlOBeZQQYbYS6WxSbIA (single use, ~60 s lifetime)", "state=af0ifjsldkj"],
          why: "The code travels through the browser where it can leak (logs, Referer, malicious apps registered for the same URI), so it is short-lived, single-use and useless without the verifier." },
        { from: "client", to: "client", label: "Client checks state equals the stored value", params: ["stored state == af0ifjsldkj ? continue : abort"],
          why: "A mismatch means the callback was not started by this client session: CSRF on the redirect endpoint or a mix-up attack. Abort before touching the code." },
        { from: "client", to: "as", label: "POST /token (back channel, TLS)", params: ["grant_type=authorization_code", "code=SplxlOBeZQQYbYS6WxSbIA", "redirect_uri=http://127.0.0.1:53211/callback", "client_id=agent-app", "code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", "resource=https://mcp.example.com/mcp"],
          why: "The AS computes BASE64URL(SHA256(code_verifier)) and compares it to the challenge from step 2. A stolen code without the verifier is worthless, which kills authorization-code interception and injection." },
        { from: "as", to: "client", label: "200 OK token response", params: ["{ \"access_token\": \"eyJ…\", \"token_type\": \"Bearer\", \"expires_in\": 3600,", "  \"refresh_token\": \"8xLOxBtZp8\", \"id_token\": \"eyJ…\", \"scope\": \"openid documents.read\" }", "access token: aud = https://mcp.example.com/mcp, sub = alice", "id token: aud = agent-app, nonce = n-0S6_WzA2Mj"],
          why: "Three tokens, three readers: the access token is for the MCP server, the ID token is for the client (which checks nonce, iss, aud = its client_id), and the refresh token goes only back to the token endpoint. The client must not read the access token's claims." },
        { from: "client", to: "rs", label: "POST /mcp  Authorization: Bearer eyJ…", params: ["Authorization: Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6IjIwMjYtMDkta…", "never in the query string (RFC 6750 §2.3)"],
          why: "A bearer token in the header is not logged by proxies and does not leak through Referer; anyone holding it can use it, which is why its audience and lifetime are narrow." },
        { from: "rs", to: "client", label: "200 OK after full validation", params: ["signature via JWKS (kid), iss == https://login.example.com", "aud == https://mcp.example.com/mcp", "exp/nbf with 60 s leeway, scope includes documents.read"],
          why: "The audience check is what stops this token from being replayed at another API; the scope check is what limits what this client may do as alice." }
      ]
    },
    "client-credentials": {
      title: "Client credentials (RFC 6749 §4.4) with private_key_jwt (RFC 7523)",
      participants: [
        { id: "client", name: "Batch job (confidential client)", kind: "accent" },
        { id: "as", name: "Authorization server", kind: "purple" },
        { id: "rs", name: "Jobs API (resource)", kind: "ok" }
      ],
      steps: [
        { from: "client", to: "client", label: "Client signs a client_assertion JWT with its private key", params: ["{ \"iss\": \"batch-job\", \"sub\": \"batch-job\", \"aud\": \"https://login.example.com/oauth2/token\",", "  \"exp\": now+300, \"jti\": \"c1f4…\" }", "alg RS256, kid = registered key id"],
          why: "No user exists in this flow, so the client must authenticate as itself. A signed assertion means no reusable secret ever crosses the wire, and rotation is a JWKS update." },
        { from: "client", to: "as", label: "POST /token", params: ["grant_type=client_credentials", "scope=jobs.run", "client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer", "client_assertion=eyJ…", "(alternative: Authorization: Basic base64(client_id:client_secret), client_secret_basic)"],
          why: "Client credentials is a straight request to the token endpoint: no browser, no redirect, no consent. The scope asks for what this job needs, not everything the client is registered for." },
        { from: "as", to: "as", label: "AS verifies the assertion", params: ["signature with the client's registered public key", "aud == token endpoint, exp not passed, jti not seen before"],
          why: "aud pinned to the token endpoint stops the assertion being replayed at another AS; a unique jti stops replay at this one." },
        { from: "as", to: "client", label: "200 OK token response (no refresh token)", params: ["{ \"access_token\": \"eyJ…\", \"token_type\": \"Bearer\", \"expires_in\": 3600, \"scope\": \"jobs.run\" }", "access token: sub = batch-job, aud = https://jobs.example.com, scope = jobs.run"],
          why: "RFC 6749 §4.4.3: a refresh token SHOULD NOT be issued; the client can simply authenticate again. The token's subject is the service, not a person." },
        { from: "client", to: "rs", label: "POST /jobs  Authorization: Bearer eyJ…", params: ["Authorization: Bearer eyJ…", "{ \"job\": \"batch-reindex\" }"],
          why: "The resource server sees a machine identity. Everything it logs is attributed to batch-job, which is exactly right for a scheduled task and exactly wrong for user-triggered work." },
        { from: "rs", to: "as", label: "GET /.well-known/jwks.json (cached, dashed = periodic)", params: ["kid from the token header selects the key", "refetch once on unknown kid, then fail"], dashed: true,
          why: "Keys rotate; the verifier caches the JWKS from the issuer it already trusts and never fetches from a URL inside the token." },
        { from: "rs", to: "client", label: "200 OK after validating iss, aud, exp, scope", params: ["iss == https://login.example.com, aud == https://jobs.example.com", "scope contains jobs.run"],
          why: "The scope check maps a service identity to the few operations it may perform; a leaked service token is then limited to jobs.run, not the whole API." }
      ]
    },
    "device-code": {
      title: "Device authorization grant (RFC 8628)",
      participants: [
        { id: "client", name: "CLI / headless agent", kind: "accent" },
        { id: "as", name: "Authorization server", kind: "purple" },
        { id: "user", name: "User's phone browser", kind: "accent" }
      ],
      steps: [
        { from: "client", to: "as", label: "POST /device_authorization", params: ["client_id=cli-tool", "scope=openid documents.read offline_access"],
          why: "The device has no browser and cannot receive a redirect, so it asks the AS to open a session it can poll for. Public client: no secret." },
        { from: "as", to: "client", label: "200 OK device authorization response", params: ["{ \"device_code\": \"GmRhmhcxhwAzkoEqiMEg_DnyEysNkuNhszIySk9eS\",", "  \"user_code\": \"WDJB-MJHT\",", "  \"verification_uri\": \"https://login.example.com/device\",", "  \"verification_uri_complete\": \"https://login.example.com/device?user_code=WDJB-MJHT\",", "  \"expires_in\": 1800, \"interval\": 5 }"],
          why: "Two codes: user_code is short so a human can type it; device_code is long and secret, the device's half of the pairing. Both expire in 30 minutes." },
        { from: "client", to: "user", label: "Device displays instructions", params: ["\"Open https://login.example.com/device and enter WDJB-MJHT\""],
          why: "The user completes login on a device that has a real browser, MFA and passkeys. The CLI never sees credentials." },
        { from: "client", to: "as", label: "POST /token (poll every 5 s)", params: ["grant_type=urn:ietf:params:oauth:grant-type:device_code", "device_code=GmRhmhcxhwAzkoEqiMEg_DnyEysNkuNhszIySk9eS", "client_id=cli-tool"],
          why: "Polling replaces the redirect. The device must wait at least interval seconds between polls." },
        { from: "as", to: "client", label: "400 authorization_pending", params: ["{ \"error\": \"authorization_pending\" }", "other outcomes: slow_down (add 5 s to interval), access_denied, expired_token"],
          why: "The user has not finished yet. slow_down is the AS telling the device to back off; ignoring it gets the client throttled or blocked." },
        { from: "user", to: "as", label: "User opens verification_uri, enters WDJB-MJHT, logs in with MFA, consents", params: ["AS shows: client name \"cli-tool\", requested scopes, and the code being approved"],
          why: "This is the flow's weak point: phishing kits show an \"enter this code\" page so the victim authorizes the attacker's device. The AS must display clearly what is being approved." },
        { from: "client", to: "as", label: "POST /token (next poll)", params: ["grant_type=urn:ietf:params:oauth:grant-type:device_code", "device_code=GmRh…", "client_id=cli-tool"],
          why: "Same request as before; only the AS-side state changed." },
        { from: "as", to: "client", label: "200 OK token response", params: ["{ \"access_token\": \"eyJ…\", \"token_type\": \"Bearer\", \"expires_in\": 3600,", "  \"refresh_token\": \"8xLOxBtZp8\", \"id_token\": \"eyJ…\", \"scope\": \"openid documents.read offline_access\" }"],
          why: "The refresh token (from offline_access) lets the CLI keep working without repeating the dance; store it in the OS keychain, never in a dotfile." },
        { from: "client", to: "client", label: "Device stores tokens, deletes device_code", params: ["refresh with grant_type=refresh_token when the access token expires", "rotation (where the provider supports it): each refresh returns a new refresh token; some providers also revoke the family when an old one is reused (Entra ID does not)"],
          why: "The device_code is single-purpose and now dead. Refresh token rotation means a stolen copy is detected the moment both parties try to use it." }
      ]
    },
    "token-exchange-obo": {
      title: "Token exchange / on-behalf-of (RFC 8693) with audience binding (RFC 8707)",
      participants: [
        { id: "agent", name: "Agent app", kind: "accent" },
        { id: "as", name: "Authorization server", kind: "purple" },
        { id: "mcp", name: "MCP server", kind: "ok" },
        { id: "crm", name: "CRM API", kind: "ok" }
      ],
      steps: [
        { from: "agent", to: "as", label: "Code + PKCE flow with resource=https://mcp.example.com/mcp → AT1", params: ["…&code_challenge=…&resource=https://mcp.example.com/mcp", "AT1 = { \"sub\": \"alice\", \"aud\": \"https://mcp.example.com/mcp\", \"scope\": \"crm.summary\", \"exp\": … }"],
          why: "Alice's token is minted for exactly one audience, the MCP server. It is not valid at the CRM API, and that is the point." },
        { from: "agent", to: "mcp", label: "POST /mcp tools/call  Authorization: Bearer AT1", params: ["{ \"jsonrpc\": \"2.0\", \"method\": \"tools/call\", \"params\": { \"name\": \"summarise_accounts\" } }"],
          why: "The MCP server is a resource server for AT1 and, in the next steps, a client of the CRM API. Two roles, two tokens." },
        { from: "mcp", to: "mcp", label: "MCP server validates AT1", params: ["signature, iss, aud == https://mcp.example.com/mcp, exp, scope crm.summary", "decides: tool summarise_accounts needs CRM data as alice"],
          why: "Forwarding AT1 to the CRM would fail the CRM's aud check, and a lax CRM that accepted it would make the MCP server a confused deputy holding a token it should not be able to use elsewhere. No token passthrough." },
        { from: "mcp", to: "as", label: "POST /token  (token exchange, MCP authenticates as itself)", params: ["Authorization: Basic base64(mcp-server:…)   or private_key_jwt", "grant_type=urn:ietf:params:oauth:grant-type:token-exchange", "subject_token=eyJ…AT1…", "subject_token_type=urn:ietf:params:oauth:token-type:access_token", "audience=https://crm.example.com   (or resource=https://crm.example.com/api)", "scope=accounts.read", "requested_token_type=urn:ietf:params:oauth:token-type:access_token"],
          why: "The AS checks that mcp-server is registered, is allowed to exchange tokens for this audience, and that AT1 is valid. Policy about who may act for whom lives here, not in the MCP server." },
        { from: "as", to: "mcp", label: "200 OK token exchange response → AT2", params: ["{ \"access_token\": \"eyJ…AT2…\", \"issued_token_type\": \"urn:ietf:params:oauth:token-type:access_token\",", "  \"token_type\": \"Bearer\", \"expires_in\": 300 }", "AT2 = { \"sub\": \"alice\", \"aud\": \"https://crm.example.com\", \"scope\": \"accounts.read\",", "        \"act\": { \"sub\": \"mcp-server\" } }"],
          why: "sub is still alice, so the CRM authorizes and audits as her; act names the service acting on her behalf (RFC 8693 §4.1). Short expiry: this token exists for one downstream call." },
        { from: "mcp", to: "crm", label: "GET /accounts  Authorization: Bearer AT2", params: ["Authorization: Bearer eyJ…AT2…"],
          why: "The CRM receives a token whose audience is itself and whose scope is narrower than AT1's. Least privilege per hop." },
        { from: "crm", to: "mcp", label: "200 OK after validating aud == https://crm.example.com", params: ["authorizes as alice (row-level filters on her accounts)", "audit log: actor=alice, via=mcp-server (from act.sub)"],
          why: "Per-user authorization and audit survive the hop. With plain client credentials the CRM would see only mcp-server and apply the service's broad permissions." },
        { from: "mcp", to: "agent", label: "tools/call result", params: ["{ \"jsonrpc\": \"2.0\", \"result\": { \"content\": [ { \"type\": \"text\", \"text\": \"3 accounts, 2 renewals due…\" } ] } }"],
          why: "The agent never saw AT2 and the CRM never saw AT1. Each party held exactly the token meant for it." }
      ]
    },
    "mcp-discovery": {
      title: "MCP authorization discovery (MCP spec 2026-07-28, RFC 9728, 8414, 7636, 8707, 9207)",
      participants: [
        { id: "client", name: "MCP client (host)", kind: "accent" },
        { id: "mcp", name: "MCP server", kind: "ok" },
        { id: "as", name: "Authorization server", kind: "purple" },
        { id: "user", name: "User's browser", kind: "accent" }
      ],
      steps: [
        { from: "client", to: "mcp", label: "POST /mcp (tools/list) with no token", params: ["MCP-Protocol-Version: 2026-07-28", "Mcp-Method: tools/list", "{ \"jsonrpc\": \"2.0\", \"id\": 1, \"method\": \"tools/list\", \"params\": { \"_meta\": { \"io.modelcontextprotocol/protocolVersion\": \"2026-07-28\", \"io.modelcontextprotocol/clientInfo\": { \"name\": \"Claude Desktop\", \"version\": \"4.2.0\" }, \"io.modelcontextprotocol/clientCapabilities\": {} } } }"],
          why: "A first-time client knows nothing about this server. Since 2026-07-28 there is no initialize handshake: every request carries its protocol version, and the first one, sent without a token, makes the server say how to authenticate." },
        { from: "mcp", to: "client", label: "401 Unauthorized + WWW-Authenticate", params: ["HTTP/1.1 401 Unauthorized", "WWW-Authenticate: Bearer resource_metadata=\"https://mcp.example.com/.well-known/oauth-protected-resource/mcp\",", "                         scope=\"files:read\"", "Content-Length: 0"],
          why: "RFC 9728 §5: resource_metadata points at the server's metadata, and scope names what this request needs. A server may leave the pointer out if it serves the document at the well-known address, which clients then try. No body, no redirect." },
        { from: "client", to: "mcp", label: "GET /.well-known/oauth-protected-resource/mcp", params: ["{ \"resource\": \"https://mcp.example.com/mcp\",", "  \"authorization_servers\": [\"https://login.example.com\"],", "  \"scopes_supported\": [\"files:read\"],", "  \"bearer_methods_supported\": [\"header\"] }"],
          why: "Protected Resource Metadata (RFC 9728) tells the client which AS issues tokens for this server. The resource value here becomes the resource= parameter and the aud the server will demand." },
        { from: "client", to: "as", label: "GET /.well-known/oauth-authorization-server (RFC 8414)", params: ["fallback: /.well-known/openid-configuration", "{ \"authorization_endpoint\": \"https://login.example.com/oauth2/authorize\",", "  \"token_endpoint\": \"https://login.example.com/oauth2/token\",", "  \"client_id_metadata_document_supported\": true,", "  \"code_challenge_methods_supported\": [\"S256\"] }"],
          why: "Never hard-code endpoints. The client records the issuer from this document for the check in step 7, and confirms PKCE S256 support, which the MCP spec makes mandatory; if it is missing the client must refuse to proceed." },
        { from: "as", to: "client", label: "AS fetches the client's metadata document (client_id is an HTTPS URL)", params: ["client_id=https://app.example.com/oauth/client-metadata.json", "GET https://app.example.com/oauth/client-metadata.json", "{ \"client_id\": \"https://app.example.com/oauth/client-metadata.json\", \"client_name\": \"Claude Desktop\",", "  \"redirect_uris\": [\"http://127.0.0.1:53211/callback\"], \"token_endpoint_auth_method\": \"none\" }"],
          why: "A host cannot be pre-registered at every enterprise AS it will ever meet. Since the 2025-11-25 MCP spec the client SHOULD use a Client ID Metadata Document: its client_id is an HTTPS URL that serves its own details, which the AS fetches and checks. Pre-registration by an administrator also works; Dynamic Client Registration (RFC 7591) is deprecated in 2026-07-28 and kept only for older services." },
        { from: "client", to: "user", label: "Open browser → GET /authorize (PKCE + resource indicator)", params: ["response_type=code", "client_id=https://app.example.com/oauth/client-metadata.json", "redirect_uri=http://127.0.0.1:53211/callback", "scope=files:read", "state=af0ifjsldkj", "code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", "code_challenge_method=S256", "resource=https://mcp.example.com/mcp"],
          why: "PKCE because the host is a public client; resource because a token that is valid everywhere is a skeleton key, and this binds aud to one MCP server (RFC 8707)." },
        { from: "user", to: "as", label: "User authenticates and consents; AS redirects with code", params: ["302 http://127.0.0.1:53211/callback?code=SplxlOBeZQQYbYS6WxSbIA&state=af0ifjsldkj", "    &iss=https%3A%2F%2Flogin.example.com"],
          why: "Consent shows the user which client and which scopes. The loopback redirect keeps the code on the user's machine. The client compares iss with the issuer it recorded in step 4 (RFC 9207) before sending the code anywhere: a mismatch means a mix-up." },
        { from: "client", to: "as", label: "POST /oauth2/token", params: ["grant_type=authorization_code", "code=SplxlOBeZQQYbYS6WxSbIA", "redirect_uri=http://127.0.0.1:53211/callback", "client_id=https://app.example.com/oauth/client-metadata.json", "code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", "resource=https://mcp.example.com/mcp"],
          why: "The verifier proves the same client finishes what it started. resource is repeated on the token request (RFC 8707 §2.2) so the AS mints aud = https://mcp.example.com/mcp." },
        { from: "as", to: "client", label: "200 OK token response", params: ["{ \"access_token\": \"eyJ…\", \"token_type\": \"Bearer\", \"expires_in\": 3600, \"scope\": \"files:read\" }", "access token: aud = https://mcp.example.com/mcp"],
          why: "The client treats the access token as opaque; it only needs to attach it. Validating it is the server's job." },
        { from: "client", to: "mcp", label: "POST /mcp (tools/list) Authorization: Bearer eyJ…", params: ["Authorization: Bearer eyJhbGciOiJSUzI1NiIs…"],
          why: "The retry of step 1, now authenticated. Every request carries this header, tools/list included; listing tools is not harmless." },
        { from: "mcp", to: "client", label: "200 OK after validation (or 401 invalid_token / 403 insufficient_scope)", params: ["signature via the AS JWKS, iss == https://login.example.com", "aud == https://mcp.example.com/mcp  (its own canonical resource)", "exp, scope files:read; then per-tool authorization", "on failure: WWW-Authenticate: Bearer resource_metadata=\"…\", error=\"invalid_token\""],
          why: "Audience validation is the server's half of the bargain: a token minted for another MCP server fails here. And the server must never pass this token to downstream APIs (use token exchange instead)." }
      ]
    }
  };
  LOGIC.OAUTH_FLOWS = OAUTH_FLOWS;

  function renderOauthStepper(host) {
    const flowName = OAUTH_FLOWS[host.dataset.flow] ? host.dataset.flow : "auth-code-pkce";
    const flow = OAUTH_FLOWS[flowName];
    let idx = -1; // -1 = nothing shown yet
    const W = 760, colW = W / flow.participants.length, top = 70, rowH = 46, H = top + rowH * (flow.steps.length + 1) + 20;
    const svgNS = "http://www.w3.org/2000/svg";
    function svgEl(tag, attrs, text) {
      const e = document.createElementNS(svgNS, tag);
      Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
      if (text != null) e.textContent = text;
      return e;
    }
    const svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Sequence diagram: " + flow.title, class: "w-svg" });
    const mid = uid("arrow");
    const defs = svgEl("defs");
    [["", "w-arrowhead"], ["-muted", "w-arrowhead-muted"], ["-hot", "w-arrowhead-hot"]].forEach(function (m) {
      const marker = svgEl("marker", { id: mid + m[0], viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "8", markerHeight: "8", orient: "auto-start-reverse" });
      marker.append(svgEl("path", { d: "M0,0 L10,5 L0,10 z", class: m[1] }));
      defs.append(marker);
    });
    svg.append(defs);
    const xOf = {};
    flow.participants.forEach(function (p, i) {
      const x = colW * i + colW / 2;
      xOf[p.id] = x;
      svg.append(svgEl("rect", { x: x - colW / 2 + 10, y: 12, width: colW - 20, height: 40, class: "box-" + p.kind, rx: 6 }));
      svg.append(svgEl("text", { x: x, y: 37, "text-anchor": "middle", class: "lbl-b w-svg-name" }, p.name));
      svg.append(svgEl("line", { x1: x, y1: 52, x2: x, y2: H - 10, class: "lifeline" }));
    });
    const stepLayer = svgEl("g");
    svg.append(stepLayer);

    function drawSteps() {
      while (stepLayer.firstChild) stepLayer.removeChild(stepLayer.firstChild);
      flow.steps.forEach(function (s, i) {
        if (i > idx) return;
        const y = top + rowH * i + 20, hot = i === idx;
        const x1 = xOf[s.from], x2 = xOf[s.to];
        const g = svgEl("g", { class: "w-step" + (hot ? " w-step-hot" : " w-step-done") });
        if (x1 === x2) {
          // self message: small loop to the right
          const d = "M" + x1 + "," + (y - 10) + " h40 v20 h-40";
          g.append(svgEl("path", { d: d, class: "w-svg-arrow" + (hot ? " hot" : ""), "marker-end": "url(#" + mid + (hot ? "-hot" : "") + ")" }));
          g.append(svgEl("text", { x: x1 + 48, y: y + 4, class: "lbl-s w-svg-label" }, trunc(s.label, 40)));
        } else {
          g.append(svgEl("line", { x1: x1 + (x1 < x2 ? 4 : -4), y1: y, x2: x2 + (x1 < x2 ? -4 : 4), y2: y, class: "w-svg-arrow" + (s.dashed ? " dashed" : "") + (hot ? " hot" : ""), "marker-end": "url(#" + mid + (hot ? "-hot" : s.dashed ? "-muted" : "") + ")" }));
          g.append(svgEl("text", { x: (x1 + x2) / 2, y: y - 6, "text-anchor": "middle", class: "lbl-s w-svg-label" }, trunc(s.label, Math.floor(Math.abs(x2 - x1) / 5.6))));
        }
        g.append(svgEl("circle", { cx: Math.min(x1, x2) - 14 < 10 ? Math.max(x1, x2) + 14 : Math.min(x1, x2) - 14, cy: y, r: 9, class: "step" }));
        g.append(svgEl("text", { x: Math.min(x1, x2) - 14 < 10 ? Math.max(x1, x2) + 14 : Math.min(x1, x2) - 14, y: y + 4, "text-anchor": "middle", class: "step-text" }, String(i + 1)));
        stepLayer.append(g);
      });
    }
    function trunc(s, n) { return s.length > n ? s.slice(0, Math.max(3, n - 1)) + "…" : s; }

    const detail = h("div", { class: "w-step-detail", "aria-live": "polite" });
    const counter = h("span", { class: "w-muted" });
    const prevBtn = button("← Back", function () { go(idx - 1); }, true);
    const nextBtn = button("Next →", function () { go(idx + 1); });
    function go(n) {
      idx = Math.max(-1, Math.min(flow.steps.length - 1, n));
      drawSteps();
      clear(detail);
      if (idx < 0) {
        detail.append(h("p", { class: "w-muted" }, "Press Next (or the right arrow key) to reveal each message. Every step shows the real parameters and the attack it prevents."));
      } else {
        const s = flow.steps[idx];
        const names = {}; flow.participants.forEach(function (p) { names[p.id] = p.name; });
        detail.append(
          h("div", { class: "w-step-title" }, h("span", { class: "step-num" }, String(idx + 1)), " ", h("strong", {}, s.label),
            h("span", { class: "w-muted" }, "  " + names[s.from] + (s.from === s.to ? " (internal)" : " → " + names[s.to]))),
          pre(s.params.join("\n")),
          h("p", { class: "w-why" }, h("strong", {}, "Why: "), s.why));
      }
      counter.textContent = (idx + 1) + " / " + flow.steps.length;
      prevBtn.disabled = idx < 0; nextBtn.disabled = idx >= flow.steps.length - 1;
    }
    const wrap = h("div", { class: "w-stepper", tabindex: "0", "aria-label": "Sequence diagram stepper; use left and right arrow keys",
      onkeydown: function (e) { if (e.key === "ArrowRight") { e.preventDefault(); go(idx + 1); } else if (e.key === "ArrowLeft") { e.preventDefault(); go(idx - 1); } else if (e.key === "Home") { e.preventDefault(); go(-1); } } });
    wrap.append(h("div", { class: "diagram w-diagram" }, svg));
    host.append(head(flow.title, "Step-through sequence diagram"), wrap,
      h("div", { class: "w-btns" }, prevBtn, nextBtn, button("Reset", function () { go(-1); }, true), button("Show all", function () { go(flow.steps.length - 1); }, true), counter),
      detail);
    go(-1);
  }

  /* =========================================================
     5. Toy AWS IAM evaluator
     ========================================================= */
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function wildcardMatch(pattern, value, caseInsensitive) {
    if (pattern == null) return false;
    const re = new RegExp("^" + String(pattern).split("").map(function (ch) { return ch === "*" ? ".*" : ch === "?" ? "." : escapeRe(ch); }).join("") + "$", caseInsensitive ? "i" : "");
    return re.test(String(value));
  }
  LOGIC.wildcardMatch = wildcardMatch;
  function arr(x) { return x == null ? [] : Array.isArray(x) ? x : [x]; }
  function accountOf(arn) { const m = /^arn:aws[a-z-]*:iam::(\d{12}):/.exec(String(arn || "")); return m ? m[1] : null; }

  // Returns { statements: [...], error } ; empty text => { statements: null } (policy absent)
  function parsePolicy(text, source) {
    const j = safeJson(text, source);
    if (j.empty) return { statements: null };
    if (j.error) return { error: j.error };
    const doc = j.value;
    const stmts = arr(doc && doc.Statement);
    if (!doc || typeof doc !== "object" || !stmts.length) return { error: source + ": expected an object with a Statement array." };
    return { statements: stmts.map(function (s, i) {
      return { sid: s.Sid || (source + " statement " + (i + 1)), source: source, effect: String(s.Effect || ""),
        actions: arr(s.Action), notActions: arr(s.NotAction), resources: arr(s.Resource), notResources: arr(s.NotResource),
        principal: s.Principal, notPrincipal: s.NotPrincipal, condition: s.Condition || null };
    }) };
  }
  LOGIC.parsePolicy = parsePolicy;

  const IAM_SUPPORTED_KEYS = ["aws:PrincipalOrgID", "sts:ExternalId"];
  // req: { principal, action, resource, orgId, externalId }
  function statementMatches(st, req, checkPrincipal) {
    const notes = [];
    if (st.effect !== "Allow" && st.effect !== "Deny") return { match: false, note: "Effect must be Allow or Deny." };
    // Action / NotAction
    let actionOk;
    if (st.notActions.length) actionOk = !st.notActions.some(function (a) { return wildcardMatch(a, req.action, true); });
    else actionOk = st.actions.some(function (a) { return wildcardMatch(a, req.action, true); });
    if (!actionOk) return { match: false, note: "action " + req.action + " not covered" };
    // Resource / NotResource
    let resOk;
    if (st.notResources.length) resOk = !st.notResources.some(function (r) { return wildcardMatch(r, req.resource, false); });
    else if (st.resources.length) resOk = st.resources.some(function (r) { return wildcardMatch(r, req.resource, false); });
    else resOk = st.source === "Resource policy"; // a resource policy may omit Resource (implies the resource it is attached to)
    if (!resOk) return { match: false, note: "resource " + req.resource + " not covered (remember: GetObject needs the object ARN with /*, ListBucket the bucket ARN)" };
    // Principal (resource policies only)
    if (checkPrincipal) {
      if (st.notPrincipal) return { match: false, note: "NotPrincipal is not supported by this toy evaluator; statement skipped." };
      if (st.principal == null) return { match: false, note: "resource policy statement has no Principal" };
      if (!principalMatches(st.principal, req.principal)) return { match: false, note: "Principal does not name " + req.principal };
    }
    // Condition
    if (st.condition) {
      const ops = Object.keys(st.condition);
      for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        if (op !== "StringEquals") return { match: false, note: "condition operator " + op + " is not supported by this toy evaluator (only StringEquals); statement skipped." };
        const keys = Object.keys(st.condition[op]);
        for (let k = 0; k < keys.length; k++) {
          const key = keys[k];
          if (IAM_SUPPORTED_KEYS.indexOf(key) < 0) return { match: false, note: "condition key " + key + " is not supported by this toy evaluator (only " + IAM_SUPPORTED_KEYS.join(", ") + "); statement skipped." };
          const want = arr(st.condition[op][key]).map(String);
          const have = key === "aws:PrincipalOrgID" ? req.orgId : req.externalId;
          if (!have) return { match: false, note: "condition " + key + " requires a request value but none was supplied" };
          if (want.indexOf(String(have)) < 0) return { match: false, note: "condition " + key + " = " + have + " does not equal " + want.join("|") };
          notes.push(key + " matched");
        }
      }
    }
    return { match: true, note: notes.join("; ") };
  }
  function principalMatches(principal, arn) {
    if (principal === "*") return true;
    if (typeof principal !== "object") return false;
    const list = arr(principal.AWS);
    const acct = accountOf(arn);
    return list.some(function (p) {
      p = String(p);
      if (p === "*") return true;
      if (p === arn) return true;
      if (/^\d{12}$/.test(p) && acct && p === acct) return true;
      const m = /^arn:aws[a-z-]*:iam::(\d{12}):root$/.exec(p);
      if (m && acct && m[1] === acct) return true;
      return false;
    });
  }

  // input: { identity, resource, scp, boundary (JSON text), principal, action, resourceArn, sameAccount, orgId, externalId }
  function iamEval(input) {
    const trace = [];
    const docs = [
      ["Identity policy", input.identity], ["Resource policy", input.resource], ["SCP", input.scp], ["Permission boundary", input.boundary]
    ].map(function (d) { const p = parsePolicy(d[1], d[0]); p.name = d[0]; return p; });
    const bad = docs.filter(function (d) { return d.error; });
    if (bad.length) return { decision: "ERROR", reason: bad.map(function (d) { return d.error; }).join(" "), trace: trace };
    const req = { principal: String(input.principal || "").trim(), action: String(input.action || "").trim(), resource: String(input.resourceArn || "").trim(), orgId: String(input.orgId || "").trim(), externalId: String(input.externalId || "").trim() };
    if (!req.principal || !req.action || !req.resource) return { decision: "ERROR", reason: "Principal ARN, action and resource ARN are all required.", trace: trace };
    const byName = {}; docs.forEach(function (d) { byName[d.name] = d.statements; });

    function evaluate(name, effect) {
      const sts = byName[name]; if (!sts) return null;
      const isResource = name === "Resource policy";
      for (let i = 0; i < sts.length; i++) {
        const st = sts[i];
        if (st.effect !== effect) continue;
        const m = statementMatches(st, req, isResource);
        if (m.match) return st;
        if (m.note && /not supported/.test(m.note)) trace.push({ step: name, text: "Skipped " + st.sid + ": " + m.note, level: "warn" });
      }
      return null;
    }
    // Step 1: explicit deny anywhere
    const denyOrder = ["SCP", "Resource policy", "Permission boundary", "Identity policy"];
    for (let i = 0; i < denyOrder.length; i++) {
      const st = evaluate(denyOrder[i], "Deny");
      if (st) {
        trace.push({ step: "1. Explicit deny", text: "Deny statement \"" + st.sid + "\" in the " + denyOrder[i] + " matches " + req.action + " on " + req.resource + ".", level: "fail" });
        return { decision: "DENY", kind: "explicit", reason: "Explicit deny in " + denyOrder[i] + " (" + st.sid + "). Nothing can override it.", trace: trace, deciding: st };
      }
    }
    trace.push({ step: "1. Explicit deny", text: "No Deny statement matches in any policy.", level: "pass" });
    // Step 2: SCP
    if (byName.SCP) {
      const st = evaluate("SCP", "Allow");
      if (!st) { trace.push({ step: "2. SCP", text: "No SCP Allow statement covers " + req.action + " on " + req.resource + ": implicit deny at the organization level.", level: "fail" }); return { decision: "DENY", kind: "implicit-scp", reason: "SCP does not allow this action; identity and resource policies are never consulted.", trace: trace }; }
      trace.push({ step: "2. SCP", text: "SCP Allow \"" + st.sid + "\" covers the action (SCPs filter, they never grant).", level: "pass" });
    } else trace.push({ step: "2. SCP", text: "No SCP supplied (treated as FullAWSAccess).", level: "pass" });
    // Step 3: resource policy
    let resAllow = null;
    if (byName["Resource policy"]) {
      resAllow = evaluate("Resource policy", "Allow");
      if (resAllow) {
        trace.push({ step: "3. Resource policy", text: "Allow \"" + resAllow.sid + "\" names the principal and covers the action" + (resAllow.condition ? " (condition satisfied)" : "") + ".", level: "pass" });
        if (input.sameAccount) return { decision: "ALLOW", kind: "resource-policy", reason: "Same account: a resource policy that names the principal directly allows on its own (permission boundary and identity policy not needed).", trace: trace, deciding: resAllow };
        trace.push({ step: "3. Resource policy", text: "Cross-account: the resource side allows, now the caller's account must allow too.", level: "warn" });
      } else trace.push({ step: "3. Resource policy", text: "No resource policy Allow statement names " + req.principal + " for this action.", level: input.sameAccount ? "warn" : "fail" });
    } else trace.push({ step: "3. Resource policy", text: "No resource policy.", level: input.sameAccount ? "warn" : "fail" });
    // Step 4: boundary
    if (byName["Permission boundary"]) {
      const st = evaluate("Permission boundary", "Allow");
      if (!st) { trace.push({ step: "4. Permission boundary", text: "The boundary has no Allow covering " + req.action + " on " + req.resource + "; effective permissions are the intersection, so this is denied.", level: "fail" }); return { decision: "DENY", kind: "implicit-boundary", reason: "Permission boundary does not allow this action (boundaries filter, they never grant).", trace: trace }; }
      trace.push({ step: "4. Permission boundary", text: "Boundary Allow \"" + st.sid + "\" covers the action.", level: "pass" });
    } else trace.push({ step: "4. Permission boundary", text: "No permission boundary set.", level: "pass" });
    // Step 5: identity policy
    const idAllow = evaluate("Identity policy", "Allow");
    if (!idAllow) {
      trace.push({ step: "5. Identity policy", text: "No identity policy Allow covers " + req.action + " on " + req.resource + ".", level: "fail" });
      return { decision: "DENY", kind: "implicit", reason: "Implicit deny: no policy allows this request (the default outcome, not an error).", trace: trace };
    }
    trace.push({ step: "5. Identity policy", text: "Allow \"" + idAllow.sid + "\" covers the action and resource.", level: "pass" });
    if (!input.sameAccount && !resAllow) {
      trace.push({ step: "6. Cross-account", text: "Cross-account access needs BOTH sides: the caller's identity policy (yes) AND the resource policy naming the principal, its account or its aws:PrincipalOrgID (no).", level: "fail" });
      return { decision: "DENY", kind: "cross-account", reason: "Cross-account: the identity policy allows, but the resource policy does not grant this principal. One side alone is a deny.", trace: trace, deciding: idAllow };
    }
    if (!input.sameAccount) trace.push({ step: "6. Cross-account", text: "Both sides allow: identity policy \"" + idAllow.sid + "\" and resource policy \"" + resAllow.sid + "\".", level: "pass" });
    return { decision: "ALLOW", kind: "identity-policy", reason: input.sameAccount ? "Identity policy allows and nothing denies." : "Cross-account: identity policy and resource policy both allow.", trace: trace, deciding: idAllow };
  }
  LOGIC.iamEval = iamEval;

  const IAM_PRESETS = {
    "s3-read-ok": {
      label: "S3 read allowed by identity policy",
      identity: JSON.stringify({ Version: "2012-10-17", Statement: [
        { Sid: "ListBucket", Effect: "Allow", Action: "s3:ListBucket", Resource: "arn:aws:s3:::example-docs" },
        { Sid: "ReadDocs", Effect: "Allow", Action: ["s3:GetObject"], Resource: "arn:aws:s3:::example-docs/docs/*" } ] }, null, 2),
      resource: "", scp: JSON.stringify({ Version: "2012-10-17", Statement: [{ Sid: "FullAWSAccess", Effect: "Allow", Action: "*", Resource: "*" }] }, null, 2), boundary: "",
      principal: "arn:aws:iam::111111111111:role/docs-reader", action: "s3:GetObject", resourceArn: "arn:aws:s3:::example-docs/docs/plan.pdf", sameAccount: true, orgId: "o-abc123def4", externalId: "" },
    "explicit-deny": {
      label: "Explicit deny beats a broad allow",
      identity: JSON.stringify({ Version: "2012-10-17", Statement: [
        { Sid: "BroadRead", Effect: "Allow", Action: "s3:*", Resource: "*" },
        { Sid: "NoFinance", Effect: "Deny", Action: "s3:GetObject", Resource: "arn:aws:s3:::example-docs/finance/*" } ] }, null, 2),
      resource: "", scp: "", boundary: "",
      principal: "arn:aws:iam::111111111111:role/docs-reader", action: "s3:GetObject", resourceArn: "arn:aws:s3:::example-docs/finance/q3.xlsx", sameAccount: true, orgId: "o-abc123def4", externalId: "" },
    "scp-blocks": {
      label: "SCP denies what the identity policy allows",
      identity: JSON.stringify({ Version: "2012-10-17", Statement: [{ Sid: "ReadDocs", Effect: "Allow", Action: "s3:GetObject", Resource: "arn:aws:s3:::example-docs/*" }] }, null, 2),
      resource: "",
      scp: JSON.stringify({ Version: "2012-10-17", Statement: [
        { Sid: "FullAWSAccess", Effect: "Allow", Action: "*", Resource: "*" },
        { Sid: "DenyS3InSandboxOU", Effect: "Deny", Action: "s3:*", Resource: "*" } ] }, null, 2),
      boundary: "",
      principal: "arn:aws:iam::111111111111:role/docs-reader", action: "s3:GetObject", resourceArn: "arn:aws:s3:::example-docs/docs/plan.pdf", sameAccount: true, orgId: "o-abc123def4", externalId: "" },
    "cross-account-missing-resource-policy": {
      label: "Cross-account without a bucket policy",
      identity: JSON.stringify({ Version: "2012-10-17", Statement: [{ Sid: "ReadPartner", Effect: "Allow", Action: "s3:GetObject", Resource: "arn:aws:s3:::partner-exports/*" }] }, null, 2),
      resource: "", scp: "", boundary: "",
      principal: "arn:aws:iam::111111111111:role/docs-reader", action: "s3:GetObject", resourceArn: "arn:aws:s3:::partner-exports/2026/09/report.csv", sameAccount: false, orgId: "o-abc123def4", externalId: "" },
    "cross-account-ok": {
      label: "Cross-account with bucket policy + PrincipalOrgID",
      identity: JSON.stringify({ Version: "2012-10-17", Statement: [{ Sid: "ReadPartner", Effect: "Allow", Action: "s3:GetObject", Resource: "arn:aws:s3:::partner-exports/*" }] }, null, 2),
      resource: JSON.stringify({ Version: "2012-10-17", Statement: [{ Sid: "OrgRead", Effect: "Allow", Principal: { AWS: "arn:aws:iam::111111111111:role/docs-reader" }, Action: "s3:GetObject", Resource: "arn:aws:s3:::partner-exports/*",
        Condition: { StringEquals: { "aws:PrincipalOrgID": "o-abc123def4" } } }] }, null, 2),
      scp: "", boundary: JSON.stringify({ Version: "2012-10-17", Statement: [{ Sid: "Boundary", Effect: "Allow", Action: ["s3:GetObject", "s3:ListBucket", "logs:*"], Resource: "*" }] }, null, 2),
      principal: "arn:aws:iam::111111111111:role/docs-reader", action: "s3:GetObject", resourceArn: "arn:aws:s3:::partner-exports/2026/09/report.csv", sameAccount: false, orgId: "o-abc123def4", externalId: "" },
    "assume-role-externalid": {
      label: "sts:AssumeRole trust policy with sts:ExternalId",
      identity: JSON.stringify({ Version: "2012-10-17", Statement: [{ Sid: "VendorWorker", Effect: "Allow", Action: "sts:AssumeRole", Resource: "arn:aws:iam::222222222222:role/customer-access" }] }, null, 2),
      resource: JSON.stringify({ Version: "2012-10-17", Statement: [{ Sid: "TrustVendor", Effect: "Allow", Principal: { AWS: "arn:aws:iam::111111111111:role/vendor-worker" }, Action: "sts:AssumeRole",
        Condition: { StringEquals: { "sts:ExternalId": "cust-7f3a9c-d41e" } } }] }, null, 2),
      scp: "", boundary: "",
      principal: "arn:aws:iam::111111111111:role/vendor-worker", action: "sts:AssumeRole", resourceArn: "arn:aws:iam::222222222222:role/customer-access", sameAccount: false, orgId: "", externalId: "wrong-id" }
  };
  LOGIC.IAM_PRESETS = IAM_PRESETS;

  function renderIamEval(host) {
    const ds = host.dataset;
    const presetSel = select(Object.keys(IAM_PRESETS).map(function (k) { return [k, IAM_PRESETS[k].label]; }), IAM_PRESETS[ds.preset] ? ds.preset : "s3-read-ok");
    const identity = textarea({ rows: 10 }), resource = textarea({ rows: 10 }), scp = textarea({ rows: 6 }), boundary = textarea({ rows: 6 });
    const principal = input({ size: 44 }), action = input({ size: 18 }), resourceArn = input({ size: 44 });
    const sameAccount = checkbox("Principal and resource are in the same account", true);
    const orgId = input({ size: 14, placeholder: "o-abc123def4" }), externalId = input({ size: 18, placeholder: "cust-7f3a9c-d41e" });
    const out = h("div", { class: "w-out", "aria-live": "polite" });
    function apply(p) {
      identity.value = p.identity; resource.value = p.resource; scp.value = p.scp; boundary.value = p.boundary;
      principal.value = p.principal; action.value = p.action; resourceArn.value = p.resourceArn; sameAccount.firstChild.checked = p.sameAccount;
      orgId.value = p.orgId; externalId.value = p.externalId;
      run();
    }
    function run() {
      const r = iamEval({ identity: identity.value, resource: resource.value, scp: scp.value, boundary: boundary.value, principal: principal.value, action: action.value, resourceArn: resourceArn.value, sameAccount: sameAccount.firstChild.checked, orgId: orgId.value, externalId: externalId.value });
      clear(out);
      if (r.decision === "ERROR") { out.append(errorBox(r.reason)); return; }
      out.append(verdict(r.decision === "ALLOW", r.decision + (r.kind ? " (" + r.kind.replace(/-/g, " ") + ")" : ""), r.reason));
      const ol = h("ol", { class: "w-trace" });
      r.trace.forEach(function (t) { ol.append(h("li", { class: "w-trace-" + t.level }, badge(t.level, t.level === "pass" ? "ok" : t.level === "fail" ? "stop" : "note"), " ", h("strong", {}, t.step + ": "), t.text)); });
      out.append(h("div", { class: "w-label" }, "Evaluation trace"), ol);
    }
    host.append(
      head("AWS IAM policy evaluator (toy)", "Explicit deny → SCP → resource policy → boundary → identity policy"),
      field("Preset", presetSel),
      h("div", { class: "w-grid2" },
        field("Identity-based policy (on the principal)", identity),
        field("Resource-based policy (on the target; needs Principal)", resource),
        field("Service control policy (empty = none)", scp),
        field("Permission boundary (empty = none)", boundary)),
      h("fieldset", { class: "w-fieldset" }, h("legend", {}, "Request"),
        h("div", { class: "w-row" }, field("Principal ARN", principal), field("Action", action), field("Resource ARN", resourceArn)),
        h("div", { class: "w-row" }, sameAccount, field("aws:PrincipalOrgID of the caller", orgId), field("sts:ExternalId passed", externalId))),
      h("div", { class: "w-btns" }, button("Evaluate", run)),
      out,
      h("p", { class: "w-muted" }, "Limits of this toy: Action/Resource/NotAction/NotResource with * and ? wildcards; Principal as ARN, account id, account root or *; Condition only StringEquals on aws:PrincipalOrgID and sts:ExternalId (other operators or keys make the statement skip with a note). No session policies, NotPrincipal, policy variables, or service-linked quirks. Real AWS: use the IAM policy simulator."));
    presetSel.addEventListener("change", function () { apply(IAM_PRESETS[presetSel.value]); });
    apply(IAM_PRESETS[presetSel.value]);
  }

  /* =========================================================
     6. Kubernetes NetworkPolicy checker
     ========================================================= */
  function ip4ToInt(ip) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip || "").trim());
    if (!m) return null;
    let n = 0;
    for (let i = 1; i <= 4; i++) { const o = parseInt(m[i], 10); if (o > 255) return null; n = n * 256 + o; }
    return n;
  }
  function cidrContains(cidr, ip) {
    const parts = String(cidr || "").trim().split("/");
    const base = ip4ToInt(parts[0]), bits = parts.length > 1 ? parseInt(parts[1], 10) : 32, target = ip4ToInt(ip);
    if (base == null || target == null || isNaN(bits) || bits < 0 || bits > 32) return false;
    if (bits === 0) return true;
    const mask = bits === 32 ? 0xFFFFFFFF : (~((1 << (32 - bits)) - 1)) >>> 0;
    return ((base & mask) >>> 0) === ((target & mask) >>> 0);
  }
  LOGIC.cidrContains = cidrContains;
  function selectorMatches(sel, labels) {
    if (sel == null) return false; // absent selector = no selection (caller decides semantics)
    labels = labels || {};
    const ml = sel.matchLabels || {};
    const keys = Object.keys(ml);
    for (let i = 0; i < keys.length; i++) if (labels[keys[i]] !== ml[keys[i]]) return false;
    const exprs = arr(sel.matchExpressions);
    for (let i = 0; i < exprs.length; i++) {
      const e = exprs[i], has = Object.prototype.hasOwnProperty.call(labels, e.key), vals = arr(e.values).map(String);
      if (e.operator === "In" && !(has && vals.indexOf(String(labels[e.key])) >= 0)) return false;
      if (e.operator === "NotIn" && has && vals.indexOf(String(labels[e.key])) >= 0) return false;
      if (e.operator === "Exists" && !has) return false;
      if (e.operator === "DoesNotExist" && has) return false;
    }
    return true;
  }
  LOGIC.selectorMatches = selectorMatches;
  function policyTypes(spec) {
    if (spec.policyTypes && spec.policyTypes.length) return spec.policyTypes.map(String);
    const t = ["Ingress"]; if (spec.egress !== undefined) t.push("Egress"); return t;
  }
  function portMatches(ports, port, protocol) {
    if (!ports || !ports.length) return true; // no ports = all ports
    return ports.some(function (p) {
      const proto = (p.protocol || "TCP").toUpperCase();
      if (proto !== protocol.toUpperCase()) return false;
      if (p.port == null) return true;
      if (typeof p.port === "string" && isNaN(parseInt(p.port, 10))) return false; // named ports unsupported
      const lo = parseInt(p.port, 10), hi = p.endPort != null ? parseInt(p.endPort, 10) : lo;
      return port >= lo && port <= hi;
    });
  }
  // peer: { podSelector, namespaceSelector, ipBlock }; target: { pod, ip } ; policyNs: namespace of the policy
  function peerMatches(peer, target, policyNs, cluster) {
    if (peer.ipBlock) {
      if (!target.ip) return false;
      if (!cidrContains(peer.ipBlock.cidr, target.ip)) return false;
      return !arr(peer.ipBlock.except).some(function (ex) { return cidrContains(ex, target.ip); });
    }
    if (!target.pod) return false;
    const pod = target.pod;
    if (peer.namespaceSelector != null) {
      const nsLabels = (cluster.namespaces[pod.namespace] || {}).labels || {};
      const nsLabelsWithName = Object.assign({ "kubernetes.io/metadata.name": pod.namespace }, nsLabels);
      if (!selectorMatches(peer.namespaceSelector, nsLabelsWithName)) return false;
      if (peer.podSelector != null && !selectorMatches(peer.podSelector, pod.labels)) return false;
      return true;
    }
    if (peer.podSelector != null) {
      // podSelector alone: pods in the policy's own namespace
      return pod.namespace === policyNs && selectorMatches(peer.podSelector, pod.labels);
    }
    return false;
  }
  function findPod(cluster, ref) {
    ref = String(ref || "").trim();
    const i = ref.indexOf("/");
    const ns = i >= 0 ? ref.slice(0, i) : "default", name = i >= 0 ? ref.slice(i + 1) : ref;
    return (cluster.pods || []).filter(function (p) { return (p.namespace || "default") === ns && p.name === name; })[0] || null;
  }
  // Evaluate one direction. dir = "Egress" (subject = source pod, peers = destinations) or "Ingress"
  function evalDirection(cluster, policies, subject, other, port, protocol, dir) {
    const selecting = policies.filter(function (pol) {
      const spec = pol.spec || pol;
      const ns = pol.namespace || (pol.metadata && pol.metadata.namespace) || "default";
      return ns === subject.namespace && policyTypes(spec).indexOf(dir) >= 0 && selectorMatches(spec.podSelector || {}, subject.labels);
    });
    const name = function (pol) { return pol.name || (pol.metadata && pol.metadata.name) || "(unnamed)"; };
    if (!selecting.length) return { isolated: false, allowed: true, by: null, selecting: [], text: "No policy with policyType " + dir + " selects " + subject.namespace + "/" + subject.name + ", so " + dir.toLowerCase() + " is allowed (not isolated)." };
    for (let i = 0; i < selecting.length; i++) {
      const pol = selecting[i], spec = pol.spec || pol, ns = pol.namespace || (pol.metadata && pol.metadata.namespace) || "default";
      const rules = arr(dir === "Egress" ? spec.egress : spec.ingress);
      for (let r = 0; r < rules.length; r++) {
        const rule = rules[r] || {};
        const peers = arr(dir === "Egress" ? rule.to : rule.from);
        const peerOk = peers.length === 0 || peers.some(function (p) { return peerMatches(p, other, ns, cluster); });
        if (peerOk && portMatches(rule.ports, port, protocol)) {
          return { isolated: true, allowed: true, by: name(pol), selecting: selecting.map(name), text: dir + " allowed by policy \"" + name(pol) + "\" rule " + (r + 1) + (peers.length ? "" : " (empty " + (dir === "Egress" ? "to" : "from") + " list = any peer)") + "." };
        }
      }
    }
    return { isolated: true, allowed: false, by: null, selecting: selecting.map(name), text: dir + " denied: " + selecting.length + " polic" + (selecting.length > 1 ? "ies" : "y") + " select" + (selecting.length > 1 ? "" : "s") + " the pod (" + selecting.map(name).join(", ") + ") and no rule matches " + (other.pod ? other.pod.namespace + "/" + other.pod.name : other.ip) + " on " + protocol + "/" + port + ". Policies are additive allow-lists; there is no deny rule to find." };
  }
  // q: { from: "ns/pod", to: "ns/pod" | "10.0.0.1" | "10.0.0.0/24", port, protocol }
  function netpolCheck(cluster, policies, q) {
    const src = findPod(cluster, q.from);
    if (!src) return { error: "Source pod \"" + q.from + "\" not found in the cluster model (use namespace/name)." };
    src.namespace = src.namespace || "default";
    const port = parseInt(q.port, 10), protocol = String(q.protocol || "TCP").toUpperCase();
    if (isNaN(port)) return { error: "Port must be a number." };
    let dst = { pod: null, ip: null };
    const toStr = String(q.to || "").trim();
    if (ip4ToInt(toStr.split("/")[0]) != null) dst.ip = toStr.split("/")[0];
    else { dst.pod = findPod(cluster, toStr); if (!dst.pod) return { error: "Destination \"" + toStr + "\" is neither a pod in the model nor an IPv4 address." }; dst.pod.namespace = dst.pod.namespace || "default"; dst.ip = dst.pod.ip || null; }
    const egress = evalDirection(cluster, policies, src, dst, port, protocol, "Egress");
    const ingress = dst.pod ? evalDirection(cluster, policies, dst.pod, { pod: src, ip: src.ip || null }, port, protocol, "Ingress")
                            : { isolated: false, allowed: true, text: "Destination is an IP outside the pod model; only the source's egress policies apply (the far end has no NetworkPolicy)." };
    // DNS gotcha: if the source is egress-isolated, is UDP/53 to CoreDNS allowed?
    const dnsPods = (cluster.pods || []).filter(function (p) { return (p.labels || {})["k8s-app"] === "kube-dns"; });
    let dns = { relevant: egress.isolated, allowed: true, text: "Source pod is not egress-isolated, so DNS is reachable." };
    if (egress.isolated) {
      if (!dnsPods.length) dns = { relevant: true, allowed: false, text: "No pod labelled k8s-app=kube-dns in the model, so DNS reachability cannot be proven." };
      else {
        const d = dnsPods[0]; d.namespace = d.namespace || "kube-system";
        const e = evalDirection(cluster, policies, src, { pod: d, ip: d.ip || null }, 53, "UDP", "Egress");
        dns = { relevant: true, allowed: e.allowed, text: e.allowed ? "DNS allowed: " + e.text : "DNS BLOCKED: no egress rule lets " + src.namespace + "/" + src.name + " reach " + d.namespace + "/" + d.name + " on UDP/53. Every connection by hostname will fail with a resolution error before the allowed IP is ever tried." };
      }
    }
    const allowed = egress.allowed && ingress.allowed;
    return { allowed: allowed, egress: egress, ingress: ingress, dns: dns,
      deciding: !egress.allowed ? (egress.selecting.join(", ") + " (egress side)") : !ingress.allowed ? (ingress.selecting.join(", ") + " (ingress side)") : (egress.by || ingress.by || "no policy selects either pod"),
      summary: allowed ? "Allowed: egress from the source and ingress to the destination both pass." : "Denied: " + (!egress.allowed ? "egress from the source is blocked" : "ingress to the destination is blocked") + "." };
  }
  LOGIC.netpolCheck = netpolCheck;

  const NETPOL_CLUSTER = {
    namespaces: {
      "agents": { labels: { team: "ai" } },
      "kube-system": { labels: {} },
      "ingress-internal": { labels: { tier: "edge" } },
      "default": { labels: {} }
    },
    pods: [
      { namespace: "agents", name: "web-agent-7c9f", labels: { app: "web-agent" }, ip: "10.244.1.7" },
      { namespace: "agents", name: "redis-0", labels: { app: "redis" }, ip: "10.244.1.9" },
      { namespace: "kube-system", name: "coredns-5d78", labels: { "k8s-app": "kube-dns" }, ip: "10.244.0.3" },
      { namespace: "ingress-internal", name: "ingress-nginx-controller-x1", labels: { "app.kubernetes.io/name": "ingress-nginx" }, ip: "10.244.3.2" },
      { namespace: "default", name: "probe", labels: { run: "probe" }, ip: "10.244.2.9" }
    ]
  };
  const NP_DEFAULT_DENY = { name: "default-deny-all", namespace: "agents", spec: { podSelector: {}, policyTypes: ["Ingress", "Egress"] } };
  const NP_ALLOW_DNS = { name: "allow-dns", namespace: "agents", spec: { podSelector: {}, policyTypes: ["Egress"], egress: [
    { to: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "kube-system" } }, podSelector: { matchLabels: { "k8s-app": "kube-dns" } } }],
      ports: [{ protocol: "UDP", port: 53 }, { protocol: "TCP", port: 53 }] } ] } };
  const NP_ALLOW_LLM = { name: "allow-egress-llm-only", namespace: "agents", spec: { podSelector: { matchLabels: { app: "web-agent" } }, policyTypes: ["Egress"], egress: [
    { to: [{ ipBlock: { cidr: "10.20.5.10/32" } }], ports: [{ protocol: "TCP", port: 443 }] },
    { to: [{ ipBlock: { cidr: "10.20.5.11/32" } }], ports: [{ protocol: "TCP", port: 443 }] } ] } };
  const NP_ALLOW_INGRESS = { name: "allow-from-ingress", namespace: "agents", spec: { podSelector: { matchLabels: { app: "web-agent" } }, policyTypes: ["Ingress"], ingress: [
    { from: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "ingress-internal" } }, podSelector: { matchLabels: { "app.kubernetes.io/name": "ingress-nginx" } } }],
      ports: [{ protocol: "TCP", port: 8080 }] } ] } };
  const NETPOL_PRESETS = {
    "default-deny": { label: "default-deny only", policies: [NP_DEFAULT_DENY], query: { from: "agents/web-agent-7c9f", to: "10.20.5.10", port: 443, protocol: "TCP" } },
    "allow-dns-only": { label: "default-deny + allow-dns", policies: [NP_DEFAULT_DENY, NP_ALLOW_DNS], query: { from: "agents/web-agent-7c9f", to: "10.20.5.10", port: 443, protocol: "TCP" } },
    "allow-llm-endpoint": { label: "default-deny + DNS + LLM endpoint + ingress", policies: [NP_DEFAULT_DENY, NP_ALLOW_DNS, NP_ALLOW_LLM, NP_ALLOW_INGRESS], query: { from: "agents/web-agent-7c9f", to: "10.20.5.10", port: 443, protocol: "TCP" } },
    "llm-without-dns": { label: "LLM endpoint allowed but DNS forgotten", policies: [NP_DEFAULT_DENY, NP_ALLOW_LLM], query: { from: "agents/web-agent-7c9f", to: "10.20.5.10", port: 443, protocol: "TCP" } }
  };
  LOGIC.NETPOL_CLUSTER = NETPOL_CLUSTER;
  LOGIC.NETPOL_PRESETS = NETPOL_PRESETS;

  function renderNetpol(host) {
    const ds = host.dataset;
    const presetSel = select(Object.keys(NETPOL_PRESETS).map(function (k) { return [k, NETPOL_PRESETS[k].label]; }), NETPOL_PRESETS[ds.preset] ? ds.preset : "default-deny");
    const clusterTa = textarea({ rows: 14 }, JSON.stringify(NETPOL_CLUSTER, null, 2));
    const polTa = textarea({ rows: 14 });
    const from = input({ size: 26 }), to = input({ size: 26 }), port = input({ size: 6, inputmode: "numeric" }), proto = select(["TCP", "UDP", "SCTP"]);
    const out = h("div", { class: "w-out", "aria-live": "polite" });
    const quick = h("div", { class: "w-btns w-quick" },
      h("span", { class: "w-muted" }, "Quick queries:"),
      button("agent → model API :443", function () { setQ("agents/web-agent-7c9f", "10.20.5.10", 443, "TCP"); }, true),
      button("agent → CoreDNS UDP/53", function () { setQ("agents/web-agent-7c9f", "kube-system/coredns-5d78", 53, "UDP"); }, true),
      button("ingress-nginx → agent :8080", function () { setQ("ingress-internal/ingress-nginx-controller-x1", "agents/web-agent-7c9f", 8080, "TCP"); }, true),
      button("default/probe → agent :8080", function () { setQ("default/probe", "agents/web-agent-7c9f", 8080, "TCP"); }, true),
      button("agent → redis :6379", function () { setQ("agents/web-agent-7c9f", "agents/redis-0", 6379, "TCP"); }, true));
    function setQ(f, t, p, pr) { from.value = f; to.value = t; port.value = p; proto.value = pr; run(); }
    function apply(p) { polTa.value = JSON.stringify(p.policies, null, 2); setQ(p.query.from, p.query.to, p.query.port, p.query.protocol); }
    function run() {
      clear(out);
      const c = safeJson(clusterTa.value, "Cluster model"), p = safeJson(polTa.value, "Policies");
      if (c.error || p.error) { out.append(errorBox(c.error || p.error)); return; }
      const policies = arr(p.value);
      const r = netpolCheck(c.value || {}, policies, { from: from.value, to: to.value, port: port.value, protocol: proto.value });
      if (r.error) { out.append(errorBox(r.error)); return; }
      out.append(
        verdict(r.allowed, r.allowed ? "ALLOWED" : "DENIED", r.summary + " Deciding policy: " + r.deciding + "."),
        h("ul", { class: "w-rules" },
          h("li", {}, badge(r.egress.allowed ? "pass" : "fail", "egress"), " ", r.egress.text),
          h("li", {}, badge(r.ingress.allowed ? "pass" : "fail", "ingress"), " ", r.ingress.text),
          h("li", {}, badge(r.dns.allowed ? (r.dns.relevant ? "pass" : "warn") : "fail", "DNS"), " ", r.dns.text)),
        h("p", { class: "w-muted" }, "DNS gotcha: the moment any Egress policy selects a pod, everything not listed is blocked, including UDP/TCP 53 to CoreDNS in kube-system. Add an explicit allow-dns rule to every default-deny egress set, and remember standard NetworkPolicy matches IPs, not hostnames."));
    }
    host.append(
      head("Kubernetes NetworkPolicy checker", "Additive allow-lists, no deny rules, no ordering"),
      field("Preset policy set", presetSel),
      h("div", { class: "w-grid2" },
        field("Cluster model (namespaces with labels, pods with labels and IPs)", clusterTa),
        field("NetworkPolicies (JSON array; YAML keys as-is: podSelector, policyTypes, ingress/egress, from/to, ports, ipBlock)", polTa)),
      h("fieldset", { class: "w-fieldset" }, h("legend", {}, "Query"),
        h("div", { class: "w-row" }, field("From pod (namespace/name)", from), field("To pod (namespace/name) or IPv4", to), field("Port", port), field("Protocol", proto))),
      quick,
      h("div", { class: "w-btns" }, button("Check", run)),
      out,
      h("p", { class: "w-muted" }, "Limits: IPv4 only, named ports unsupported, no endPort beyond simple ranges, namespaceSelector sees the namespace labels plus the automatic kubernetes.io/metadata.name label. Enforcement in a real cluster depends on the CNI."));
    presetSel.addEventListener("change", function () { apply(NETPOL_PRESETS[presetSel.value]); });
    apply(NETPOL_PRESETS[presetSel.value]);
  }

  /* =========================================================
     7. Zanzibar-style relationship checker (OpenFGA DSL subset)
     ========================================================= */
  // Parses: type X / relations / define rel: [user, group#member] or other or rel2 from parent
  function parseFgaDsl(text) {
    const types = {}; let cur = null; const errors = [];
    String(text || "").split(/\r?\n/).forEach(function (raw, ln) {
      const line = raw.replace(/(^|\s)#.*$/, "").trim();
      if (!line || /^model\b/.test(line) || /^schema\b/.test(line) || /^relations\b/.test(line)) return;
      let m = /^type\s+([A-Za-z0-9_-]+)$/.exec(line);
      if (m) { cur = m[1]; types[cur] = types[cur] || {}; return; }
      m = /^define\s+([A-Za-z0-9_-]+)\s*:\s*(.+)$/.exec(line);
      if (m) {
        if (!cur) { errors.push("line " + (ln + 1) + ": define outside a type"); return; }
        if (/\b(and|but not)\b/.test(m[2])) { errors.push("line " + (ln + 1) + ": only 'or' unions and 'X from Y' are supported (no and / but not)"); return; }
        const def = { direct: [], or: [], from: [] };
        m[2].split(/\s+or\s+/).forEach(function (term) {
          term = term.trim();
          let t = /^\[(.*)\]$/.exec(term);
          if (t) { t[1].split(",").map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (s) { def.direct.push(s.replace(/\s+/g, "")); }); return; }
          t = /^([A-Za-z0-9_-]+)\s+from\s+([A-Za-z0-9_-]+)$/.exec(term);
          if (t) { def.from.push({ relation: t[1], via: t[2] }); return; }
          if (/^[A-Za-z0-9_-]+$/.test(term)) { def.or.push(term); return; }
          errors.push("line " + (ln + 1) + ": cannot parse term '" + term + "'");
        });
        types[cur][m[1]] = def;
        return;
      }
      errors.push("line " + (ln + 1) + ": unrecognized: " + line);
    });
    return { types: types, errors: errors };
  }
  LOGIC.parseFgaDsl = parseFgaDsl;
  // Tuples: one per line "object#relation@user" or JSON array of {user, relation, object}
  function parseTuples(text) {
    text = String(text || "").trim();
    const tuples = [], errors = [];
    if (text[0] === "[") {
      const j = safeJson(text, "Tuples");
      if (j.error) return { tuples: [], errors: [j.error] };
      arr(j.value).forEach(function (t, i) {
        if (!t || !t.user || !t.relation || !t.object) errors.push("tuple " + (i + 1) + " needs user, relation, object");
        else tuples.push({ object: String(t.object), relation: String(t.relation), user: String(t.user) });
      });
      return { tuples: tuples, errors: errors };
    }
    text.split(/\r?\n/).forEach(function (raw, ln) {
      const line = raw.replace(/\/\/.*$/, "").trim();
      if (!line) return;
      const m = /^([A-Za-z0-9_-]+:[^#@\s]+)#([A-Za-z0-9_-]+)@([A-Za-z0-9_-]+:[^#@\s]+(?:#[A-Za-z0-9_-]+)?)$/.exec(line);
      if (!m) { errors.push("line " + (ln + 1) + ": expected object#relation@user, got '" + line + "'"); return; }
      tuples.push({ object: m[1], relation: m[2], user: m[3] });
    });
    return { tuples: tuples, errors: errors };
  }
  LOGIC.parseTuples = parseTuples;
  function typeOf(obj) { return String(obj).split(":")[0]; }
  // Returns { ok, path: [...] } ; path is a list of human-readable derivation steps
  function rebacCheck(model, tuples, user, relation, object, depth, visited) {
    depth = depth || 0; visited = visited || {};
    const key = object + "#" + relation + "@" + user;
    if (depth > 25) return { ok: false, path: [], note: "depth limit" };
    if (visited[key]) return { ok: false, path: [] };
    visited[key] = true;
    const type = model.types[typeOf(object)];
    if (!type) return { ok: false, path: [], note: "unknown type " + typeOf(object) };
    const def = type[relation];
    if (!def) return { ok: false, path: [], note: "type " + typeOf(object) + " has no relation " + relation };
    // 1. direct tuples (including usersets like group:eng#member)
    const direct = tuples.filter(function (t) { return t.object === object && t.relation === relation; });
    for (let i = 0; i < direct.length; i++) {
      const t = direct[i];
      if (t.user === user) return { ok: true, path: ["tuple " + t.object + "#" + t.relation + "@" + t.user] };
      const us = t.user.indexOf("#") > 0 ? t.user.split("#") : null;
      if (us) {
        const sub = rebacCheck(model, tuples, user, us[1], us[0], depth + 1, visited);
        if (sub.ok) return { ok: true, path: ["tuple " + t.object + "#" + t.relation + "@" + t.user + " (userset)"].concat(sub.path) };
      }
    }
    // 2. union: relation includes other relations on the same object
    for (let i = 0; i < def.or.length; i++) {
      const sub = rebacCheck(model, tuples, user, def.or[i], object, depth + 1, visited);
      if (sub.ok) return { ok: true, path: [typeOf(object) + "#" + relation + " includes " + def.or[i]].concat(sub.path) };
    }
    // 3. tupleToUserset: relation from via (walk to the parent object)
    for (let i = 0; i < def.from.length; i++) {
      const f = def.from[i];
      const parents = tuples.filter(function (t) { return t.object === object && t.relation === f.via; });
      for (let p = 0; p < parents.length; p++) {
        const sub = rebacCheck(model, tuples, user, f.relation, parents[p].user, depth + 1, visited);
        if (sub.ok) return { ok: true, path: [typeOf(object) + "#" + relation + " includes " + f.relation + " from " + f.via, "tuple " + object + "#" + f.via + "@" + parents[p].user].concat(sub.path) };
      }
    }
    return { ok: false, path: [] };
  }
  LOGIC.rebacCheck = function (model, tuples, user, relation, object) { return rebacCheck(model, tuples, user, relation, object, 0, {}); };
  function rebacListObjects(model, tuples, user, relation, type) {
    const objs = {};
    tuples.forEach(function (t) { if (typeOf(t.object) === type) objs[t.object] = true; if (typeOf(t.user.split("#")[0]) === type) objs[t.user.split("#")[0]] = true; });
    return Object.keys(objs).sort().map(function (o) { const r = rebacCheck(model, tuples, user, relation, o, 0, {}); return { object: o, ok: r.ok, path: r.path }; }).filter(function (x) { return x.ok; });
  }
  LOGIC.rebacListObjects = rebacListObjects;

  const REBAC_MODEL = [
    "model", "  schema 1.1", "", "type user", "", "type group", "  relations", "    define member: [user]", "",
    "type folder", "  relations", "    define owner: [user]", "    define editor: [user] or owner", "    define viewer: [user, group#member] or editor", "",
    "type document", "  relations", "    define parent: [folder]", "    define owner: [user]", "    define editor: [user] or owner or editor from parent", "    define viewer: [user, group#member] or editor or viewer from parent"
  ].join("\n");
  const REBAC_TUPLES = [
    "folder:q3#owner@user:alice", "folder:q3#viewer@group:eng#member", "group:eng#member@user:carol",
    "document:plan#parent@folder:q3", "document:plan#viewer@user:bob",
    "document:memo#owner@user:bob"
  ].join("\n");

  function renderRebac(host) {
    const modelTa = textarea({ rows: 20 }, REBAC_MODEL), tuplesTa = textarea({ rows: 8 }, REBAC_TUPLES);
    const user = input({ value: "user:alice", size: 16 }), rel = input({ value: "viewer", size: 10 }), obj = input({ value: "document:plan", size: 18 });
    const lUser = input({ value: "user:carol", size: 16 }), lRel = input({ value: "viewer", size: 10 }), lType = input({ value: "document", size: 12 });
    const out = h("div", { class: "w-out", "aria-live": "polite" }), out2 = h("div", { class: "w-out", "aria-live": "polite" });
    function load() {
      const m = parseFgaDsl(modelTa.value), t = parseTuples(tuplesTa.value);
      const errs = m.errors.concat(t.errors);
      return { model: m, tuples: t.tuples, errors: errs };
    }
    function check() {
      clear(out);
      const d = load(); if (d.errors.length) { out.append(errorBox(d.errors.join(" | "))); return; }
      const r = rebacCheck(d.model, d.tuples, user.value.trim(), rel.value.trim(), obj.value.trim(), 0, {});
      out.append(verdict(r.ok, r.ok ? "ALLOWED: " + user.value + " is " + rel.value + " of " + obj.value : "DENIED: no path from " + user.value + " to " + obj.value + "#" + rel.value, r.note || null));
      if (r.ok) out.append(h("div", { class: "w-label" }, "Derivation (read top-down: rewrite rule, then the tuple that satisfied it)"), h("ol", { class: "w-seq" }, r.path.map(function (s) { return h("li", {}, h("code", {}, s)); })));
      else out.append(h("p", { class: "w-muted" }, "The graph walk tried direct tuples, every 'or' rewrite and every 'from parent' hop without reaching a tuple that names " + user.value + "."));
    }
    function list() {
      clear(out2);
      const d = load(); if (d.errors.length) { out2.append(errorBox(d.errors.join(" | "))); return; }
      const rs = rebacListObjects(d.model, d.tuples, lUser.value.trim(), lRel.value.trim(), lType.value.trim());
      out2.append(h("p", {}, h("strong", {}, rs.length + " object" + (rs.length === 1 ? "" : "s")), " of type " + lType.value + " where " + lUser.value + " has " + lRel.value + (rs.length ? ":" : ".")));
      if (rs.length) out2.append(h("ul", { class: "w-rules" }, rs.map(function (r) { return h("li", {}, h("code", {}, r.object), h("span", { class: "w-muted" }, "  via " + r.path.join(" → "))); })));
      out2.append(h("p", { class: "w-muted" }, "list-objects is a reverse graph walk over every candidate object; this is the expensive call you use for RAG pre-filtering, so cache or index it."));
    }
    host.append(
      head("Relationship-based access (Zanzibar / OpenFGA subset)", "check(user, relation, object) and list-objects with derivation paths"),
      h("div", { class: "w-grid2" },
        field("Authorization model (OpenFGA DSL: [direct types], 'or' unions, 'X from Y')", modelTa),
        field("Relationship tuples (object#relation@user, one per line; or a JSON array of {user, relation, object})", tuplesTa)),
      h("fieldset", { class: "w-fieldset" }, h("legend", {}, "check"),
        h("div", { class: "w-row" }, field("User", user), field("Relation", rel), field("Object", obj), h("div", { class: "w-field" }, h("label", {}, " "), button("Check", check))),
        out),
      h("fieldset", { class: "w-fieldset" }, h("legend", {}, "list-objects"),
        h("div", { class: "w-row" }, field("User", lUser), field("Relation", lRel), field("Object type", lType), h("div", { class: "w-field" }, h("label", {}, " "), button("List objects", list))),
        out2),
      h("p", { class: "w-muted" }, "Try: delete the document:plan#parent@folder:q3 line and check alice again (no path); check user:carol viewer document:plan (group userset, then parent); check user:bob editor document:plan (denied: viewer does not imply editor)."));
    check(); list();
  }

  /* =========================================================
     8. Spot the bug (quiz-engine look)
     ========================================================= */
  function renderSpotTheBug(host) {
    const j = readJsonChild(host);
    if (j.error) { host.append(errorBox(j.error)); return; }
    const d = j.value || {};
    const opts = arr(d.options);
    if (!d.snippet || opts.length < 2) { host.append(errorBox("spot-the-bug needs a snippet and at least two options.")); return; }
    const name = uid("stb");
    const q = h("div", { class: "q w-stb" });
    q.append(h("div", { class: "q-head" }, h("span", { class: "q-num" }, "Spot the bug"), h("span", { class: "q-domain" }, d.language || "code"), h("span", { class: "q-type" }, "Choose one")));
    if (d.prompt) q.append(h("div", { class: "q-text" }, d.prompt));
    q.append(h("pre", { class: "w-stb-pre" }, h("code", {}, d.snippet)));
    const ul = h("ul", { class: "opts" });
    const lis = opts.map(function (o, i) {
      const id = name + "-" + i;
      const inp = h("input", { type: "radio", name: name, id: id, value: String(i) });
      const li = h("li", {}, h("label", { for: id }, inp, h("span", {}, o.text)));
      ul.append(li); return li;
    });
    q.append(ul);
    const commit = h("button", { type: "button", class: "btn w-btn" }, "Commit");
    const retry = h("button", { type: "button", class: "btn secondary w-btn", hidden: true }, "Try again");
    const btns = h("div", { class: "w-btns" }, commit, retry);
    q.append(btns);
    let tail = [];
    commit.addEventListener("click", function () {
      const chosen = ul.querySelector("input:checked");
      if (!chosen) { const w = h("div", { class: "w-error", role: "alert" }, "Pick an option first."); q.insertBefore(w, btns); tail.push(w); setTimeout(function () { w.remove(); }, 2000); return; }
      const ci = parseInt(chosen.value, 10);
      ul.querySelectorAll("input").forEach(function (i) { i.disabled = true; });
      lis.forEach(function (li, i) {
        const o = opts[i];
        if (o.correct && i === ci) li.classList.add("correct");
        else if (o.correct) li.classList.add("missed");
        else if (i === ci) li.classList.add("wrong");
        if (o.why) { const w = h("div", { class: "why" }, (o.correct ? "✔ " : "✘ ") + o.why); li.append(w); tail.push(w); }
      });
      const right = !!opts[ci].correct;
      const v = h("div", { class: "verdict " + (right ? "ok" : "bad") }, right ? "Correct" : "Incorrect");
      const ex = d.explanation ? h("div", { class: "explain" }, d.explanation) : null;
      q.insertBefore(v, btns); if (ex) q.insertBefore(ex, btns);
      tail.push(v); if (ex) tail.push(ex);
      commit.hidden = true; retry.hidden = false;
    });
    retry.addEventListener("click", function () {
      tail.forEach(function (n) { n.remove(); }); tail = [];
      lis.forEach(function (li) { li.classList.remove("correct", "missed", "wrong"); });
      ul.querySelectorAll("input").forEach(function (i) { i.disabled = false; i.checked = false; });
      commit.hidden = false; retry.hidden = true;
    });
    host.append(q);
  }

  /* =========================================================
     9. Terminal replay
     ========================================================= */
  function renderTerminalReplay(host) {
    const j = readJsonChild(host);
    if (j.error) { host.append(errorBox(j.error)); return; }
    const d = j.value || {};
    const steps = arr(d.steps);
    if (!steps.length) { host.append(errorBox("terminal-replay needs a non-empty steps array.")); return; }
    let shown = 0, timer = null;
    const preEl = h("pre", { class: "terminal w-term", "aria-live": "polite" });
    const code = h("code"); preEl.append(code);
    const notes = h("div", { class: "w-term-notes" });
    const counter = h("span", { class: "w-muted" });
    function render() {
      clear(code); clear(notes);
      for (let i = 0; i < shown; i++) {
        const s = steps[i];
        code.append(h("span", { class: "prompt" }, (s.prompt || "$") + " "), h("span", { class: "cmd" }, s.cmd || ""), "\n");
        if (s.out) code.append(h("span", { class: "out" }, s.out), "\n");
        if (s.note) notes.append(h("div", { class: "w-term-note" }, h("span", { class: "w-term-step" }, String(i + 1)), " ", s.note));
      }
      if (shown === 0) code.append(h("span", { class: "out w-muted" }, "Press Next or the right arrow key to run the first command."));
      else if (shown < steps.length) code.append(h("span", { class: "prompt" }, "$ "), h("span", { class: "w-cursor" }, "█"));
      counter.textContent = shown + " / " + steps.length;
      nextBtn.disabled = shown >= steps.length; backBtn.disabled = shown === 0;
      preEl.scrollTop = preEl.scrollHeight;
    }
    function stop() { if (timer) { clearInterval(timer); timer = null; playBtn.textContent = "Play all"; } }
    function next() { if (shown < steps.length) { shown++; render(); } if (shown >= steps.length) stop(); }
    const nextBtn = button("Next", next);
    const backBtn = button("Back", function () { stop(); if (shown > 0) { shown--; render(); } }, true);
    const playBtn = button("Play all", function () {
      if (timer) { stop(); return; }
      if (shown >= steps.length) { shown = 0; render(); }
      playBtn.textContent = "Pause";
      timer = setInterval(next, 900);
    }, true);
    const resetBtn = button("Reset", function () { stop(); shown = 0; render(); }, true);
    const wrap = h("div", { class: "w-termwrap", tabindex: "0", "aria-label": (d.title || "Terminal replay") + "; right arrow for next step, left arrow for back",
      onkeydown: function (e) { if (e.key === "ArrowRight") { e.preventDefault(); stop(); next(); } else if (e.key === "ArrowLeft") { e.preventDefault(); backBtn.click(); } } });
    wrap.append(h("div", { class: "w-term-title" }, h("span", { class: "w-term-dots" }, "● ● ●"), h("span", {}, d.title || "Terminal")), preEl);
    host.append(wrap, h("div", { class: "w-btns" }, nextBtn, backBtn, playBtn, resetBtn, counter), notes);
    render();
  }

  /* =========================================================
     10. Self-tests over the pure logic (no UI needed)
     ========================================================= */
  function runSelfTests() {
    const results = [];
    function t(name, cond, detail) { results.push({ name: name, pass: !!cond, detail: detail || "" }); }
    const now = 1790243400; // 2026-09-24T09:50:00Z
    // base64url
    t("b64url round trip", b64urlDecode(b64urlEncode("héllo {\"a\":1}")) === "héllo {\"a\":1}");
    t("b64url no padding", b64urlEncode("ab").indexOf("=") < 0);
    // JWT decode
    const mk = function (hd, pl, sig) { return b64urlEncode(JSON.stringify(hd)) + "." + b64urlEncode(JSON.stringify(pl)) + "." + (sig == null ? "sig" : sig); };
    const good = decodeJwt(mk({ alg: "RS256", kid: "k1", typ: "JWT" }, { iss: "I", aud: "A", exp: now + 600, nbf: now, iat: now, sub: "s" }));
    t("decodeJwt parses header", good.header && good.header.alg === "RS256");
    t("decodeJwt rejects 2 segments", !!decodeJwt("a.b").error);
    t("decodeJwt rejects bad base64", !!decodeJwt("!!.!!.x").error);
    const rows = function (d, o) { const r = checkJwtClaims(d, Object.assign({ now: now, iss: "I", aud: "A" }, o || {})); const m = {}; r.forEach(function (x) { m[x.name] = x; }); return m; };
    let m = rows(good);
    t("jwt valid: all pass", Object.keys(m).every(function (k) { return m[k].level !== "fail"; }), JSON.stringify(Object.keys(m).filter(function (k) { return m[k].level === "fail"; })));
    m = rows(decodeJwt(mk({ alg: "none", kid: "k1" }, { iss: "I", aud: "A", exp: now + 600, iat: now, sub: "s" }, "")));
    t("jwt alg none fails alg check", m["alg allowed"].level === "fail");
    m = rows(decodeJwt(mk({ alg: "HS256", kid: "k1" }, { iss: "I", aud: "A", exp: now + 600, iat: now, sub: "s" })));
    t("jwt HS256 not in allowlist", m["alg allowed"].level === "fail");
    m = rows(decodeJwt(mk({ alg: "RS256" }, { iss: "I", aud: "A", exp: now + 600, iat: now, sub: "s" })));
    t("jwt missing kid fails", m["kid present"].level === "fail");
    m = rows(decodeJwt(mk({ alg: "RS256", kid: "k1" }, { iss: "I", aud: "A", exp: now - 61, iat: now - 700, sub: "s" })));
    t("jwt expired beyond skew fails", m["exp in the future"].level === "fail");
    m = rows(decodeJwt(mk({ alg: "RS256", kid: "k1" }, { iss: "I", aud: "A", exp: now - 30, iat: now - 700, sub: "s" })));
    t("jwt expired within 60 s skew passes", m["exp in the future"].level === "pass");
    m = rows(decodeJwt(mk({ alg: "RS256", kid: "k1" }, { iss: "I", aud: ["X", "A"], exp: now + 600, iat: now, sub: "s" })));
    t("jwt aud array containing expected passes", m["aud matches"].level === "pass");
    m = rows(decodeJwt(mk({ alg: "RS256", kid: "k1" }, { iss: "I", aud: "https://graph.microsoft.com", exp: now + 600, iat: now, sub: "s" })));
    t("jwt wrong aud fails", m["aud matches"].level === "fail");
    m = rows(decodeJwt(mk({ alg: "RS256", kid: "k1" }, { iss: "https://other", aud: "A", exp: now + 600, iat: now, sub: "s" })));
    t("jwt wrong iss fails", m["iss matches"].level === "fail");
    m = rows(decodeJwt(mk({ alg: "RS256", kid: "k1" }, { iss: "I", aud: "A", exp: now + 600, nbf: now + 300, iat: now, sub: "s" })));
    t("jwt nbf in future fails", m["nbf"].level === "fail");
    m = rows(decodeJwt(mk({ alg: "RS256", kid: "k1" }, { iss: "I", aud: "A", exp: now + 600, iat: now + 600, sub: "s" })));
    t("jwt iat in future fails", m["iat sanity"].level === "fail");
    // Cookie sim
    const ck = function (o) { return cookieSim(Object.assign({ httpOnly: true, secure: true, sameSite: "Lax", domain: "", hostPrefix: false, scenario: "cross-post" }, o)); };
    t("cookie Lax blocks cross-site POST", ck({}).sent === false);
    t("cookie Lax allows top-level GET", ck({ scenario: "toplevel-get" }).sent === true);
    t("cookie Strict blocks top-level GET", ck({ scenario: "toplevel-get", sameSite: "Strict" }).sent === false);
    t("cookie None+Secure sent in iframe", ck({ scenario: "iframe", sameSite: "None" }).sent === true);
    t("cookie None without Secure rejected", ck({ scenario: "iframe", sameSite: "None", secure: false }).accepted === false);
    t("cookie Lax blocks cross-site img", ck({ scenario: "cross-img" }).sent === false);
    t("cookie Secure not sent over http", ck({ scenario: "http" }).sent === false);
    t("cookie host-only not sent to api subdomain", ck({ scenario: "same-site-xhr" }).sent === false);
    t("cookie Domain=example.com sent to api subdomain", ck({ scenario: "same-site-xhr", domain: "example.com" }).sent === true);
    t("cookie HttpOnly hides from script", ck({ scenario: "js-read" }).readable === false);
    t("cookie without HttpOnly readable", ck({ scenario: "js-read", httpOnly: false }).readable === true);
    t("__Host- with Domain rejected", ck({ hostPrefix: true, domain: "example.com" }).accepted === false);
    t("__Host- without Secure rejected", ck({ hostPrefix: true, secure: false }).accepted === false);
    t("__Host- valid accepted", ck({ hostPrefix: true }).accepted === true);
    // CORS
    const cs = function (o) { return corsSim(Object.assign({ origin: "https://app.example.com", serverOrigin: "https://api.example.com", method: "GET", headers: "", credentials: false, allowOrigin: "https://app.example.com", allowCredentials: false, allowMethods: "", allowHeaders: "" }, o)); };
    t("cors simple GET no preflight, readable", cs({}).preflight === false && cs({}).readable === true);
    t("cors JSON POST needs preflight", cs({ method: "POST", headers: "Content-Type: application/json" }).preflight === true);
    t("cors form POST is simple", cs({ method: "POST", headers: "Content-Type: application/x-www-form-urlencoded" }).preflight === false);
    t("cors Authorization header triggers preflight", cs({ headers: "Authorization" }).preflight === true);
    let c = cs({ method: "POST", headers: "Authorization, Content-Type: application/json", allowMethods: "POST", allowHeaders: "content-type" });
    t("cors header not in Allow-Headers fails preflight", c.preflightPass === false && c.reasons.some(function (r) { return /header authorization not in/.test(r); }));
    c = cs({ method: "POST", headers: "Authorization, Content-Type: application/json", allowMethods: "POST", allowHeaders: "authorization, content-type" });
    t("cors full allow passes preflight and readable", c.preflightPass === true && c.readable === true);
    c = cs({ method: "DELETE", allowMethods: "GET, POST" });
    t("cors method not allowed fails", c.preflightPass === false && c.reasons.some(function (r) { return /method DELETE not in/.test(r); }));
    c = cs({ credentials: true, allowOrigin: "*", allowCredentials: true });
    t("cors * with credentials not readable", c.readable === false && c.reasons.some(function (r) { return /cannot be used with credentials/.test(r); }));
    c = cs({ allowOrigin: "https://other.example" });
    t("cors origin mismatch not readable but sent", c.readable === false && c.sent === true && c.reasons.some(function (r) { return /origin mismatch/.test(r); }));
    c = cs({ origin: "https://evil.example", credentials: true, allowOrigin: "reflect", allowCredentials: true });
    t("cors reflected origin + credentials flagged", c.readable === true && c.misconfig === true);
    c = cs({ credentials: true, allowCredentials: false });
    t("cors credentials without Allow-Credentials not readable", c.readable === false);
    t("cors same-origin bypasses", cs({ origin: "https://api.example.com" }).sameOrigin === true);
    // OAuth flows sanity
    Object.keys(OAUTH_FLOWS).forEach(function (k) {
      const f = OAUTH_FLOWS[k];
      const ids = f.participants.map(function (p) { return p.id; });
      t("oauth flow " + k + " has 6-11 steps and valid participants", f.steps.length >= 6 && f.steps.length <= 11 && f.steps.every(function (s) { return ids.indexOf(s.from) >= 0 && ids.indexOf(s.to) >= 0 && s.why && s.params.length; }));
    });
    t("oauth pkce flow carries code_challenge and resource", OAUTH_FLOWS["auth-code-pkce"].steps[1].params.join(" ").indexOf("code_challenge_method=S256") >= 0 && OAUTH_FLOWS["auth-code-pkce"].steps[1].params.join(" ").indexOf("resource=") >= 0);
    t("oauth mcp flow starts with 401 resource_metadata", OAUTH_FLOWS["mcp-discovery"].steps[1].params.join(" ").indexOf("resource_metadata=") >= 0);
    // IAM
    t("wildcard s3:Get* matches s3:GetObject", wildcardMatch("s3:Get*", "s3:GetObject", true));
    t("wildcard ? single char", wildcardMatch("s3:Get?bject", "s3:GetObject", true) && !wildcardMatch("s3:Get?bject", "s3:GetObbject", true));
    t("wildcard action case-insensitive", wildcardMatch("s3:getobject", "s3:GetObject", true));
    const ev = function (name, over) { const p = Object.assign({}, IAM_PRESETS[name], over || {}); return iamEval(p); };
    t("iam s3-read-ok ALLOW", ev("s3-read-ok").decision === "ALLOW");
    t("iam s3-read-ok denies PutObject implicitly", ev("s3-read-ok", { action: "s3:PutObject" }).kind === "implicit");
    t("iam s3-read-ok denies object outside docs/ prefix", ev("s3-read-ok", { resourceArn: "arn:aws:s3:::example-docs/finance/x" }).decision === "DENY");
    t("iam explicit-deny DENY explicit", ev("explicit-deny").kind === "explicit");
    t("iam explicit-deny allows other prefix", ev("explicit-deny", { resourceArn: "arn:aws:s3:::example-docs/docs/x" }).decision === "ALLOW");
    t("iam scp-blocks DENY explicit via SCP", ev("scp-blocks").kind === "explicit" && /SCP/.test(ev("scp-blocks").reason));
    t("iam SCP implicit deny when SCP lacks allow", ev("s3-read-ok", { scp: JSON.stringify({ Statement: [{ Effect: "Allow", Action: "ec2:*", Resource: "*" }] }) }).kind === "implicit-scp");
    t("iam cross-account missing resource policy DENY", ev("cross-account-missing-resource-policy").kind === "cross-account");
    t("iam cross-account-ok ALLOW with PrincipalOrgID", ev("cross-account-ok").decision === "ALLOW");
    t("iam cross-account-ok DENY with wrong OrgID", ev("cross-account-ok", { orgId: "o-other" }).decision === "DENY");
    t("iam boundary blocks", ev("cross-account-ok", { boundary: JSON.stringify({ Statement: [{ Effect: "Allow", Action: "logs:*", Resource: "*" }] }) }).kind === "implicit-boundary");
    t("iam same-account resource policy alone allows", ev("cross-account-ok", { sameAccount: true, identity: "" }).decision === "ERROR" ? false : ev("cross-account-ok", { sameAccount: true, identity: JSON.stringify({ Statement: [{ Effect: "Allow", Action: "ec2:*", Resource: "*" }] }) }).kind === "resource-policy");
    t("iam ExternalId wrong DENY", ev("assume-role-externalid").decision === "DENY");
    t("iam ExternalId right ALLOW", ev("assume-role-externalid", { externalId: "cust-7f3a9c-d41e" }).decision === "ALLOW");
    t("iam NotAction basic", iamEval({ identity: JSON.stringify({ Statement: [{ Effect: "Allow", NotAction: "iam:*", Resource: "*" }] }), resource: "", scp: "", boundary: "", principal: "arn:aws:iam::111111111111:role/x", action: "s3:GetObject", resourceArn: "arn:aws:s3:::b/o", sameAccount: true }).decision === "ALLOW"
      && iamEval({ identity: JSON.stringify({ Statement: [{ Effect: "Allow", NotAction: "iam:*", Resource: "*" }] }), resource: "", scp: "", boundary: "", principal: "arn:aws:iam::111111111111:role/x", action: "iam:CreateUser", resourceArn: "*", sameAccount: true }).decision === "DENY");
    t("iam bad JSON reports error", iamEval({ identity: "{oops", resource: "", scp: "", boundary: "", principal: "a", action: "b", resourceArn: "c", sameAccount: true }).decision === "ERROR");
    t("iam unsupported condition skips statement", iamEval({ identity: JSON.stringify({ Statement: [{ Effect: "Allow", Action: "*", Resource: "*", Condition: { IpAddress: { "aws:SourceIp": "10.0.0.0/8" } } }] }), resource: "", scp: "", boundary: "", principal: "arn:aws:iam::111111111111:role/x", action: "s3:GetObject", resourceArn: "*", sameAccount: true }).decision === "DENY");
    // NetPol
    t("cidr /32 exact", cidrContains("10.20.5.10/32", "10.20.5.10") && !cidrContains("10.20.5.10/32", "10.20.5.11"));
    t("cidr /16 range", cidrContains("10.20.0.0/16", "10.20.255.1") && !cidrContains("10.20.0.0/16", "10.21.0.1"));
    t("cidr /0 everything", cidrContains("0.0.0.0/0", "8.8.8.8"));
    const np = function (preset, q) { const p = NETPOL_PRESETS[preset]; return netpolCheck(JSON.parse(JSON.stringify(NETPOL_CLUSTER)), p.policies, q || p.query); };
    t("netpol default-deny blocks LLM egress", np("default-deny").allowed === false && np("default-deny").dns.allowed === false);
    t("netpol allow-dns-only: LLM denied, DNS ok", np("allow-dns-only").allowed === false && np("allow-dns-only").dns.allowed === true);
    t("netpol allow-llm: LLM allowed, DNS ok", np("allow-llm-endpoint").allowed === true && np("allow-llm-endpoint").dns.allowed === true);
    t("netpol llm-without-dns: LLM allowed, DNS blocked", np("llm-without-dns").allowed === true && np("llm-without-dns").dns.allowed === false);
    t("netpol DNS query itself allowed", np("allow-llm-endpoint", { from: "agents/web-agent-7c9f", to: "kube-system/coredns-5d78", port: 53, protocol: "UDP" }).allowed === true);
    t("netpol DNS over TCP/53 allowed, TCP/80 to coredns denied", np("allow-llm-endpoint", { from: "agents/web-agent-7c9f", to: "kube-system/coredns-5d78", port: 53, protocol: "TCP" }).allowed === true && np("allow-llm-endpoint", { from: "agents/web-agent-7c9f", to: "kube-system/coredns-5d78", port: 80, protocol: "TCP" }).allowed === false);
    t("netpol ingress from ingress-nginx allowed", np("allow-llm-endpoint", { from: "ingress-internal/ingress-nginx-controller-x1", to: "agents/web-agent-7c9f", port: 8080, protocol: "TCP" }).allowed === true);
    t("netpol ingress from default/probe denied", np("allow-llm-endpoint", { from: "default/probe", to: "agents/web-agent-7c9f", port: 8080, protocol: "TCP" }).allowed === false);
    t("netpol wrong port to LLM denied", np("allow-llm-endpoint", { from: "agents/web-agent-7c9f", to: "10.20.5.10", port: 80, protocol: "TCP" }).allowed === false);
    t("netpol no policies = allowed", netpolCheck(JSON.parse(JSON.stringify(NETPOL_CLUSTER)), [], { from: "default/probe", to: "agents/web-agent-7c9f", port: 8080, protocol: "TCP" }).allowed === true);
    t("netpol unknown pod errors", !!netpolCheck(NETPOL_CLUSTER, [], { from: "nope/x", to: "1.1.1.1", port: 1, protocol: "TCP" }).error);
    t("netpol selector matchExpressions In", selectorMatches({ matchExpressions: [{ key: "app", operator: "In", values: ["a", "b"] }] }, { app: "b" }) && !selectorMatches({ matchExpressions: [{ key: "app", operator: "In", values: ["a"] }] }, { app: "b" }));
    // ReBAC
    const model = parseFgaDsl(REBAC_MODEL), tuples = parseTuples(REBAC_TUPLES).tuples;
    t("fga dsl parses 4 types", model.errors.length === 0 && Object.keys(model.types).length === 4);
    t("fga dsl viewer from parent parsed", model.types.document.viewer.from.length === 1 && model.types.document.viewer.from[0].via === "parent");
    t("fga dsl direct userset parsed", model.types.folder.viewer.direct.indexOf("group#member") >= 0);
    t("fga dsl rejects 'and'", parseFgaDsl("type x\n  relations\n    define a: b and c").errors.length === 1);
    t("tuples parse 6 lines", tuples.length === 6);
    t("tuples JSON format", parseTuples('[{"user":"user:a","relation":"owner","object":"folder:f"}]').tuples.length === 1);
    t("rebac alice viewer document:plan via owner→editor→viewer→parent", rebacCheck(model, tuples, "user:alice", "viewer", "document:plan", 0, {}).ok === true);
    t("rebac alice editor document:plan via parent", rebacCheck(model, tuples, "user:alice", "editor", "document:plan", 0, {}).ok === true);
    t("rebac bob viewer document:plan direct", rebacCheck(model, tuples, "user:bob", "viewer", "document:plan", 0, {}).path.length === 1);
    t("rebac bob NOT editor document:plan", rebacCheck(model, tuples, "user:bob", "editor", "document:plan", 0, {}).ok === false);
    t("rebac carol viewer via group userset then parent", rebacCheck(model, tuples, "user:carol", "viewer", "document:plan", 0, {}).ok === true);
    const noParent = tuples.filter(function (x) { return x.relation !== "parent"; });
    t("rebac alice denied without parent tuple", rebacCheck(model, noParent, "user:alice", "viewer", "document:plan", 0, {}).ok === false);
    t("rebac unknown relation note", /no relation/.test(rebacCheck(model, tuples, "user:alice", "admin", "document:plan", 0, {}).note || ""));
    t("rebac list-objects carol viewer documents", rebacListObjects(model, tuples, "user:carol", "viewer", "document").map(function (x) { return x.object; }).join(",") === "document:plan");
    t("rebac list-objects bob viewer documents", rebacListObjects(model, tuples, "user:bob", "viewer", "document").length === 2);
    t("rebac cycle safe", rebacCheck({ types: { a: { r: { direct: [], or: ["r"], from: [] } } } }, [], "user:x", "r", "a:1", 0, {}).ok === false);
    return results;
  }
  LOGIC.runSelfTests = runSelfTests;

  function renderSelfTest(host) {
    const out = h("pre", { class: "w-pre" });
    const summary = h("div", { role: "status" });
    host.append(head("Widget self-tests", "Runs the pure logic behind every widget"), h("div", { class: "w-btns" }, button("Run self-tests", function () {
      let res;
      try { res = runSelfTests(); } catch (e) { clear(summary); summary.append(errorBox("Self-tests threw: " + e.message)); console.error(e); return; }
      const fails = res.filter(function (r) { return !r.pass; });
      clear(summary); summary.append(verdict(fails.length === 0, (res.length - fails.length) + " / " + res.length + " assertions passed", fails.length ? fails.map(function (f) { return f.name; }).join("; ") : "All good."));
      out.textContent = res.map(function (r) { return (r.pass ? "PASS " : "FAIL ") + r.name + (r.detail ? "   " + r.detail : ""); }).join("\n");
      host.dataset.wSelftest = fails.length === 0 ? "pass" : "fail";
    })), summary, out);
  }

  /* =========================================================
     defense-lab: switch defences off, run an attack, see why it fails
     Data (child <script type="application/json">):
       { "title", "sub", "from", "to",
         "layers":  [{ "id", "label", "on": true }],
         "attacks": [{ "id", "label", "story",
                       "artifact": [{ "text", "when": {layerId: bool}, "flag": "ok|bad" }],
                       "rules":    [{ "when": {layerId: bool}, "result": "blocked|success", "by": layerId, "why" }] }] }
     Rules are evaluated in order; the first whose "when" matches the current switches wins.
     ========================================================= */
  function dlMatch(when, state) {
    return Object.keys(when || {}).every(function (k) { return !!state[k] === !!when[k]; });
  }
  function dlEvaluate(attack, state) {
    const rule = (attack.rules || []).find(function (r) { return dlMatch(r.when, state); });
    const lines = (attack.artifact || []).filter(function (a) { return dlMatch(a.when, state); });
    return { rule: rule || { result: "success", why: "No rule matched; treat as undefended." }, lines: lines };
  }
  LOGIC.dlEvaluate = dlEvaluate;

  function renderDefenseLab(host) {
    const got = readJsonChild(host);
    if (got.error) { host.append(errorBox(got.error)); return; }
    const d = got.value;
    const layers = d.layers || [], attacks = d.attacks || [];
    if (!layers.length || !attacks.length) { host.append(errorBox("defense-lab needs layers and attacks.")); return; }
    const state = {};
    layers.forEach(function (l) { state[l.id] = l.on !== false; });
    let current = attacks[0].id;

    host.append(head(d.title || "Defence lab", d.sub || "Switch a defence off, run an attack, and see what gets through."));
    const switches = h("fieldset", { class: "w-fieldset" }, h("legend", {}, "Defences"));
    layers.forEach(function (l) {
      const cb = checkbox(l.label, state[l.id], { onchange: function (e) { state[l.id] = e.target.checked; draw(); } });
      switches.append(h("div", {}, cb));
    });
    const attackBox = h("fieldset", { class: "w-fieldset" }, h("legend", {}, "Attack"));
    const name = uid("dl");
    attacks.forEach(function (a, i) {
      const id = uid("dla");
      const r = h("input", { type: "radio", name: name, id: id, value: a.id, onchange: function () { current = a.id; draw(); } });
      if (i === 0) r.checked = true;
      attackBox.append(h("div", {}, h("label", { class: "w-check", for: id }, r, h("span", {}, a.label))));
    });
    const stage = h("div", { class: "w-dl-stage" });
    const out = h("div", { "aria-live": "polite" });
    const matrix = h("div", {});
    host.append(h("div", { class: "w-grid2" }, switches, attackBox), stage, out,
      h("div", { class: "w-btns" }, button("Show every attack against these defences", function () { drawMatrix(); }, true)), matrix);

    function layerLabel(id) { const l = layers.find(function (x) { return x.id === id; }); return l ? l.label : id; }
    function draw() {
      const a = attacks.find(function (x) { return x.id === current; });
      const res = dlEvaluate(a, state);
      const blocked = res.rule.result === "blocked";
      clear(stage);
      stage.append(
        h("div", { class: "w-dl-actor w-dl-from" }, d.from || "Attacker"),
        h("div", { class: "w-dl-arrow", "aria-hidden": "true" }, "→"),
        h("div", { class: "w-dl-sheet" },
          h("div", { class: "w-dl-sheet-title" }, "What arrives at " + (d.to || "the server")),
          res.lines.length ? h("ul", {}, res.lines.map(function (ln) {
            return h("li", { class: ln.flag ? "w-dl-" + ln.flag : "" }, ln.text);
          })) : h("p", { class: "w-hint" }, "Nothing.")),
        h("div", { class: "w-dl-arrow", "aria-hidden": "true" }, "→"),
        h("div", { class: "w-dl-actor " + (blocked ? "w-dl-ok" : "w-dl-bad") }, (d.to || "Server") + (blocked ? ": refuses" : ": accepts")));
      clear(out);
      if (a.story) out.append(h("p", { class: "w-hint" }, a.story));
      out.append(verdict(blocked, blocked ? "Blocked by " + layerLabel(res.rule.by) : "The attack works", res.rule.why));
      if (blocked && res.rule.by) out.append(h("p", { class: "w-hint" }, "Now switch that defence off and run the same attack again: that is what it is there for."));
      if (matrix.firstChild) drawMatrix();
    }
    function drawMatrix() {
      clear(matrix);
      const t = h("table", { class: "w-table" }, h("thead", {}, h("tr", {}, h("th", {}, "Attack"), h("th", {}, "Result"), h("th", {}, "Stopped by"))));
      const tb = h("tbody", {});
      attacks.forEach(function (a) {
        const r = dlEvaluate(a, state).rule;
        tb.append(h("tr", {}, h("td", {}, a.label),
          h("td", {}, badge(r.result === "blocked" ? "pass" : "fail", r.result === "blocked" ? "blocked" : "works")),
          h("td", {}, r.result === "blocked" ? layerLabel(r.by) : "—")));
      });
      t.append(tb);
      matrix.append(t);
    }
    draw();
  }

  /* =========================================================
     Boot
     ========================================================= */
  const WIDGETS = {
    "jwt": renderJwt, "cookie-sim": renderCookieSim, "cors-sim": renderCorsSim, "oauth-stepper": renderOauthStepper,
    "iam-eval": renderIamEval, "netpol-check": renderNetpol, "rebac": renderRebac, "spot-the-bug": renderSpotTheBug,
    "terminal-replay": renderTerminalReplay, "self-test": renderSelfTest, "defense-lab": renderDefenseLab
  };
  function boot(root) {
    (root || document).querySelectorAll("[data-widget]").forEach(function (host) {
      if (host.dataset.wReady) return;
      const name = host.dataset.widget, fn = WIDGETS[name];
      host.classList.add("w-widget", "w-" + name);
      if (!fn) { host.append(errorBox("Unknown widget \"" + name + "\". Known: " + Object.keys(WIDGETS).join(", "))); return; }
      try { fn(host); host.dataset.wReady = "1"; }
      catch (e) { host.append(errorBox("Widget \"" + name + "\" failed to render: " + e.message)); console.error("widgets.js", name, e); }
    });
  }
  window.WIDGETS = { boot: boot, names: Object.keys(WIDGETS) };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { boot(); });
  else boot();
})();
