# Working in this repo

## Pull requests

- Before starting new work, run `gh pr list`. If a PR of ours is open (Dependabot PRs merge themselves, see below), get it merged first (fix conflicts or failing checks, `gh pr update-branch <n>`, wait for the merge), then `git pull` main.
- Don't open a second PR while one of ours is open, unless it's docs-only. If two are open, run `gh pr update-branch` on the other as soon as one merges, without waiting to be told.
- `git pull` main before branching. Use a conventional title (`feat:`, `fix:`, `ci:`, `docs:`).
- Run `make check` before pushing.
- After `gh pr create`, run `gh pr merge --auto --squash` yourself. Merges made with `GITHUB_TOKEN` don't start the
  push run, so the deploy would be skipped.
- Dependabot PRs merge themselves (`dependabot-automerge.yml`, using the `AUTOMERGE_TOKEN` PAT) and the workflow
  comments `@dependabot rebase` on the ones still open. Never `gh pr update-branch` a Dependabot PR: Dependabot then
  refuses to rebase it (fix: comment `@dependabot recreate`). If the token expires, merges stop; renew the secret.
- When an earlier PR merges, run `gh pr update-branch <n>` on your own PRs still open (branch protection needs them up to date).
- After a PR merges, delete its branches: `git fetch --prune`, then `git branch -D` every local branch marked `gone` (and any remote branch of a merged PR that GitHub left behind). Never delete a branch with an open PR.
- If a PR ever merges without a push run on main, deploy with `gh workflow run ci.yml --ref main`.

## Code review

- Run `/code-review` on every PR's diff before merging, and fix what it finds. Skip it only for docs-only PRs (`docs/` or top-level Markdown).

## Cost: $0 (one exception)

- Everything must stay inside the AWS always-free tier. No API Gateway, no on-demand DynamoDB, no PITR, KMS keys, NAT, VPC, Secrets Manager, S3 or CloudFront. The PWA is hosted on GitHub Pages.
- DynamoDB stays provisioned at or under 25 RCU/WCU (`tests/test_infra.py` guards this). Log retention stays at one week.
- Before adding any AWS resource, check that it is free at this scale; the AWS account's existing budget alert (from TennisTracker) emails if anything leaks.

## Design

- Theme (light/dark/auto) is per device, never shared: Victor defaults to dark, Yara to light.
- UI mockup: https://claude.ai/artifact/ST8279Hhn7dVZo14PNRUaB (get it approved again before big UI changes).

## Paper-list scan (the one paid feature)

- `POST /scan` sends a photo to Claude Haiku 4.5 on Amazon Bedrock (`BEDROCK_MODEL_ID`, default `us.anthropic.claude-haiku-4-5-20251001-v1:0`, switch with `-c bedrockModel=...`). It costs fractions of a cent per photo, billed to the AWS account and covered by its budget alert. Nothing else may be paid.
- Guard rails that must stay: 20 scans per household per day (`scan.MAX_SCANS_PER_DAY`), 1.5 MB image cap, the Lambda role may call only that one model (`tests/test_infra.py` checks), and the result is only a suggestion: the app shows a review sheet and adds nothing until the person taps Add.
- Photos are never stored; the model's reply is treated as untrusted text (cleaned and length-capped in `scan.parse_items`).

## Commands

- `make install`: Python 3.14 venv (uv if installed, else pip) plus `npm ci` for the CDK CLI and the frontend.
- `make check`: everything CI runs: `privacy`, `lint`, `test`, `frontend`, `audit`, then `synth`.
- `make lint` (ruff, ruff format, pyright), `make test` (pytest), `make frontend` (ESLint, tsc, Vitest, Vite build, size limit), `make synth` (CDK synth with cdk-nag), `make privacy` (no emails, account IDs or denylisted names in tracked files).
- One Python test: `.venv/bin/python -m pytest tests/test_lists.py -k name --no-cov`.
- One frontend test: `cd frontend && npx vitest run src/Lists.test.tsx`.
- Frontend dev server: `cd frontend && npm run dev`.

## Where things live

- `backend/api/`: Lambda code. `handler.py` routes, `households.py`, `lists.py`, `scan.py` (the Bedrock photo scan).
- `infra/`: the CDK stack (`stack.py`).
- `frontend/src/`: the PWA. `Lists.tsx` (main screen), `useLists.ts` (state hook), `listState.ts` (pure list logic), `api.ts` (backend calls), `Settings.tsx`, `ScanSheet.tsx`, `style.css`.
- `tests/`: pytest; `test_infra.py` guards the free-tier rules. Frontend tests sit beside the code in `frontend/src/*.test.ts(x)`.
- `scripts/`: `check_personal_data.sh` (make privacy) and `check_size.sh` (bundle size limit).
- `.github/workflows/`: `ci.yml`, `pr-title.yml`, `dependabot-automerge.yml`.
- `ROADMAP.md`: project ideas.
- `.claude/`: `settings.json` (command allowlist and hooks), `hooks.py` (runs `make check` before a push), `commands/pr.md` (the `/pr` command).

## Gotchas

- DynamoDB reserved words (`name`, `hidden`, `count`, ...) must be aliased with `ExpressionAttributeNames`.
- Python 3.14 is required; `make install` creates the venv with it.
