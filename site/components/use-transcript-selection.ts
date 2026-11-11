"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { clearNativeTranscriptSelection, hasNativeTranscriptSelection, readTranscriptSelection, type TranscriptSelection } from "@/src/lib/text-selection";

type Options = { enabled: boolean; resetKey: unknown };
type PointerSession = { id: number; x: number; y: number; active: boolean; dragged: boolean; startedWithSelection: boolean };
const emptyPointer = (): PointerSession => ({ id: -1, x: 0, y: 0, active: false, dragged: false, startedWithSelection: false });

function sameSelection(a: TranscriptSelection | null, b: TranscriptSelection | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.text !== b.text || a.characterCount !== b.characterCount || a.spans.length !== b.spans.length) return false;
  return a.spans.every((span, index) => span.cueId === b.spans[index].cueId && span.from === b.spans[index].from && span.to === b.spans[index].to);
}

export function useTranscriptSelection(rootRef: RefObject<HTMLElement | null>, { enabled, resetKey }: Options) {
  const [selection, setSelection] = useState<TranscriptSelection | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const mounted = useRef(true);
  const lastRoot = useRef<HTMLElement | null>(null);
  const pointer = useRef<PointerSession>(emptyPointer());
  const suppressClickUntil = useRef(0);
  const pendingFrame = useRef<{ view: Window; id: number } | null>(null);

  const cancelPendingSync = useCallback(() => {
    if (pendingFrame.current) {
      pendingFrame.current.view.cancelAnimationFrame(pendingFrame.current.id);
      pendingFrame.current = null;
    }
  }, []);

  const syncSelection = useCallback(() => {
    if (!mounted.current) return;
    const root = rootRef.current;
    const next = enabledRef.current && root ? readTranscriptSelection(root) : null;
    setSelection(previous => sameSelection(previous, next) ? previous : next);
  }, [rootRef]);

  const scheduleSync = useCallback(() => {
    if (pendingFrame.current || !mounted.current) return;
    const view = (rootRef.current ?? lastRoot.current)?.ownerDocument.defaultView;
    if (!view) return;
    const id = view.requestAnimationFrame(() => { pendingFrame.current = null; syncSelection(); });
    pendingFrame.current = { view, id };
  }, [rootRef, syncSelection]);

  const clearSelection = useCallback(() => {
    cancelPendingSync();
    pointer.current = emptyPointer();
    suppressClickUntil.current = 0;
    const root = rootRef.current ?? lastRoot.current;
    if (root) clearNativeTranscriptSelection(root);
    if (mounted.current) setSelection(null);
  }, [rootRef, cancelPendingSync]);

  const shouldIgnoreClick = useCallback(() => {
    if (!enabledRef.current) return true;
    const root = rootRef.current;
    if (root && hasNativeTranscriptSelection(root)) return true;
    return Date.now() < suppressClickUntil.current || (pointer.current.active && (pointer.current.dragged || pointer.current.startedWithSelection));
  }, [rootRef]);

  const movePointer = useCallback((event: { pointerId: number; clientX: number; clientY: number }) => {
    const current = pointer.current;
    if (!current.active || current.id !== event.pointerId) return;
    if ((event.clientX - current.x) ** 2 + (event.clientY - current.y) ** 2 >= 16) current.dragged = true;
    scheduleSync();
  }, [scheduleSync]);

  const finishPointer = useCallback((event: { pointerId: number; clientX: number; clientY: number }) => {
    const current = pointer.current;
    if (current.active && current.id === event.pointerId) {
      movePointer(event);
      current.active = false;
      if (current.dragged || current.startedWithSelection) suppressClickUntil.current = Date.now() + 350;
    }
    // Pointerup normally has the final range already; the animation frame also
    // catches browser selection updates dispatched after the native pointerup.
    syncSelection();
    scheduleSync();
  }, [movePointer, syncSelection, scheduleSync]);

  const onPointerDownCapture = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!enabledRef.current || event.button !== 0 || !event.isPrimary) return;
    const root = rootRef.current;
    if (!root) return;
    lastRoot.current = root;
    const target = event.target instanceof Element ? event.target : null;
    const control = target?.closest("input,textarea,select,button,a,[contenteditable=true]");
    const leaf = target?.closest("[data-transcript-span]");
    suppressClickUntil.current = 0;
    pointer.current = emptyPointer();
    if (control && !leaf) return;
    pointer.current = {
      id: event.pointerId, x: event.clientX, y: event.clientY, active: true, dragged: false,
      // Record selection before native mousedown collapses it. Clearing an old
      // selection by clicking a word must not also delete that word.
      startedWithSelection: hasNativeTranscriptSelection(root),
    };
  }, [rootRef]);

  const onPointerMoveCapture = useCallback((event: ReactPointerEvent<HTMLElement>) => { movePointer(event); }, [movePointer]);
  const onPointerUpCapture = useCallback((event: ReactPointerEvent<HTMLElement>) => { finishPointer(event); }, [finishPointer]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; cancelPendingSync(); };
  }, [cancelPendingSync]);

  useEffect(() => {
    const root = rootRef.current;
    if (root) lastRoot.current = root;
    clearSelection();
    if (!enabled || !root) return;
    const owner = root.ownerDocument;
    const onChange = () => scheduleSync();
    const onMove = (event: PointerEvent) => movePointer(event);
    const onUp = (event: PointerEvent) => finishPointer(event);
    const onCancel = () => {
      if (pointer.current.active) suppressClickUntil.current = Date.now() + 350;
      pointer.current.active = false;
      scheduleSync();
    };
    owner.addEventListener("selectionchange", onChange);
    owner.addEventListener("keyup", onChange);
    owner.addEventListener("pointermove", onMove, true);
    owner.addEventListener("pointerup", onUp, true);
    owner.addEventListener("pointercancel", onCancel, true);
    return () => {
      owner.removeEventListener("selectionchange", onChange);
      owner.removeEventListener("keyup", onChange);
      owner.removeEventListener("pointermove", onMove, true);
      owner.removeEventListener("pointerup", onUp, true);
      owner.removeEventListener("pointercancel", onCancel, true);
      cancelPendingSync();
    };
  }, [enabled, resetKey, rootRef, clearSelection, scheduleSync, movePointer, finishPointer, cancelPendingSync]);

  const handlers = useMemo(() => ({ onPointerDownCapture, onPointerMoveCapture, onPointerUpCapture }), [onPointerDownCapture, onPointerMoveCapture, onPointerUpCapture]);
  return { selection, clearSelection, shouldIgnoreClick, handlers };
}
