import type { PointerEvent as ReactPointerEvent } from "react";
import { useSessions } from "../store/sessions";
import { clampSidebarWidth } from "../store/sidebar";
import "./SidebarResizer.css";

export function SidebarResizer() {
  const setSidebarWidth = useSessions((s) => s.setSidebarWidth);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = useSessions.getState().sidebarWidth;
    const root = document.documentElement;
    document.body.classList.add("vl-resizing");

    let raf = 0;
    let latest = startWidth;
    const flush = () => {
      raf = 0;
      root.style.setProperty("--vl-side-w", `${latest}px`);
      window.dispatchEvent(new Event("resize"));
    };
    const onMove = (ev: PointerEvent) => {
      latest = clampSidebarWidth(startWidth + (ev.clientX - startX));
      if (!raf) raf = requestAnimationFrame(flush);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (raf) cancelAnimationFrame(raf);
      document.body.classList.remove("vl-resizing");
      root.style.setProperty("--vl-side-w", `${latest}px`);
      setSidebarWidth(latest);
      window.dispatchEvent(new Event("resize"));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      className="vl-resizer"
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
    >
      <div className="vl-resizer-grip" />
    </div>
  );
}
