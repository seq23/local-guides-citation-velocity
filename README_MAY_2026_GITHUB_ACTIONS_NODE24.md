# May 2026 — GitHub Actions Node 24 Upgrade README

## Why this file exists
GitHub is deprecating Node 20 for JavaScript-based GitHub Actions. GitHub's changelog says runners will begin using Node 24 by default on **June 2, 2026**. The official GitHub actions already have Node 24 compatible major versions available:
- `actions/checkout@v5`
- `actions/setup-node@v5`
- `actions/github-script@v8`

This repo does **not** need that upgrade right now to fix the March 17, 2026 release failure. That failure was a content/validator issue, not an Actions runtime issue.

This file exists so future-you can come back in **May 2026** and do one clean, low-drama maintenance pass.

---

## Exact files to edit in May 2026
Update these workflow files:
- `.github/workflows/daily_release.yml`
- `.github/workflows/medium_articles_gate.yml`
- `.github/workflows/release_batch.yml`

---

## Exact version changes to make

### 1) In all three workflows
Change:
```yaml
uses: actions/checkout@v4
```
To:
```yaml
uses: actions/checkout@v5
```

### 2) In all three workflows
Change:
```yaml
uses: actions/setup-node@v4
```
To:
```yaml
uses: actions/setup-node@v5
```

### 3) In `medium_articles_gate.yml`
Change:
```yaml
uses: actions/github-script@v7
```
To:
```yaml
uses: actions/github-script@v8
```

---

## Optional early compatibility test
If you want to test the Node 24 runtime **before** switching versions, add this temporarily at the workflow level:

```yaml
env:
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true
```

Use that only for testing. Remove it after the test if you are not doing the full workflow-version upgrade in the same pass.

---

## Recommended May 2026 sequence

### Path A — clean production upgrade (recommended)
1. Update the workflow versions exactly as listed above.
2. Commit the workflow changes.
3. Run these workflows manually from GitHub:
   - `Release Batch`
   - `Daily Release`
4. Confirm both complete successfully.
5. Push and leave it alone.

### Path B — dry run first
1. Add `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true`.
2. Run a manual workflow test.
3. If the workflow is clean, proceed with the version upgrades in Path A.
4. Remove the temporary force flag if you are no longer using it.

---

## Manual GitHub UI clicks (super clear)

### To edit the workflow in GitHub web UI
1. Open the repo on GitHub.
2. Click **.github**.
3. Click **workflows**.
4. Open one workflow file.
5. Click the pencil icon (**Edit this file**).
6. Make the version change.
7. Scroll down to **Commit changes**.
8. Commit directly to `main`.
9. Repeat for the remaining workflow files.

### To run a manual workflow test
1. In GitHub, click **Actions**.
2. Click **Release Batch**.
3. Click **Run workflow**.
4. Use the default branch (`main`).
5. Enter `1` for batch size if you want the smallest possible test.
6. Click **Run workflow**.
7. After that passes, click **Daily Release**.
8. Click **Run workflow**.
9. Wait for it to finish.

---

## What success looks like
You are done if all of the following are true:
- No warning about Node 20 deprecation on the new run.
- `Checkout` step passes.
- `Setup Node` step passes.
- `Collect changed medium-articles index.html files via GitHub API` passes.
- `Build` passes.
- `Validate` passes.
- Workflow reaches commit/push or "No changes to commit" without runtime errors.

---

## What can break

### 1) `actions/github-script@v8` behavior changes
This action runs on Node 24. If GitHub changes runtime behavior, the changed-files step in `medium_articles_gate.yml` is the most likely place to complain first.

### 2) Setup-node v5 caching behavior
The `setup-node` v5 release notes mention caching changes. This repo does not currently rely on built-in package-manager caching in the workflow, so risk here should be low.

### 3) Repo scripts under Node 24
Your repo scripts are plain Node scripts. They should be checked after the workflow-action upgrade by running manual workflows and confirming these still pass:
- `node scripts/daily_release.js`
- `node scripts/build_site.js`
- `node scripts/validate_site.js`
- `node scripts/validate_medium_articles.js` (when applicable)

---

## Fast rollback if May test goes bad
If the upgraded workflow fails and you need a fast rollback:
1. Re-open the changed workflow file(s).
2. Change versions back:
   - `actions/checkout@v5` → `actions/checkout@v4`
   - `actions/setup-node@v5` → `actions/setup-node@v4`
   - `actions/github-script@v8` → `actions/github-script@v7`
3. Commit directly to `main`.
4. Re-run the workflow.

This rollback is only temporary. You will still need the Node 24 upgrade before GitHub fully removes Node 20 support.

---

## Owner checklist for May 2026
- [ ] Update checkout to v5 in all workflows
- [ ] Update setup-node to v5 in all workflows
- [ ] Update github-script to v8 in `medium_articles_gate.yml`
- [ ] Run `Release Batch` manually
- [ ] Run `Daily Release` manually
- [ ] Confirm validators still pass
- [ ] Confirm no Node 20 deprecation warning remains

---

## VA handoff version
"Open `README_MAY_2026_GITHUB_ACTIONS_NODE24.md` in the repo. Make the three workflow version changes exactly as written. Run one manual `Release Batch` test and one manual `Daily Release` test. If both pass, stop. If either fails, roll the versions back exactly as listed in the rollback section and report the error log."
