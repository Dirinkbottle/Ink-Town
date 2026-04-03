import { useCallback } from "react";
import type { MouseEvent as ReactMouseEvent, MutableRefObject, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import type { CanvasRenderer } from "../../renderer/canvasRenderer";
import type { InteractionMode } from "../types/interaction";

interface CanvasInteractionConfig {
  rendererRef: MutableRefObject<CanvasRenderer | null>;
  worldLoadedRef: MutableRefObject<boolean>;
  paintingRef: MutableRefObject<boolean>;
  panningRef: MutableRefObject<boolean>;
  lastPaintRef: MutableRefObject<string>;
  setInteractionMode: (mode: InteractionMode) => void;
  setStatus: (status: string) => void;
  syncCameraInfo: () => void;
  ensureVisibleChunks: () => Promise<void>;
  paintAt: (clientX: number, clientY: number) => Promise<void>;
  inspectAt: (clientX: number, clientY: number) => void;
}

export function useCanvasInteraction(config: CanvasInteractionConfig) {
  const {
    rendererRef,
    worldLoadedRef,
    paintingRef,
    panningRef,
    lastPaintRef,
    setInteractionMode,
    setStatus,
    syncCameraInfo,
    ensureVisibleChunks,
    paintAt,
    inspectAt
  } = config;

  const onContextMenu = useCallback((event: ReactMouseEvent<HTMLCanvasElement>) => {
    event.preventDefault();
  }, []);

  const onWheel = useCallback(
    (event: ReactWheelEvent<HTMLCanvasElement>) => {
      event.preventDefault();
      const renderer = rendererRef.current;
      if (!renderer) {
        return;
      }
      const factor = event.deltaY < 0 ? 1.15 : 0.88;
      renderer.zoomAt(factor, event.nativeEvent.offsetX, event.nativeEvent.offsetY);
      syncCameraInfo();
      void ensureVisibleChunks();
    },
    [ensureVisibleChunks, rendererRef, syncCameraInfo]
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (event.button === 1) {
        panningRef.current = true;
        setInteractionMode("panning");
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
        return;
      }
      if (event.button === 0) {
        if (!worldLoadedRef.current) {
          setStatus("请先打开或新建地图");
          return;
        }
        paintingRef.current = true;
        setInteractionMode("painting");
        event.currentTarget.setPointerCapture(event.pointerId);
        void paintAt(event.clientX, event.clientY);
      }
    },
    [paintAt, paintingRef, panningRef, setInteractionMode, setStatus, worldLoadedRef]
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      inspectAt(event.clientX, event.clientY);
      if (panningRef.current) {
        rendererRef.current?.panByPixels(event.movementX, event.movementY);
        syncCameraInfo();
        void ensureVisibleChunks();
        return;
      }
      if (paintingRef.current) {
        void paintAt(event.clientX, event.clientY);
      }
    },
    [ensureVisibleChunks, inspectAt, paintAt, paintingRef, panningRef, rendererRef, syncCameraInfo]
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (event.button === 1) {
        panningRef.current = false;
      }
      if (event.button === 0) {
        paintingRef.current = false;
        lastPaintRef.current = "";
      }
      if (!panningRef.current && !paintingRef.current) {
        setInteractionMode("idle");
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [lastPaintRef, paintingRef, panningRef, setInteractionMode]
  );

  const onPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      paintingRef.current = false;
      panningRef.current = false;
      lastPaintRef.current = "";
      setInteractionMode("idle");
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [lastPaintRef, paintingRef, panningRef, setInteractionMode]
  );

  const onPointerLeave = useCallback(() => {
    paintingRef.current = false;
    panningRef.current = false;
    lastPaintRef.current = "";
    setInteractionMode("idle");
  }, [lastPaintRef, paintingRef, panningRef, setInteractionMode]);

  return {
    onContextMenu,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onPointerLeave
  };
}
