# Interactive widgets: embedding guide

`assets/widgets.js` renders every element with a `data-widget` attribute when the page loads.
The library is self-contained (no dependencies, works from `file://`, ES2019, no network calls).
The kit ships no demo page: to try a widget, paste its embed into any page wired as below.

## Wiring a module page

Add the stylesheet in `<head>` and the script before `app.js` at the bottom. Paths are relative to
`modules/`, so they start with `../`:

```html
<link rel="stylesheet" href="../assets/widgets.css">
```

```html
<script src="../assets/widgets.js"></script>
<script src="../assets/app.js"></script>
```

Rules:
- Do not put a widget inside the `.quiz` div or inside an SVG. Anywhere else in `.content` is fine.
- Each widget is a block element. Add a one-paragraph "Try it" note above it so the learner knows what to do.
- Widgets are keyboard accessible and follow dark/light mode through the existing CSS variables.
- The library never evaluates user input; JSON textareas are parsed with `JSON.parse` in a `try/catch` and show a friendly error.
- Every element that declares `data-widget` gets classes `w-widget` and `w-<name>`. Do not add other content inside the element (except the `<script type="application/json">` data block for `spot-the-bug`, `terminal-replay` and `defense-lab`).

## Widgets

### jwt: JWT decoder and validator

Good for: a module on what a token (JWT) holds, or on how an API validates the tokens it receives.

```html
<div data-widget="jwt" data-sample="valid"></div>
```

| Option | Values | Default |
|---|---|---|
| `data-sample` | `valid`, `expired`, `wrong-aud`, `alg-none`, `tampered`, `hs256-confusion` | `valid` |
| `data-iss` | expected issuer string prefilled in the input; samples are minted with this issuer | `https://idp.example.com/tenant-7f3a` |
| `data-aud` | expected audience prefilled in the input; samples are minted with this audience | `api://example-api` |

Behaviour: on load a 2048-bit RSASSA-PKCS1-v1_5 key pair is generated with WebCrypto and the six
samples are minted from it, so `valid` verifies and `tampered` fails a real signature check. The
`hs256-confusion` sample is HMAC-signed with the public key bytes as the secret, and the widget says
so. Without WebCrypto the checklist still runs and the signature row says "unavailable in this browser".
Checklist rows: alg allowlist (RS256/ES256, `none` rejected), kid, typ, iss, aud (string or array),
exp with 60 s skew, nbf, iat sanity, sub, signature.

Suggested usage: `data-sample="valid"` after a figure of a decoded token; `data-sample="alg-none"` where
the `alg` attacks are taught; `data-sample="wrong-aud" data-aud="https://mcp.example.com"
data-iss="https://login.example.com"` where an API's token validation is taught.

### cookie-sim: SameSite and cookie attribute simulator

Good for: a module on sessions and cookies, or on cross-site request forgery (CSRF).

```html
<div data-widget="cookie-sim" data-scenario="cross-post" data-samesite="Lax"></div>
```

| Option | Values | Default |
|---|---|---|
| `data-scenario` | `same-site-xhr`, `toplevel-get`, `cross-post`, `cross-img`, `iframe`, `http`, `js-read` | `cross-post` |
| `data-samesite` | `Strict`, `Lax`, `None` | `Lax` |
| `data-httponly` | `true` / `false` | `true` |
| `data-secure` | `true` / `false` | `true` |
| `data-domain` | `` (host-only) or `example.com` | `` |
| `data-host-prefix` | `true` / `false` (use the `__Host-` prefix) | `false` |

The cookie is always modelled as set by `https://app.example.com` with `Path=/`. Output: "Cookie sent"
and "Readable by script", the rules that decided it (Lax top-level GET exemption, Secure over http,
None requires Secure, `__Host-` requires Secure + no Domain + Path=/, host-only vs Domain), and the
browser's step sequence. A CSRF module can embed it twice: `data-scenario="cross-post"` where SameSite
is taught, and `data-scenario="iframe" data-samesite="None"` next to a scenario about embedded frames.

