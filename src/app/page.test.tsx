import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_PROMPT_CHARS } from "../lib/limits";
import Home from "./page";

// useChat needs a fetch transport; the UI test only asserts static structure.
// End-to-end chat behavior runs in scripts/integration-test.sh.
vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: [],
    sendMessage: vi.fn(),
    status: "ready",
    error: null,
  }),
}));

describe("Home", () => {
  afterEach(cleanup);

  it("renders example questions, input and sources panel", () => {
    render(<Home />);
    expect(screen.getByPlaceholderText("Frage stellen")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fragen stellen" })).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(6); // 3 chips + 2 profile buttons + submit
    expect(screen.getByText(/Quellen/)).toBeTruthy();
  });

  it("enforces the prompt limit in the input", () => {
    render(<Home />);
    const input = screen.getByPlaceholderText("Frage stellen") as HTMLInputElement;
    expect(input.maxLength).toBe(MAX_PROMPT_CHARS);
  });
});
