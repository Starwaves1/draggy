// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ImageViewer } from "../chat/ImageViewer";
import { translations } from "../translations";

const t = (key: string) => translations.en[key] || key;

function openViewer() {
  const origin = document.createElement("div");
  document.body.append(origin);
  render(<ImageViewer image={{ src: "fox.png", title: "Fox" }} origin={origin} onClose={() => {}} t={t} />);
  return screen.getByRole("dialog");
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  delete window.__DRAGGY_PLATFORM__;
});

describe("image viewer under the window controls", () => {
  it("keeps its bar at the edge when the page draws the window controls", () => {
    expect(openViewer().classList.contains("traffic-lights")).toBe(false);
  });

  it("moves its bar clear of the traffic lights when the system draws them", () => {
    window.__DRAGGY_PLATFORM__ = Object.freeze({ windowControls: "native" as const, readyAt: "frameCommitted" as const, shortcuts: "command" as const });
    expect(openViewer().classList.contains("traffic-lights")).toBe(true);
  });
});