### cors-sim: CORS simulator

Good for: a module on cross-origin resource sharing (CORS).

```html
<div data-widget="cors-sim" data-preset="json-post-auth"></div>
```

| Option | Values | Default |
|---|---|---|
| `data-preset` | `simple-get`, `json-post-auth`, `reflected-origin` | `simple-get` |
| `data-server` | API origin used as the server side | `https://api.example.com` |

Inputs: page origin, method, custom headers (comma list, `Name` or `Name: value`), credentials;
server `Access-Control-Allow-Origin` (a value, `*`, or the word `reflect` to model an
echo-the-Origin middleware), `Allow-Credentials`, `Allow-Methods`, `Allow-Headers`. Output: preflight
needed, preflight passes, request reaches the server, response readable, and the exact reason
("* cannot be used with credentials", "header authorization not in Access-Control-Allow-Headers",
"origin mismatch", "method DELETE not in Access-Control-Allow-Methods").

### oauth-stepper: step-through sequence diagrams

Good for: a module on OAuth flows, or on how an MCP client finds where to sign in (`mcp-discovery`).

```html
<div data-widget="oauth-stepper" data-flow="auth-code-pkce"></div>
```

| `data-flow` | Steps | Standards | Shows |
|---|---|---|---|
| `auth-code-pkce` | 9 | RFC 6749 §4.1, 7636, 8707, 6750 | a user signs in to an app through the browser |
| `client-credentials` | 7 | RFC 6749 §4.4, 7523 | a service calls an API with no user involved |
| `device-code` | 9 | RFC 8628 | a user signs in on a device without a browser, such as a CLI |
| `token-exchange-obo` | 8 | RFC 8693, 8707 | a service calls another API on a user's behalf |
| `mcp-discovery` | 11 | MCP authorization spec, RFC 9728, 8414, 7591, 7636, 8707 | an MCP client finds the server's sign-in service and signs in |

Participants are columns with lifelines; Next/Back/Reset/Show all buttons; left/right arrow keys
work when the diagram has focus. Each step shows the message, the actual parameters
(`code_challenge=…`, `resource=https://mcp.example.com/mcp`,
`WWW-Authenticate: Bearer resource_metadata="…"`) and one sentence on why the step exists and what
attack it prevents.

### iam-eval: toy AWS IAM evaluator

Good for: a module on how AWS IAM evaluates policies.

```html
<div data-widget="iam-eval" data-preset="s3-read-ok"></div>
```

| `data-preset` | Expected decision |
|---|---|
| `s3-read-ok` | ALLOW via identity policy |
| `explicit-deny` | DENY, explicit deny in the identity policy beats `s3:*` |
| `scp-blocks` | DENY, explicit deny in the SCP |
| `cross-account-missing-resource-policy` | DENY, identity allows but no bucket policy names the principal |
| `cross-account-ok` | ALLOW, bucket policy names the role with `aws:PrincipalOrgID`, boundary allows |
| `assume-role-externalid` | DENY until the `sts:ExternalId` input is set to `cust-7f3a9c-d41e` |

Textareas: identity policy, resource policy, SCP, permission boundary (empty = absent). Inputs:
principal ARN, action, resource ARN, same-account checkbox, `aws:PrincipalOrgID`, `sts:ExternalId`.
Implements: explicit deny anywhere wins; SCP must allow; same-account resource policy naming the
principal allows on its own; boundary must allow if present; identity policy must allow; cross-account
needs identity AND resource policy. Wildcards `*` and `?` in Action/Resource, `NotAction`/`NotResource`,
Principal as ARN / account id / account root / `*`. Condition support is limited to `StringEquals` on
`aws:PrincipalOrgID` and `sts:ExternalId`; other operators or keys skip the statement with a note.
The limits are printed under the widget.

### netpol-check: Kubernetes NetworkPolicy checker

Good for: a module on Kubernetes NetworkPolicy, and its lab.

```html
<div data-widget="netpol-check" data-preset="default-deny"></div>
```

