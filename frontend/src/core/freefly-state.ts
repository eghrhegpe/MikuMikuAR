// [doc:adr-102] Freefly camera input state — leaf module.
//
// `freeflyInput` is shared by two sides that would otherwise form a cycle:
//   - camera.ts        : consumes it in the freefly render observer (reads/writes)
//   - future events.ts : writes it from keyboard handlers
// Defining it here (zero imports) lets both import from one place, breaking the
// camera↔events cycle that previously surfaced as TS "Property does not exist".
export const freeflyInput = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    up: false,
    down: false,
};
