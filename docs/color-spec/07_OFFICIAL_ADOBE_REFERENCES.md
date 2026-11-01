# Adobe-first reading list

These references describe Adobe's actual color tools or Premiere API; external Resolve tutorials are not substitutes for Premiere implementability.

## Color and scopes
- Lumetri scopes (RGB Parade, Waveform, Vectorscope): https://helpx.adobe.com/premiere/desktop/correct-color/add-color-effects/available-lumetri-scopes.html
- Display Lumetri Scopes: https://helpx.adobe.com/premiere/desktop/correct-color/add-color-effects/display-lumetri-scopes.html
- Sequence color output space: https://helpx.adobe.com/premiere/desktop/correct-color/set-up-color-management/configure-sequence-output-color-space.html
- Color setup presets: https://helpx.adobe.com/premiere/desktop/correct-color/set-up-color-management/customize-color-setup-presets-for-new-or-existing-sequences.html

## Programmatic integration
- Premiere UXP reference: https://developer.adobe.com/premiere-pro/uxp/ppro-reference/
- Component interface: https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/component
- ComponentParam interface: https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/componentparam
- UXP recipes: https://developer.adobe.com/premiere-pro/uxp/resources/recipes/
- Historical CEP/ExtendScript scripting docs: https://ppro-scripting.docsforadobe.dev/

## Important limitation
A published API method for generic component parameters does not certify a complete stable Lumetri parameter mapping. Verify the real installed host version and actual writable parameters experimentally. Premiere's newer Color Mode beta may use a different set of color controls than legacy Lumetri; design capability detection accordingly.
