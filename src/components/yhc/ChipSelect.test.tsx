// DOM smoke test — proves the jsdom project is wired and that the shared
// selection control used across registration, case-taking and Rx actually
// renders and reports the option that was tapped.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChipSelect } from "./ChipSelect";

const OPTIONS = ["CASH", "UPI", "CARD"] as const;

describe("ChipSelect", () => {
  it("renders one button per option", () => {
    render(<ChipSelect options={OPTIONS} value="" onChange={() => {}} />);
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("reports the tapped option exactly once", () => {
    const onChange = vi.fn();
    render(<ChipSelect options={OPTIONS} value="" onChange={onChange} />);
    fireEvent.click(screen.getByText("UPI"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("UPI");
  });

  it("uses type=button so it never submits the surrounding form", () => {
    render(<ChipSelect options={OPTIONS} value="CASH" onChange={() => {}} />);
    for (const btn of screen.getAllByRole("button")) {
      expect(btn).toHaveAttribute("type", "button");
    }
  });

  it("marks only the selected option as active", () => {
    render(<ChipSelect options={OPTIONS} value="CARD" onChange={() => {}} />);
    expect(screen.getByText("CARD").className).toContain("bg-primary");
    expect(screen.getByText("CASH").className).not.toContain("bg-primary");
  });
});
