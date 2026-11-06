# Grocery

A grocery list for two, on iPhone. Sign in once, then both of you add and check off items on per-store lists (Costco, Patel, Butcher), with quick-add chips for the things you buy often.

It is a PWA (Add to Home Screen) on GitHub Pages, with a Python Lambda and DynamoDB behind it, and it runs at $0 inside the AWS free tier. The setup follows [TennisTracker](https://github.com/vinblue1977/TennisTracker): same CI, same checks.

## Develop

```sh
make install   # virtualenv, CDK CLI, PWA tools
make check     # everything CI runs: privacy, lint, tests, frontend, audit, cdk-nag synth
```

## Deploy

Merging to `main` runs CI, then deploys the stack with CDK (GitHub OIDC, no stored keys) and the PWA to GitHub Pages.

One-time setup: deploy once from a laptop (`cdk deploy`) to create the GitHub deploy role, then set the `production` environment secrets `AWS_DEPLOY_ROLE_ARN`, enable Pages (source: GitHub Actions), and add the `AUTOMERGE_TOKEN` secret for Dependabot.
