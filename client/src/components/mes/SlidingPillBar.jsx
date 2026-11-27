import { useCallback, useLayoutEffect, useRef, useState } from 'react';

const DEFAULT_ACTIVE =
  '.is-active, .pill-tab-active, [aria-selected="true"], [aria-pressed="true"]';

/**
 * Segmented control track with a sliding active thumb.
 * Drop-in wrapper around existing toggle / pill / tab buttons.
 */
export default function SlidingPillBar({
  children,
  className = '',
  variant = 'surface',
  activeSelector = DEFAULT_ACTIVE,
  ...rest
}) {
  const rootRef = useRef(null);
  const [thumb, setThumb] = useState({
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    ready: false,
  });

  const measure = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;

    const active =
      root.querySelector(activeSelector) ||
      root.querySelector('button[aria-selected="true"], button[aria-pressed="true"]');

    if (!active) {
      setThumb((prev) => ({ ...prev, ready: false, w: 0 }));
      return;
    }

    setThumb({
      x: active.offsetLeft,
      y: active.offsetTop,
      w: active.offsetWidth,
      h: active.offsetHeight,
      ready: true,
    });
  }, [activeSelector]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };

    measure();
    schedule();

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    ro?.observe(root);
    Array.from(root.querySelectorAll('button, [role="tab"], [role="radio"]')).forEach((el) => {
      ro?.observe(el);
    });

    const mo = typeof MutationObserver !== 'undefined'
      ? new MutationObserver(schedule)
      : null;
    mo?.observe(root, {
      attributes: true,
      attributeFilter: ['class', 'aria-selected', 'aria-pressed'],
      childList: true,
      subtree: true,
    });

    root.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);

    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      mo?.disconnect();
      root.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [measure, children]);

  const classes = [
    'mes-pill-bar',
    `mes-pill-bar--${variant}`,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div ref={rootRef} className={classes} {...rest}>
      <span
        className={`mes-pill-bar-thumb${thumb.ready ? ' is-ready' : ''}`}
        aria-hidden
        style={{
          width: thumb.w,
          height: thumb.h,
          transform: `translate3d(${thumb.x}px, ${thumb.y}px, 0)`,
        }}
      />
      {children}
    </div>
  );
}
