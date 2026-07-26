import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyExactValues, undoExactValues } from "./exact-driver";

describe("exact DOM fallback", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <form>
        <label for="name">Full name</label>
        <input id="name" name="name" value="Before" />
        <label for="summary">Summary</label>
        <textarea id="summary" name="summary">Old summary</textarea>
        <label for="role">Role</label>
        <select id="role" name="role">
          <option value="engineer" selected>Engineer</option>
          <option value="designer">Product designer</option>
        </select>
        <label><input name="remote" type="checkbox" /> Remote</label>
        <fieldset>
          <legend>Contact method</legend>
          <label><input name="contact" type="radio" value="email" checked /> Email</label>
          <label><input name="contact" type="radio" value="phone" /> Phone</label>
        </fieldset>
        <input name="password" type="password" value="secret" />
      </form>
    `;
  });

  it("fills exact safe mappings and emits React-compatible events", () => {
    const name = document.querySelector<HTMLInputElement>("[name=name]")!;
    const onInput = vi.fn();
    const onChange = vi.fn();
    name.addEventListener("input", onInput);
    name.addEventListener("change", onChange);

    const result = applyExactValues(document, {
      name: "Jamie Chen",
      summary: "Product designer focused on measurable outcomes.",
      role: "designer",
      remote: true,
      contact: "phone",
      password: "replacement",
      missing: "unknown",
    });

    expect(name.value).toBe("Jamie Chen");
    expect(
      document.querySelector<HTMLTextAreaElement>("[name=summary]")!.value,
    ).toContain("measurable outcomes");
    expect(
      document.querySelector<HTMLSelectElement>("[name=role]")!.value,
    ).toBe("designer");
    expect(
      document.querySelector<HTMLInputElement>("[name=remote]")!.checked,
    ).toBe(true);
    expect(
      document.querySelector<HTMLInputElement>(
        "[name=contact][value=phone]",
      )!.checked,
    ).toBe(true);
    expect(
      document.querySelector<HTMLInputElement>("[name=password]")!.value,
    ).toBe("secret");
    expect(result.skipped).toEqual(["password", "missing"]);
    expect(result.changed).toHaveLength(6);
    expect(onInput).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("undoes every changed control", () => {
    const result = applyExactValues(document, {
      name: "Jamie Chen",
      role: "designer",
      remote: true,
      contact: "phone",
    });

    undoExactValues(document, result.changed);

    expect(
      document.querySelector<HTMLInputElement>("[name=name]")!.value,
    ).toBe("Before");
    expect(
      document.querySelector<HTMLSelectElement>("[name=role]")!.value,
    ).toBe("engineer");
    expect(
      document.querySelector<HTMLInputElement>("[name=remote]")!.checked,
    ).toBe(false);
    expect(
      document.querySelector<HTMLInputElement>(
        "[name=contact][value=email]",
      )!.checked,
    ).toBe(true);
  });
});
