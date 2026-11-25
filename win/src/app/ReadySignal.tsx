import { useEffect } from "react";
import { swallowed } from "../logger";
import { platformInfo } from "../platform/info";

let signalled = false;

/** Tells the startup splash that this window has painted, so the swap shows no blank frame. Once per
 * page: StrictMode runs effects twice. */
export function ReadySignal() {
  useEffect(() => {
    if (signalled) return;
    signalled = true;
    const tell = () => {
      void Promise.resolve(window.draggy?.startup?.ready?.()).catch(
        swallowed("startup", "the splash shows this window on its own after a timeout"),
      );
    };
    requestAnimationFrame(() => {
      // The next frame starts only once this one is committed, so waiting for it means a painted window.
      if (platformInfo().readyAt === "frameCommitted") requestAnimationFrame(tell);
      else tell();
    });
  }, []);
  return null;
}
