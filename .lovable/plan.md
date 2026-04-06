

## Fix: JSX Parse Error in ErpEnrichmentTab.tsx

The build is failing because lines 149-154 return two adjacent JSX elements (`<code>` and `<Button>`) from a ternary branch without a wrapping parent element. JSX requires a single root element.

### The Fix

Wrap lines 150-153 in a React Fragment (`<>...</>`):

```tsx
// Line 149-154: change from
) : (
  <code ...>{endpointHost}</code>
  <Button ...>...</Button>
)}

// to
) : (
  <>
    <code ...>{endpointHost}</code>
    <Button ...>...</Button>
  </>
)}
```

This is a one-line structural fix — no logic changes. The docs created in the previous message (`ONBOARDING.md`, `KNOWN_QUIRKS.md`) are fine and unrelated to this error.

