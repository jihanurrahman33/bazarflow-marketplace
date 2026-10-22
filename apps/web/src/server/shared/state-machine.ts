import { AppError } from "./errors";

export interface StateMachine<S extends string> {
  readonly states: readonly S[];
  can(from: S, to: S): boolean;
  assert(from: S, to: S): void;
  /** States from which `to` is reachable in one step — used to build compare-and-set filters. */
  predecessors(to: S): S[];
  isTerminal(state: S): boolean;
}

export function defineStateMachine<T extends Record<string, readonly string[]>>(
  transitions: T & Record<string, readonly (keyof T & string)[]>,
): StateMachine<keyof T & string> {
  type S = keyof T & string;
  const table = transitions as Record<S, readonly S[]>;
  const states = Object.keys(table) as S[];
  return {
    states,
    can: (from, to) => table[from]?.includes(to) ?? false,
    assert(from, to) {
      if (!table[from]?.includes(to)) {
        throw new AppError("INVALID_STATE_TRANSITION", { message: `Cannot move from "${from}" to "${to}".` });
      }
    },
    predecessors: (to) => states.filter((s) => table[s].includes(to)),
    isTerminal: (s) => table[s].length === 0,
  };
}
