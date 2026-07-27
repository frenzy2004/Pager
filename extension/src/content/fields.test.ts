import { beforeEach, describe, expect, it } from "vitest";

import { discoverSafeFields } from "./fields";

describe("safe field discovery", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <form>
        <label for="full-name">Full name</label>
        <input id="full-name" name="full_name" required />
        <input name="email" type="email" aria-label="Email address" />
        <label>About you <textarea name="summary"></textarea></label>
        <label for="role">Preferred role</label>
        <select id="role" name="role">
          <option value="">Choose</option>
          <option value="designer">Product designer</option>
        </select>
        <label><input type="checkbox" name="remote" /> Open to remote</label>
        <fieldset>
          <legend>Contact method</legend>
          <label><input type="radio" name="contact" value="email" /> Email</label>
          <label><input type="radio" name="contact" value="phone" /> Phone</label>
        </fieldset>
        <input name="password" type="password" />
        <input name="resume" type="file" />
        <input name="otp" autocomplete="one-time-code" />
        <input name="card_number" aria-label="Credit card number" />
        <input name="disabled" disabled />
        <input name="hidden" hidden />
        <div style="display: none"><input name="css_display_none" /></div>
        <div style="visibility: hidden"><input name="css_visibility_hidden" /></div>
        <div style="opacity: 0"><input name="css_opacity_zero" /></div>
      </form>
    `;
  });

  it("returns labelled, serializable fields and groups radio options", () => {
    expect(discoverSafeFields(document)).toEqual([
      {
        key: "full_name",
        label: "Full name",
        type: "text",
        required: true,
      },
      {
        key: "email",
        label: "Email address",
        type: "email",
        required: false,
      },
      {
        key: "summary",
        label: "About you",
        type: "textarea",
        required: false,
      },
      {
        key: "role",
        label: "Preferred role",
        type: "select",
        required: false,
        options: ["Product designer"],
      },
      {
        key: "remote",
        label: "Open to remote",
        type: "checkbox",
        required: false,
      },
      {
        key: "contact",
        label: "Contact method",
        type: "radio",
        required: false,
        options: ["email", "phone"],
      },
    ]);
  });

  it("never returns credentials, uploads, payment, OTP, disabled, or hidden fields", () => {
    const keys = discoverSafeFields(document).map(({ key }) => key);

    expect(keys).not.toEqual(
      expect.arrayContaining([
        "password",
        "resume",
        "otp",
        "card_number",
        "disabled",
        "hidden",
        "css_display_none",
        "css_visibility_hidden",
        "css_opacity_zero",
      ]),
    );
  });

  it("bounds and deduplicates page-controlled option metadata", () => {
    const select = document.querySelector<HTMLSelectElement>("[name=role]")!;
    select.replaceChildren();
    Array.from({ length: 45 }, (_, index) => {
      const option = document.createElement("option");
      option.value = `role-${index}`;
      option.textContent =
        index < 2 ? "Duplicate" : `Role ${index} ${"x".repeat(180)}`;
      select.append(option);
    });

    const role = discoverSafeFields(document).find(
      ({ key }) => key === "role",
    );

    expect(role?.options).toHaveLength(30);
    expect(new Set(role?.options).size).toBe(30);
    expect(role?.options?.every((option) => option.length <= 120)).toBe(true);
  });

  it("keeps vertical long-form fields but rejects zero-size and horizontal offscreen honeypots", () => {
    Object.defineProperty(document.documentElement, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 1280,
        bottom: 2000,
        width: 1280,
        height: 2000,
        toJSON: () => ({}),
      }),
    });
    document
      .querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        "input, textarea, select",
      )
      .forEach((element) => {
        Object.defineProperty(element, "getBoundingClientRect", {
          configurable: true,
          value: () => ({
            x: 20,
            y: 20,
            top: 20,
            left: 20,
            right: 220,
            bottom: 52,
            width: 200,
            height: 32,
            toJSON: () => ({}),
          }),
        });
      });
    document.querySelector("form")!.insertAdjacentHTML(
      "beforeend",
      `
        <input name="zero_size" />
        <input name="left_offscreen_honeypot" />
        <input name="right_offscreen_honeypot" />
        <input name="below_fold_field" />
      `,
    );
    Object.defineProperty(
      document.querySelector("[name=zero_size]"),
      "getBoundingClientRect",
      {
        configurable: true,
        value: () => ({
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: 0,
          height: 0,
          toJSON: () => ({}),
        }),
      },
    );
    Object.defineProperty(
      document.querySelector("[name=left_offscreen_honeypot]"),
      "getBoundingClientRect",
      {
        configurable: true,
        value: () => ({
          x: -10000,
          y: 0,
          top: 0,
          left: -10000,
          right: -9800,
          bottom: 32,
          width: 200,
          height: 32,
          toJSON: () => ({}),
        }),
      },
    );
    Object.defineProperty(
      document.querySelector("[name=right_offscreen_honeypot]"),
      "getBoundingClientRect",
      {
        configurable: true,
        value: () => ({
          x: 10000,
          y: 0,
          top: 0,
          left: 10000,
          right: 10200,
          bottom: 32,
          width: 200,
          height: 32,
          toJSON: () => ({}),
        }),
      },
    );
    Object.defineProperty(
      document.querySelector("[name=below_fold_field]"),
      "getBoundingClientRect",
      {
        configurable: true,
        value: () => ({
          x: 20,
          y: 1200,
          top: 1200,
          left: 20,
          right: 220,
          bottom: 1232,
          width: 200,
          height: 32,
          toJSON: () => ({}),
        }),
      },
    );

    const keys = discoverSafeFields(document).map(({ key }) => key);

    expect(keys).not.toContain("zero_size");
    expect(keys).not.toContain("left_offscreen_honeypot");
    expect(keys).not.toContain("right_offscreen_honeypot");
    expect(keys).toContain("below_fold_field");
    expect(keys).toContain("full_name");
  });
});
