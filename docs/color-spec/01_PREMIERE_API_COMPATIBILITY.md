# Adobe Premiere integration — capability gates

## Actual, documented interfaces
Adobe Premiere UXP provides project/sequence access and a Component model. `Component.getParamCount()` and `Component.getParam(index)` provide access to component parameters; `ComponentParam.getValueAtTime()` and `createSetValueAction(...)` are documented. See links below. This is NOT evidence that every Lumetri control is writable, mapped to a stable parameter index, or exposed on every Premiere version.

- Component: https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/component
- ComponentParam: https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/componentparam
- API overview: https://developer.adobe.com/premiere-pro/uxp/ppro-reference/
- UXP architecture: https://developer.adobe.com/premiere-pro/uxp/resources/fundamentals/apis/
- Official recipes: https://developer.adobe.com/premiere-pro/uxp/resources/recipes/
- Legacy ExtendScript guide (only if project uses CEP): https://ppro-scripting.docsforadobe.dev/

## Required capability probe — BEFORE building control code
1. Detect whether the existing extension uses UXP, CEP/ExtendScript, native SDK, or hybrid.
2. Detect installed Premiere and extension API versions, platform, active sequence, and current color management.
3. On a **duplicate test project**, inspect a clip with Lumetri and enumerate components and parameter names/types/values using documented APIs.
4. Test reading and writing a *single reversible parameter* and inspect the resulting frame in Premiere.
5. Document actual parameter mapping, keyframe state, numerical ranges, value units, and version behavior. Do NOT hardcode indexes based on guesses or UI screenshots.
6. Test transaction/undo semantics and rollback of each change.
7. If a required control is inaccessible, mark operation **BLOCKED**, then investigate supported alternatives (existing extension bridge, supported native APIs, approved effect/preset approach). Never silently substitute UI clicking or destructive media re-encoding.

## Video color-management prerequisites
- Determine footage color space/transfer function from metadata or user-confirmed project setting; do not infer Sony S-Log3 solely from camera manufacturer.
- Verify technical transforms, working space, output space, and whether an input LUT or automatic transform is already active.
- The output frames used for evaluation MUST reflect Premiere's actual timeline effects and output transform; raw source frames alone are insufficient.
- SDR Rec.709 analysis and HDR analysis are different pipelines. Do not use 8-bit SDR assumptions for HLG/PQ.
- Preserve alpha/channel order, transfer characteristics, levels (video/full), and bit depth where possible.

## Native controls, not invented API names
| Module | Typical Premiere controls or methods | Verification requirement |
|---|---|---|
| White Balance | Lumetri Basic Correction Temperature, Tint | Discover writable parameters, ranges, signs |
| Exposure | Exposure, Highlights, Shadows, Whites, Blacks | Verify independent writes and effect order |
| Contrast | Contrast, Curves or tonal adjustments | Verify no harmful exposure change |
| Saturation | Saturation / targeted secondary as supported | Verify skin and output gamut |
| Skin Tones | HSL Secondary / supported masks or separate processing | Do not promise reliable local masks without actual API capability |
| Shot Match | Per-shot corrections/reference analysis | Verify selected clips, no shared destructive effects |
| Auto Color | Orchestrate only necessary verified modules | Apply atomic/rollback plan |

Source Adobe color management: https://helpx.adobe.com/premiere/desktop/correct-color/set-up-color-management/configure-sequence-output-color-space.html
Source Adobe scopes: https://helpx.adobe.com/premiere/desktop/correct-color/add-color-effects/available-lumetri-scopes.html

## Deliverable from capability probe
Produce a table per module: SUPPORTED / PARTIAL / BLOCKED, relevant API symbols, tested Premiere version, writable parameters, sample read-write output, undo/rollback result, risks, fallback. Only implement the supported subset until tested.
