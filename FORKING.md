# Use your own fork

A fork lets you change the rules and skills and still get updates, because your copy then pulls from your fork
instead of from the shared kit. You publish your changes to the fork; every computer you use pulls them from there.

A GitHub fork is public, so anyone can read your rules. To keep them private, make a private copy instead (step 1b).

## 1. Make the fork

**1a. A public fork:** on the kit's GitHub page, click **Fork**.

**1b. Or a private copy:** on github.com, create an empty private repository (for example `my-agent-kit`, with no
README or license), then push the kit into it:

```powershell
git -C "$env:USERPROFILE\.ai-instructions" push https://github.com/<your-account>/my-agent-kit.git main
```

## 2. Point your copy at it

```powershell
cd "$env:USERPROFILE\.ai-instructions"
git remote rename origin upstream
git remote add origin https://github.com/<your-account>/<your-fork>.git
git fetch origin
git branch --set-upstream-to=origin/main main
```

`origin` is now your fork: pulls and publishes go there. `upstream` is the shared kit, which you take updates from
(step 5). Because `origin` is no longer the shared kit, edits here no longer pause updates.

If you already edited files here and updates were paused, keep the edits: step 3 publishes them.

## 3. Change a rule or a skill

Edit `GLOBAL_INSTRUCTIONS.md` or a skill under `skills/`, then publish:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.ai-instructions\sync.ps1" -Mode Publish -Message "Add the rule about tests"
```

Publish first checks, with a trial push that sends nothing, that `origin` accepts your pushes; if not, it stops
before committing. It then commits the rules file and `skills/`, takes in your other computers' changes, applies the
result to every tool, and pushes. It refuses to run while other tracked files have uncommitted edits, so commit
those first. Edit skills here, never in the tools' skills folders: sync overwrites those copies.

## 4. Optional: push every commit

To push each commit to your fork as soon as you make it, run this (add the same `-At` you gave setup, if any):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.ai-instructions\install-autosync.ps1" -TimeZone Local -PushCommits
```

A refused push keeps the commit and notes the error in `autosync.log`; it never force-pushes.

## 5. Take the kit's updates

The shared kit keeps releasing weekly. To bring a release into your fork:

```powershell
cd "$env:USERPROFILE\.ai-instructions"
git fetch upstream
git merge --no-edit upstream/main
git push
powershell -NoProfile -ExecutionPolicy Bypass -File .\sync.ps1
```

When git reports a conflict in a file you changed, keep the parts you want, then `git add <file>` and `git commit`
before `git push`.

## 6. Your other computers

On each one, clone your fork instead of the shared kit, and run setup:

```powershell
git clone https://github.com/<your-account>/<your-fork>.git "$env:USERPROFILE\.ai-instructions"
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.ai-instructions\setup.ps1"
```

The background sync runs without a prompt, so for a private copy, Windows Git must reach it without asking for a
password; `git -C "$env:USERPROFILE\.ai-instructions" fetch` checks that.

## Go back to the shared kit

```powershell
cd "$env:USERPROFILE\.ai-instructions"
git remote set-url origin https://github.com/mdmotaharmahtab/agent-kit.git
git fetch origin
git reset --hard origin/main
git config --unset core.hooksPath
powershell -NoProfile -ExecutionPolicy Bypass -File .\setup.ps1
```

`reset --hard` throws away your changes in this folder; they stay in your fork. Unsetting `core.hooksPath` turns
off the push after each commit (step 4), if you turned it on; when it was not set, the line does nothing. With
`origin` the shared kit again, edits pause updates again.
