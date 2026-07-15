"use client";

import { useEffect } from "react";

export function PreventNativePinchZoom() {
  useEffect(() => {
    const preventNativeGesture = (event: Event) => {
      event.preventDefault();
    };

    const preventMultiTouchZoom = (event: TouchEvent) => {
      if (event.touches.length > 1) {
        event.preventDefault();
      }
    };

    const listenerOptions = { passive: false } as AddEventListenerOptions;

    // iOS Safari/PWA can crash when native page zoom fights with fixed app chrome.
    document.addEventListener("gesturestart", preventNativeGesture, listenerOptions);
    document.addEventListener("gesturechange", preventNativeGesture, listenerOptions);
    document.addEventListener("gestureend", preventNativeGesture, listenerOptions);
    document.addEventListener("touchmove", preventMultiTouchZoom, listenerOptions);

    return () => {
      document.removeEventListener("gesturestart", preventNativeGesture);
      document.removeEventListener("gesturechange", preventNativeGesture);
      document.removeEventListener("gestureend", preventNativeGesture);
      document.removeEventListener("touchmove", preventMultiTouchZoom);
    };
  }, []);

  return null;
}