| `data-preset` | Policies | Query result (web-agent → 10.20.5.10:443) |
|---|---|---|
| `default-deny` | default-deny-all | DENIED, DNS blocked |
| `allow-dns-only` | + allow-dns | DENIED, DNS ok |
| `allow-llm-endpoint` | + allow-egress-llm-only + allow-from-ingress | ALLOWED, DNS ok |
| `llm-without-dns` | default-deny-all + allow-egress-llm-only | ALLOWED by IP, but DNS blocked (the gotcha) |

Cluster model and policies are editable JSON using the same keys as NetworkPolicy YAML
(`podSelector`, `policyTypes`, `ingress`/`egress`, `from`/`to`, `namespaceSelector`, `ipBlock`,
`ports`). Query: from pod, to pod or IPv4, port, protocol; five quick-query buttons cover the common
cases. Semantics: a pod not selected by any policy in a direction is open; once selected, only
matching rules allow; both egress (source) and ingress (destination) must pass; DNS to
`k8s-app=kube-dns` on UDP/53 is checked separately whenever the source is egress-isolated.

### rebac: Zanzibar-style relationship checker

Good for: a module on relationship-based access control (ReBAC), and its lab.

```html
<div data-widget="rebac"></div>
```

No options. The model textarea is prefilled with an OpenFGA model (user, group,
folder with owner/editor/viewer, document with parent and `viewer from parent`); the tuples
textarea with `folder:q3#owner@user:alice`, `folder:q3#viewer@group:eng#member`,
`group:eng#member@user:carol`, `document:plan#parent@folder:q3`, `document:plan#viewer@user:bob`,
`document:memo#owner@user:bob`. Supports direct types (including usersets like `group#member`),
`or` unions and `X from Y` (tupleToUserset). `and` / `but not` are rejected with a message. Tuples
may also be pasted as a JSON array of `{user, relation, object}`.
The check form prints the derivation path; list-objects prints every object of a type the user can reach.

### spot-the-bug: single-answer code question

Good for: any module. Same look as the quiz engine's `.q` block.

```html
<div data-widget="spot-the-bug">
  <script type="application/json">
  {
    "language": "Python / FastAPI",
    "prompt": "Which line is the bug?",
    "snippet": "claims = jwt.decode(token, key.key, algorithms=[\"RS256\"], issuer=ISSUER)",
    "options": [
      { "text": "algorithms is too strict", "correct": false, "why": "Pinning algorithms is the defense." },
      { "text": "No audience is checked", "correct": true, "why": "Add audience=... and require aud." }
    ],
    "explanation": "Only the audience check answers: was this token minted for me?"
  }
  </script>
</div>
```

Fields: `snippet` (required, plain text; use `\n` for newlines and escape `"` as `\"`), `language`
(shown as the domain pill), `prompt` (optional), `options` (2+; exactly one should be `correct`),
`explanation` (shown after Commit). Because it is JSON inside HTML, do not use `</script>` inside the
snippet.

### terminal-replay: click-through terminal session

Good for: the command-line part of a hands-on lab, in any module.

```html
<div data-widget="terminal-replay">
  <script type="application/json">
  {
    "title": "MCP authorization discovery chain (curl)",
    "steps": [
      { "cmd": "curl -si -X POST https://mcp.example.com/mcp -d '{...}'",
        "out": "HTTP/2 401\nwww-authenticate: Bearer resource_metadata=\"https://mcp.example.com/.well-known/oauth-protected-resource/mcp\"",
        "note": "The 401 carries no body; the resource_metadata URL is the only pointer." },
      { "cmd": "curl -s https://mcp.example.com/.well-known/oauth-protected-resource/mcp | jq .",
        "out": "{ \"resource\": \"https://mcp.example.com/mcp\", \"authorization_servers\": [\"https://login.example.com\"] }",
        "note": "Protected Resource Metadata (RFC 9728)." }
    ]
  }
  </script>
</div>
```

