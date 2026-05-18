# QA Automation (Playwright)

This project runs UI tests with **video recordings**, **snapshots (screenshots on failure)**, **trace viewer snapshots**, and an **HTML report**.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Install browsers (one-time):

```bash
npx playwright install
```

3. Create your local env file:

- Copy `.env.example` to `.env`
- Put your real username/password in `.env`

## Run tests

```bash
npm test
```

## View report

```bash
npm run report
```

## Artifacts (after a run)

- `playwright-report/` (HTML report)
- `test-results/` (videos + traces)

