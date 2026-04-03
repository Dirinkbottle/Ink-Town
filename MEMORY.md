# Ink Town Memory

## Current Direction

- Focus this phase on editor layout/UI/UX optimization.
- Execute in 10 iterative rounds with meaningful delivery each round.
- Keep each round around ~400 LOC of effective change when possible.
- End every round with build/test verification and a git commit.

## Engineering Constraints

- Modularization is mandatory.
- Avoid oversized single files; split by concern.
- Preferred structure:
  - `src/editor/components/`
  - `src/editor/hooks/`
  - `src/editor/utils/`
  - `src/editor/types/`
- Keep rendering loop, input orchestration, and sidebar forms loosely coupled.

## Language Policy

- Product/App naming remains English (`Ink Town Editor`).
- Property/material canonical names remain unchanged (no forced translation).
- Operational UI copy can use Chinese for usability.

## Platform Priority

- Primary runtime target: Windows desktop editor.