Fields: `title`, `steps[]` with `cmd` (required), `out` (optional, may contain `\n`), `note`
(optional, shown under the terminal), `prompt` (optional, default `$`). Buttons: Next, Back, Play all
(900 ms per step, toggles to Pause), Reset. Keyboard: right arrow = next, left arrow = back when the
terminal has focus.

### defense-lab: switch a defence off and run the attack

Good for: a security module that teaches layered defences, next to its attack-to-defence table: one switch
per independent defence, one attack per hole. `authoring/TEMPLATE.html` embeds one, marked for security topics only.

```html
<div data-widget="defense-lab" data-depth="core">
  <script type="application/json">
  {
    "title": "Attack the example API",
    "sub": "Each defence stops one attack. Switch it off and see what gets through.",
    "from": "Vex",
    "to": "The API",
    "layers": [ { "id": "aud", "label": "Audience check (2)", "on": true } ],
    "attacks": [
      { "id": "wrongaud", "label": "Send a token minted for another API",
        "story": "Vex holds a genuine token for a different API.",
        "artifact": [ { "text": "aud: api://other-api", "when": {} } ],
        "rules": [
          { "when": { "aud": true }, "result": "blocked", "by": "aud", "why": "The token was not meant for this API, so it answers 401." },
          { "when": {}, "result": "success", "why": "Any valid token is accepted, whatever it was meant for." }
        ] }
    ]
  }
  </script>
</div>
```

| Field | Rule |
|---|---|
| `title`, `sub` | heading and one-line instruction; defaults "Defence lab" and "Switch a defence off, run an attack, and see what gets through." |
| `from`, `to` | the two ends of the picture; defaults "Attacker" and "Server" |
| `layers[]` | `{ id, label, on }`: one checkbox per defence; `"on": false` starts it switched off |
| `attacks[]` | `{ id, label, story, artifact, rules }`: one radio button per attack; `story` (optional) is shown above the verdict |
| `artifact[]` | `{ text, when, flag }`: the lines listed under "What arrives at" `to`, each shown only while its `when` matches; `flag` `ok` or `bad` colours the line |
| `rules[]` | `{ when, result, by, why }`: the first rule whose `when` matches decides; `result` is `blocked` (by the layer `by`) or `success`; `why` is the verdict text |

`when` maps layer ids to `true` or `false`; every layer it names must be in that state, and `{}` always
matches. When no rule matches, the attack works ("No rule matched; treat as undefended."), so end every
attack's rules with a catch-all `{ "when": {}, "result": "success" }`. Behaviour: the picture shows `from`,
what arrives and whether `to` refuses or accepts; a blocked attack names the defence that stopped it and
invites the learner to switch that defence off and run it again. "Show every attack against these
defences" draws a table of every attack under the current switches. `WIDGET_LOGIC.dlEvaluate(attack,
switches)` returns the deciding rule and the visible artifact lines.

### self-test: run the built-in assertions

Not for modules. Put it on a scratch page (inside a `<details>`, say); it runs 100 assertions against
`window.WIDGET_LOGIC` and prints PASS/FAIL lines. They cover every widget's logic except `defense-lab`,
whose rules are page data.

```html
<div data-widget="self-test"></div>
```

## Public JavaScript surface

`window.WIDGET_LOGIC` exposes the pure functions for tests and for future widgets:
`decodeJwt`, `checkJwtClaims`, `mintJwtSamples`, `cookieSim`, `corsSim`, `OAUTH_FLOWS`, `iamEval`,
`parsePolicy`, `wildcardMatch`, `IAM_PRESETS`, `netpolCheck`, `cidrContains`, `selectorMatches`,
`NETPOL_CLUSTER`, `NETPOL_PRESETS`, `parseFgaDsl`, `parseTuples`, `rebacCheck`, `rebacListObjects`,
`dlEvaluate`, `runSelfTests`, `b64urlEncode`, `b64urlDecode`, `safeJson`.
`window.WIDGETS.boot(rootElement)` renders widgets added to the DOM after load.
