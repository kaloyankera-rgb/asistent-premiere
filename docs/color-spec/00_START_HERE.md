# Premiere Color Correction Engine — START HERE

This folder is an implementation reference pack for the EXISTING Premiere Pro extension. It is NOT a Claude Skill or a standalone application.

## Instructions to Claude
1. Read `01_PREMIERE_API_COMPATIBILITY.md` first. Detect the real extension stack and Premiere version. Do not invent Lumetri APIs.
2. Follow `02_COLOR_CORRECTION_SPEC.md` for the seven modules and protections.
3. Implement the decision and validation flow described in `03_ANALYSIS_AND_QA.md`.
4. Treat `04_REFERENCE_CASES.json` as scenario specifications, not real measured footage.
5. Use `05_TEST_MATRIX.csv` for regression tests; test on actual Premiere rendered outputs.
6. Use `06_REFERENCE_TEMPLATE.json` to document reference footage from the user's own clips.
7. Report supported vs blocked Adobe interfaces, test results, and remaining limitations.

## Critical rules
- No automatic operation should modify already-correct material.
- Preserve existing manual grades; no destructive edits.
- Isolate each operation; protect other parameters.
- Check actual rendered results, not just requested effect values.
- If information is insufficient or improvement is uncertain, SKIP and flag for review.
- Do not claim training or validation happened merely by reading these files.

## Source docs (verified November 2026)
- https://developer.adobe.com/premiere-pro/uxp/ppro-reference/
- https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/component
- https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/componentparam
- https://developer.adobe.com/premiere-pro/uxp/resources/fundamentals/apis/
- https://helpx.adobe.com/premiere/desktop/correct-color/add-color-effects/available-lumetri-scopes.html
- https://helpx.adobe.com/premiere/desktop/correct-color/set-up-color-management/configure-sequence-output-color-space.html
