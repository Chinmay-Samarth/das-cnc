import { useCallback, useEffect, useRef, useState } from 'react';

function isInteractiveTarget(target) {
  return Boolean(
    target?.closest?.(
      'input, select, textarea, button, a, label, [role="button"], [contenteditable="true"]'
    )
  );
}

/**
 * Drag-to-pan (hand tool) for a scroll container. Skips starts on form controls.
 */
export default function useHandPanScroll() {
  const ref = useRef(null);
  const dragRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    scrollLeft: 0,
    scrollTop: 0,
  });
  const [dragging, setDragging] = useState(false);

  const onPointerDown = useCallback((event) => {
    if (event.button !== 0) return;
    if (isInteractiveTarget(event.target)) return;
    const node = ref.current;
    if (!node) return;
    // Only pan when content overflows.
    if (node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight <= node.clientHeight + 1) {
      return;
    }

    dragRef.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: node.scrollLeft,
      scrollTop: node.scrollTop,
    };
    setDragging(true);
    try {
      node.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    event.preventDefault();
  }, []);

  const onPointerMove = useCallback((event) => {
    if (!dragRef.current.active) return;
    const node = ref.current;
    if (!node) return;
    const dx = event.clientX - dragRef.current.startX;
    const dy = event.clientY - dragRef.current.startY;
    node.scrollLeft = dragRef.current.scrollLeft - dx;
    node.scrollTop = dragRef.current.scrollTop - dy;
  }, []);

  const endDrag = useCallback((event) => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    setDragging(false);
    const node = ref.current;
    if (node && event?.pointerId != null) {
      try {
        node.releasePointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
    }
  }, []);

  useEffect(() => {
    if (!dragging) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') {
        dragRef.current.active = false;
        setDragging(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dragging]);

  const panProps = {
    ref,
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    'data-hand-pan': dragging ? 'dragging' : 'ready',
  };

  return { panProps, dragging };
}
