"use client";

import { useEffect, useRef, useState } from "react";

const INTERACTIVE_SELECTOR =
  "a[href],button,select,[role=button],[role=link],[data-cursor-interactive]";
const TEXT_SELECTOR = "input,textarea,[contenteditable=true]";

export function BrandCursor() {
  const dotRef = useRef<HTMLSpanElement>(null);
  const ringRef = useRef<HTMLSpanElement>(null);
  const frameRef = useRef<number | null>(null);
  const targetRef = useRef({ x: -100, y: -100 });
  const ringPosition = useRef({ x: -100, y: -100 });
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const finePointer = window.matchMedia("(pointer: fine) and (hover: hover)");
    const updateEnabled = () => setEnabled(finePointer.matches);
    updateEnabled();
    finePointer.addEventListener("change", updateEnabled);
    return () => finePointer.removeEventListener("change", updateEnabled);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    root.classList.add("has-brand-cursor");
    const render = () => {
      const target = targetRef.current;
      const current = ringPosition.current;
      const follow = window.matchMedia("(prefers-reduced-motion: reduce)")
        .matches
        ? 1
        : 0.2;
      current.x += (target.x - current.x) * follow;
      current.y += (target.y - current.y) * follow;
      dotRef.current?.style.setProperty(
        "transform",
        `translate3d(${target.x}px, ${target.y}px, 0)`,
      );
      ringRef.current?.style.setProperty(
        "transform",
        `translate3d(${current.x}px, ${current.y}px, 0)`,
      );
      if (
        Math.abs(target.x - current.x) > 0.1 ||
        Math.abs(target.y - current.y) > 0.1
      )
        frameRef.current = requestAnimationFrame(render);
      else frameRef.current = null;
    };
    const onMove = (event: PointerEvent) => {
      targetRef.current = { x: event.clientX, y: event.clientY };
      if (frameRef.current === null)
        frameRef.current = requestAnimationFrame(render);
    };
    const onOver = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const isText = Boolean(target?.closest(TEXT_SELECTOR));
      root.classList.toggle("brand-cursor--text", isText);
      root.classList.toggle(
        "brand-cursor--interactive",
        !isText && Boolean(target?.closest(INTERACTIVE_SELECTOR)),
      );
    };
    const onLeave = () => root.classList.add("brand-cursor--outside");
    const onEnter = () => root.classList.remove("brand-cursor--outside");
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerover", onOver, { passive: true });
    document.addEventListener("mouseleave", onLeave);
    document.addEventListener("mouseenter", onEnter);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("mouseleave", onLeave);
      document.removeEventListener("mouseenter", onEnter);
      root.classList.remove(
        "has-brand-cursor",
        "brand-cursor--text",
        "brand-cursor--interactive",
        "brand-cursor--outside",
      );
    };
  }, [enabled]);

  if (!enabled) return null;
  return (
    <div className="brand-cursor" aria-hidden="true">
      <span ref={ringRef} className="brand-cursor__ring" />
      <span ref={dotRef} className="brand-cursor__dot" />
    </div>
  );
}
