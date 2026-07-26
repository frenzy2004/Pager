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
      ]),
    );
  });
});
