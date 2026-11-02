# Contributing

Pull requests that make the kit better for everyone are welcome: a clearer rule, a skill fix, a script that works on
more machines, a test.

**Changes that only suit you are not merged.** Your name, your tools, your preferences, your employer's or client's
rules belong in your own fork ([FORKING.md](FORKING.md)), not in the shared kit. When you are unsure, open an issue
first and ask.

## How to open a pull request

1. **Fork the kit** on GitHub (the **Fork** button).
2. **Clone your fork into a separate folder,** not into `~/.ai-instructions`, so your working setup keeps pulling
   updates while you work:
   ```powershell
   git clone https://github.com/<your-account>/agent-kit.git "$env:USERPROFILE\agent-kit-dev"
   cd "$env:USERPROFILE\agent-kit-dev"
   git switch -c <short-branch-name>
   ```
3. **Make one change,** and test what you touched:
   - the `autonomous` package: `cd autonomous`, `npm ci`, `npm test`, `npm run lint`;
   - the Stop hook: `node hooks/test-stop-hook.mjs`;
   - a PowerShell script: run it under Windows PowerShell 5.1, in a test home so it cannot touch your own setup.
     The scripts and the hook installer write under `AIKIT_HOME` instead of your user folder, and register no
     background task:
     ```powershell
     $env:AIKIT_HOME = "$env:TEMP\aikit-test-home"
     powershell -NoProfile -ExecutionPolicy Bypass -File .\sync.ps1
     ```
   - a skill's tools: the checks its `SKILL.md` names.
4. **Push the branch to your fork** (`git push -u origin <short-branch-name>`) and open a pull request on GitHub.
   Say what problem it solves and how you tested it. Use made-up names in examples; no personal data or
   credentials.

## What happens next

The kit is developed in a separate working repository, and this repository receives one release commit about once a
week. So a pull request is never merged here directly:

1. If it is accepted, its changes are applied in the working repository, with you as co-author.
2. The next weekly release brings them here, and its commit lists you as a co-author, so GitHub credits you.
3. Your pull request is closed with a link to that release.

A pull request closed without that link was not taken; the closing comment says why.

By contributing you agree that your contribution is licensed under the MIT license in [LICENSE](LICENSE).
