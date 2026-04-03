import { useEffect } from "react";

interface EditorShortcutHandlers {
  onSave: () => void;
  onOpen: () => void;
  onNew: () => void;
  onToggleGrid: () => void;
  onIncreaseBrushSize: () => void;
  onDecreaseBrushSize: () => void;
}

function isTypingElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

export function useEditorShortcuts(handlers: EditorShortcutHandlers) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingElement(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();
      const hasPrimary = event.ctrlKey || event.metaKey;

      if (hasPrimary && key === "s") {
        event.preventDefault();
        handlers.onSave();
        return;
      }

      if (hasPrimary && key === "o") {
        event.preventDefault();
        handlers.onOpen();
        return;
      }

      if (hasPrimary && key === "n") {
        event.preventDefault();
        handlers.onNew();
        return;
      }

      if (key === "g") {
        event.preventDefault();
        handlers.onToggleGrid();
        return;
      }

      if (event.key === "[") {
        event.preventDefault();
        handlers.onDecreaseBrushSize();
        return;
      }

      if (event.key === "]") {
        event.preventDefault();
        handlers.onIncreaseBrushSize();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handlers]);
}
