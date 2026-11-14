import type { EditorState } from "./editor";

/** Undo/Redo stack for the cut editor. Only the latest entries are kept. */
export interface EditorHistory {
  past: EditorState[];
  present: EditorState;
  future: EditorState[];
}

export const HISTORY_LIMIT = 80;

export function resetHistory(present: EditorState): EditorHistory {
  return { past: [], present, future: [] };
}

/** Applies an edit. An action that returns the same state leaves the history untouched; errors propagate. */
export function pushHistory(history: EditorHistory, action: (state: EditorState) => EditorState): EditorHistory {
  const next = action(history.present);
  if (next === history.present) return history;
  return { past: [...history.past, history.present].slice(-HISTORY_LIMIT), present: next, future: [] };
}

export function undoHistory(history: EditorHistory): EditorHistory {
  if (!history.past.length) return history;
  return { past: history.past.slice(0, -1), present: history.past[history.past.length - 1], future: [history.present, ...history.future] };
}

export function redoHistory(history: EditorHistory): EditorHistory {
  if (!history.future.length) return history;
  return { past: [...history.past, history.present], present: history.future[0], future: history.future.slice(1) };
}
