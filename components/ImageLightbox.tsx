"use client";

import { useEffect, useRef, useState } from "react";
import type { TouchEvent, WheelEvent } from "react";

type ImageLightboxProps = {
  imageUrl: string;
  title?: string;
  onClose: () => void;
};

type TouchPoint = {
  x: number;
  y: number;
};

type GestureState =
  | {
      mode: "pinch";
      distance: number;
      scale: number;
      offset: TouchPoint;
    }
  | {
      mode: "pan";
      point: TouchPoint;
      offset: TouchPoint;
    }
  | null;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function distanceBetweenTouches(touches: React.TouchList) {
  if (touches.length < 2) return 0;
  const first = touches[0];
  const second = touches[1];
  return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
}

export function ImageLightbox({ imageUrl, title = "添付画像", onClose }: ImageLightboxProps) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState<TouchPoint>({ x: 0, y: 0 });
  const gestureRef = useRef<GestureState>(null);
  const movedRef = useRef(false);

  useEffect(() => {
    const preventNativeGesture = (event: Event) => {
      event.preventDefault();
    };

    // iOS Safari can crash when native page pinch-zoom fights with a fixed image overlay.
    document.addEventListener("gesturestart", preventNativeGesture, { passive: false });
    document.addEventListener("gesturechange", preventNativeGesture, { passive: false });
    document.addEventListener("gestureend", preventNativeGesture, { passive: false });

    return () => {
      document.removeEventListener("gesturestart", preventNativeGesture);
      document.removeEventListener("gesturechange", preventNativeGesture);
      document.removeEventListener("gestureend", preventNativeGesture);
    };
  }, []);

  if (!imageUrl) return null;

  const resetZoom = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    gestureRef.current = null;
  };

  const closeLightbox = () => {
    resetZoom();
    onClose();
  };

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    movedRef.current = false;
    if (event.touches.length >= 2) {
      event.preventDefault();
      gestureRef.current = {
        mode: "pinch",
        distance: distanceBetweenTouches(event.touches),
        scale,
        offset,
      };
      return;
    }

    if (event.touches.length === 1 && scale > 1) {
      const touch = event.touches[0];
      gestureRef.current = {
        mode: "pan",
        point: { x: touch.clientX, y: touch.clientY },
        offset,
      };
    }
  };

  const handleTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    event.preventDefault();
    movedRef.current = true;

    if (gesture.mode === "pinch" && event.touches.length >= 2) {
      const nextDistance = distanceBetweenTouches(event.touches);
      if (!gesture.distance || !nextDistance) return;
      const nextScale = clamp(gesture.scale * (nextDistance / gesture.distance), 1, 4);
      setScale(nextScale);
      if (nextScale <= 1.01) setOffset({ x: 0, y: 0 });
      return;
    }

    if (gesture.mode === "pan" && event.touches.length === 1) {
      const touch = event.touches[0];
      const nextOffset = {
        x: gesture.offset.x + touch.clientX - gesture.point.x,
        y: gesture.offset.y + touch.clientY - gesture.point.y,
      };
      setOffset(nextOffset);
    }
  };

  const handleTouchEnd = () => {
    gestureRef.current = null;
    if (scale <= 1.01) {
      setScale(1);
      setOffset({ x: 0, y: 0 });
    }
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const nextScale = clamp(scale + (event.deltaY < 0 ? 0.25 : -0.25), 1, 4);
    setScale(nextScale);
    if (nextScale <= 1.01) setOffset({ x: 0, y: 0 });
  };

  return (
    <div
      className="fixed inset-0 z-[90] select-none overflow-hidden bg-slate-950/80 px-4 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] pt-[calc(env(safe-area-inset-top)+3.25rem)] backdrop-blur-sm"
      onClick={() => {
        if (movedRef.current) {
          movedRef.current = false;
          return;
        }
        closeLightbox();
      }}
      onWheel={handleWheel}
      style={{ touchAction: "none", overscrollBehavior: "contain" }}
    >
      <div className="flex h-full flex-col">
        <div className="pb-3 text-white">
          <div className="line-clamp-2 pr-2 text-sm font-semibold">{title}</div>
        </div>
        <div
          className="flex min-h-0 flex-1 items-center justify-center overflow-hidden"
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={resetZoom}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
          style={{ touchAction: "none" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt={title}
            draggable={false}
            className="max-h-full max-w-full rounded-2xl object-contain shadow-2xl will-change-transform"
            style={{
              transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
              transition: gestureRef.current ? "none" : "transform 160ms ease",
            }}
          />
        </div>
      </div>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          closeLightbox();
        }}
        className="fixed left-1/2 bottom-[calc(env(safe-area-inset-bottom)+1.25rem)] flex h-12 -translate-x-1/2 items-center justify-center rounded-full bg-white/90 px-6 text-sm font-semibold text-slate-900 shadow-[0_18px_50px_rgba(0,0,0,0.28)] transition hover:bg-white"
        aria-label="拡大画像を閉じる"
      >
        閉じる
      </button>
    </div>
  );
}
