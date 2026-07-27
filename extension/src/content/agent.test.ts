import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createPageAgentExecutor,
  type AgentRuntime,
  type PageAgentFactory,
} from "./agent";
import type { Strategy } from "../shared/protocol";

const strategy: Strategy = {
  id: "balanced",
  label: "Balanced",
  eyebrow: "Best overall",
  rationale: "Clear and grounded.",
  confidence: 0.9,
  accent: "violet",
  fields: {
    name: {
      value: "Jamie Chen",
      status: "supported",
      confidence: 1,
      sourceIds: [],
    },
  },
  sources: [],
};

function runtime(): AgentRuntime & {
  sendMessage: ReturnType<typeof vi.fn>;
} {
  return {
    sendMessage: vi.fn(async (message) =>
      message.type === "AUTHORIZE_SUBMIT"
        ? {
            ok: true,
            result: { authorized: true },
          }
        : {
            ok: true,
            result: {
              status: 200,
              statusText: "OK",
              headers: { "content-type": "application/json" },
              bodyText: '{"choices":[]}',
            },
          },
    ),
  };
}

describe("Alibaba Page Agent connector executor", () => {
  beforeEach(() => {
    Reflect.deleteProperty(
      document.documentElement,
      "getBoundingClientRect",
    );
    window.__mochiDocumentId = undefined;
    document.body.innerHTML = `
      <form>
        <label for="name">Full name</label>
        <input id="name" name="name" value="Before" />
        <input name="password" type="password" value="secret" />
        <button type="submit">Send application</button>
      </form>
    `;
  });

  it("keeps review mode non-mutating and does not construct an agent", async () => {
    const createAgent = vi.fn();
    const executor = createPageAgentExecutor({
      createAgent,
      document,
      runtime: runtime(),
    });

    await expect(executor.run(strategy, "review")).resolves.toMatchObject({
      status: "preview",
      values: { name: "Jamie Chen" },
    });
    expect(createAgent).not.toHaveBeenCalled();
    expect(
      document.querySelector<HTMLInputElement>("[name=name]")!.value,
    ).toBe("Before");
  });

  it("configures Page Agent with a fixed Vercel custom fetch and sixteen steps", async () => {
    let proxiedStatus = 0;
    const execute = vi.fn().mockImplementation(async () => {
      const response = await createAgent.mock.calls[0]![0].customFetch!(
        "https://attacker.example.test/chat/completions",
        { method: "POST", body: '{"messages":[]}' },
      );
      proxiedStatus = response.status;
      document.querySelector<HTMLInputElement>("[name=name]")!.value =
        "Jamie Chen";
      return { success: true, data: "Filled", history: [] };
    });
    const stop = vi.fn().mockResolvedValue(undefined);
    const dispose = vi.fn();
    const createAgent = vi.fn<PageAgentFactory>(() => ({
      dispose,
      execute,
      stop,
    }));
    const agentRuntime = runtime();
    const executor = createPageAgentExecutor({
      createAgent,
      document,
      runtime: agentRuntime,
    });

    await expect(executor.run(strategy, "fill")).resolves.toMatchObject({
      status: "filled",
      values: { name: "Jamie Chen" },
    });

    const config = createAgent.mock.calls[0]![0];
    expect(config).toMatchObject({
      apiKey: "",
      baseURL: "https://mochi-overlay.vercel.app/api/page-agent",
      language: "en-US",
      maxSteps: 16,
      model: "gpt-5.6-sol",
      promptForNextTask: false,
    });
    expect(config.customTools).toMatchObject({
      ask_user: null,
      click_element_by_index: null,
    });
    expect(config.interactiveBlacklist).toEqual(
      expect.arrayContaining([
        document.querySelector("[name=password]"),
        document.querySelector("button"),
      ]),
    );
    expect(config.interactiveBlacklist).not.toContain(
      document.querySelector("[name=name]"),
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("Do not submit the form"),
    );

    expect(agentRuntime.sendMessage).toHaveBeenCalledWith({
      type: "FETCH_PAGE_AGENT",
      body: '{"messages":[]}',
      executionId: "local-test-execution",
    });
    expect(proxiedStatus).toBe(200);

    executor.cancel();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("snapshots safe controls and can undo Page Agent changes", async () => {
    document.querySelector("form")!.insertAdjacentHTML(
      "afterbegin",
      '<input name="email" type="email" value="before@example.test" />',
    );
    const executor = createPageAgentExecutor({
      createAgent: () => ({
        dispose: vi.fn(),
        execute: async () => {
          document.querySelector<HTMLInputElement>("[name=name]")!.value =
            "Jamie Chen";
          return { success: true, data: "Filled", history: [] };
        },
        stop: vi.fn().mockResolvedValue(undefined),
      }),
      document,
      runtime: runtime(),
    });

    await executor.run(strategy, "fill");
    document.querySelector<HTMLInputElement>("[name=email]")!.value =
      "user-edited@example.test";
    executor.undo();

    expect(
      document.querySelector<HTMLInputElement>("[name=name]")!.value,
    ).toBe("Before");
    expect(
      document.querySelector<HTMLInputElement>("[name=email]")!.value,
    ).toBe("user-edited@example.test");
  });

  it("Undo preserves a user edit made after Mochi filled the same field", async () => {
    const executor = createPageAgentExecutor({
      createAgent: () => ({
        dispose: vi.fn(),
        execute: async () => {
          document.querySelector<HTMLInputElement>("[name=name]")!.value =
            "Jamie Chen";
          return { success: true, data: "Filled", history: [] };
        },
        stop: vi.fn().mockResolvedValue(undefined),
      }),
      document,
      runtime: runtime(),
    });

    await executor.run(strategy, "fill");
    document.querySelector<HTMLInputElement>("[name=name]")!.value =
      "User override";
    executor.undo();

    expect(
      document.querySelector<HTMLInputElement>("[name=name]")!.value,
    ).toBe("User override");
  });

  it("offers exact-map filling only as a separate explicit action", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("Provider offline"));
    const executor = createPageAgentExecutor({
      createAgent: () => ({
        dispose: vi.fn(),
        execute,
        stop: vi.fn().mockResolvedValue(undefined),
      }),
      document,
      runtime: runtime(),
    });

    await expect(executor.run(strategy, "fill")).rejects.toThrow(
      "Provider offline",
    );
    expect(execute).toHaveBeenCalledOnce();
    expect(
      document.querySelector<HTMLInputElement>("[name=name]")!.value,
    ).toBe("Before");

    await expect(executor.runExact(strategy)).resolves.toMatchObject({
      status: "filled",
      adapter: "exact-fallback",
      changedFields: 1,
    });
    expect(
      document.querySelector<HTMLInputElement>("[name=name]")!.value,
    ).toBe("Jamie Chen");
  });

  it("rolls back exact fill when cancellation arrives during guard release", async () => {
    let releaseGuard: (() => void) | undefined;
    const agentRuntime = runtime();
    agentRuntime.sendMessage.mockImplementation(async (message) => {
      if (message.type === "RELEASE_EXECUTION_GUARD") {
        return new Promise((resolve) => {
          releaseGuard = () => resolve({ ok: true });
        });
      }
      return { ok: true };
    });
    const executor = createPageAgentExecutor({
      document,
      runtime: agentRuntime,
    });

    const pending = executor.runExact(strategy, "exact-cancel-test");
    await vi.waitFor(() =>
      expect(agentRuntime.sendMessage).toHaveBeenCalledWith({
        type: "RELEASE_EXECUTION_GUARD",
        executionId: "exact-cancel-test",
      }),
    );
    await executor.cancel();
    releaseGuard?.();

    await expect(pending).resolves.toMatchObject({
      status: "cancelled",
      changedFields: 0,
    });
    expect(
      document.querySelector<HTMLInputElement>("[name=name]")!.value,
    ).toBe("Before");
  });

  it("rolls back a Page Agent mutation after the host hides the field", async () => {
    const name = document.querySelector<HTMLInputElement>("[name=name]")!;
    const executor = createPageAgentExecutor({
      createAgent: () => ({
        dispose: vi.fn(),
        execute: async () => {
          name.value = "Partially changed";
          name.hidden = true;
          return {
            success: false as const,
            data: "Host moved to another step",
            history: [],
          };
        },
        stop: vi.fn().mockResolvedValue(undefined),
      }),
      document,
      runtime: runtime(),
    });

    await expect(executor.run(strategy, "fill")).rejects.toThrow(
      "Host moved to another step",
    );
    expect(name.value).toBe("Before");
  });

  it("treats a resolved Page Agent failure as an error and rolls back partial changes", async () => {
    const execute = vi.fn(async () => {
      document.querySelector<HTMLInputElement>("[name=name]")!.value =
        "Partially changed";
      return {
        success: false as const,
        data: "Invalid model tool response",
        history: [],
      };
    });
    const executor = createPageAgentExecutor({
      createAgent: () => ({
        dispose: vi.fn(),
        execute,
        stop: vi.fn().mockResolvedValue(undefined),
      }),
      document,
      runtime: runtime(),
    });

    await expect(executor.run(strategy, "fill")).rejects.toThrow(
      "Invalid model tool response",
    );
    expect(execute).toHaveBeenCalledOnce();
    expect(
      document.querySelector<HTMLInputElement>("[name=name]")!.value,
    ).toBe("Before");
  });

  it("cancels without falling back and restores Page Agent partial mutations", async () => {
    document.querySelector("form")!.insertAdjacentHTML(
      "afterbegin",
      '<input name="email" type="email" value="before@example.test" />',
    );
    let finishExecution:
      | ((result: { success: false; data: string; history: [] }) => void)
      | undefined;
    const execute = vi.fn(async () => {
      document.querySelector<HTMLInputElement>("[name=name]")!.value =
        "Partially changed";
      return new Promise<{ success: false; data: string; history: [] }>(
        (resolve) => {
          finishExecution = resolve;
        },
      );
    });
    const stop = vi.fn().mockResolvedValue(undefined);
    const executor = createPageAgentExecutor({
      createAgent: () => ({
        dispose: vi.fn(),
        execute,
        stop,
      }),
      document,
      isUserInitiatedEvent: () => true,
      runtime: runtime(),
    });

    const pending = executor.run(strategy, "fill");
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    const email =
      document.querySelector<HTMLInputElement>("[name=email]")!;
    email.value = "user-edited@example.test";
    email.dispatchEvent(new Event("input", { bubbles: true }));
    const name =
      document.querySelector<HTMLInputElement>("[name=name]")!;
    name.value = "User name";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    name.value = "Jamie Chen";
    await executor.cancel();
    finishExecution?.({
      success: false,
      data: "Task aborted",
      history: [],
    });

    await expect(pending).resolves.toMatchObject({
      status: "cancelled",
      changedFields: 0,
    });
    expect(stop).toHaveBeenCalledOnce();
    expect(name.value).toBe("User name");
    expect(email.value).toBe("user-edited@example.test");
  });

  it("rejects and rolls back changes outside the approved field map", async () => {
    document.querySelector("form")!.insertAdjacentHTML(
      "afterbegin",
      '<input name="email" type="email" value="before@example.test" />',
    );
    const executor = createPageAgentExecutor({
      createAgent: () => ({
        dispose: vi.fn(),
        execute: async () => {
          document.querySelector<HTMLInputElement>("[name=name]")!.value =
            "Jamie Chen";
          document.querySelector<HTMLInputElement>("[name=email]")!.value =
            "changed@example.test";
          return { success: true, data: "Filled", history: [] };
        },
        stop: vi.fn().mockResolvedValue(undefined),
      }),
      document,
      runtime: runtime(),
    });

    await expect(executor.run(strategy, "fill")).rejects.toThrow(
      "outside the approved field map",
    );
    expect(
      document.querySelector<HTMLInputElement>("[name=name]")!.value,
    ).toBe("Before");
    expect(
      document.querySelector<HTMLInputElement>("[name=email]")!.value,
    ).toBe("before@example.test");
  });

  it("keeps Page Agent away from clicks and submits autopilot exactly once after validation", async () => {
    const submit = vi.fn((event: Event) => event.preventDefault());
    document.querySelector("form")!.addEventListener("submit", submit);
    const createAgent = vi.fn<PageAgentFactory>(() => ({
      dispose: vi.fn(),
      execute: async () => {
        document.querySelector<HTMLInputElement>("[name=name]")!.value =
          "Jamie Chen";
        return { success: true, data: "Filled", history: [] };
      },
      stop: vi.fn().mockResolvedValue(undefined),
    }));
    const executor = createPageAgentExecutor({
      createAgent,
      document,
      runtime: runtime(),
    });

    await expect(executor.run(strategy, "autopilot")).resolves.toMatchObject({
      status: "submitted",
      changedFields: 1,
    });

    expect(
      createAgent.mock.calls[0]![0].customTools?.click_element_by_index,
    ).toBeNull();
    expect(submit).toHaveBeenCalledOnce();
  });

  it("never submits Autopilot when any approved field is absent", async () => {
    const submit = vi.fn((event: Event) => event.preventDefault());
    document.querySelector("form")!.addEventListener("submit", submit);
    const executor = createPageAgentExecutor({
      createAgent: () => ({
        dispose: vi.fn(),
        execute: async () => {
          document.querySelector<HTMLInputElement>("[name=name]")!.value =
            "Jamie Chen";
          return { success: true, data: "Filled one field", history: [] };
        },
        stop: vi.fn().mockResolvedValue(undefined),
      }),
      document,
      runtime: runtime(),
    });

    await expect(
      executor.run(
        {
          ...strategy,
          fields: {
            ...strategy.fields,
            email: {
              value: "jamie@example.test",
              status: "supported",
              confidence: 1,
              sourceIds: [],
            },
          },
        },
        "autopilot",
      ),
    ).resolves.toMatchObject({
      status: "filled",
      warning: expect.stringContaining("email"),
    });
    expect(submit).not.toHaveBeenCalled();
  });

  it("rolls back when cancellation arrives during final submit authorization", async () => {
    const submit = vi.fn((event: Event) => event.preventDefault());
    document.querySelector("form")!.addEventListener("submit", submit);
    let releaseAuthorization:
      | ((value: { ok: true; result: { authorized: true } }) => void)
      | undefined;
    const agentRuntime = runtime();
    agentRuntime.sendMessage.mockImplementation(async (message) => {
      if (message.type === "AUTHORIZE_SUBMIT") {
        return new Promise((resolve) => {
          releaseAuthorization = resolve;
        });
      }
      return {
        ok: true,
        result: {
          status: 200,
          statusText: "OK",
          headers: { "content-type": "application/json" },
          bodyText: '{"choices":[]}',
        },
      };
    });
    const executor = createPageAgentExecutor({
      createAgent: () => ({
        dispose: vi.fn(),
        execute: async () => {
          document.querySelector<HTMLInputElement>("[name=name]")!.value =
            "Jamie Chen";
          return { success: true, data: "Filled", history: [] };
        },
        stop: vi.fn().mockResolvedValue(undefined),
      }),
      document,
      runtime: agentRuntime,
    });

    const pending = executor.run(strategy, "autopilot");
    await vi.waitFor(() =>
      expect(agentRuntime.sendMessage).toHaveBeenCalledWith({
        type: "AUTHORIZE_SUBMIT",
        executionId: "local-test-execution",
        documentId: "local-test-document",
      }),
    );
    await executor.cancel();
    releaseAuthorization?.({
      ok: true,
      result: { authorized: true },
    });

    await expect(pending).resolves.toMatchObject({
      status: "cancelled",
      changedFields: 0,
    });
    expect(submit).not.toHaveBeenCalled();
    expect(
      document.querySelector<HTMLInputElement>("[name=name]")!.value,
    ).toBe("Before");
  });

  it("blocks host input handlers from programmatically submitting during exact fill", async () => {
    const nativeSubmit = vi.spyOn(
      HTMLFormElement.prototype,
      "submit",
    );
    document
      .querySelector<HTMLInputElement>("[name=name]")!
      .addEventListener("input", (event) => {
        (event.currentTarget as HTMLInputElement).form?.submit();
      });
    const executor = createPageAgentExecutor({
      document,
      runtime: runtime(),
    });

    await executor.runExact(strategy);
    executor.undo();

    expect(nativeSubmit).not.toHaveBeenCalled();
    nativeSubmit.mockRestore();
  });

  it("refuses ambiguous, hidden, or overriding autopilot submitters", async () => {
    const form = document.querySelector("form")!;
    form.insertAdjacentHTML(
      "beforeend",
      '<button type="submit">Alternate action</button>',
    );
    const submit = vi.fn((event: Event) => event.preventDefault());
    form.addEventListener("submit", submit);
    const executor = createPageAgentExecutor({
      createAgent: () => ({
        dispose: vi.fn(),
        execute: async () => {
          document.querySelector<HTMLInputElement>("[name=name]")!.value =
            "Jamie Chen";
          return { success: true, data: "Filled", history: [] };
        },
        stop: vi.fn().mockResolvedValue(undefined),
      }),
      document,
      runtime: runtime(),
    });

    await expect(
      executor.run(strategy, "autopilot"),
    ).resolves.toMatchObject({
      status: "filled",
      warning: expect.stringContaining("did not find one valid"),
    });
    expect(submit).not.toHaveBeenCalled();

    form.querySelectorAll("button")[1]!.remove();
    form.querySelector("button")!.setAttribute("hidden", "");
    await expect(
      executor.run(strategy, "autopilot"),
    ).resolves.toMatchObject({ status: "filled" });
    expect(submit).not.toHaveBeenCalled();

    form.querySelector("button")!.removeAttribute("hidden");
    Object.defineProperty(document.documentElement, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        top: 0,
        left: 0,
        right: 1280,
        bottom: 2000,
        width: 1280,
        height: 2000,
      }),
    });
    Object.defineProperty(
      document.querySelector("[name=name]"),
      "getBoundingClientRect",
      {
        configurable: true,
        value: () => ({
          top: 20,
          left: 20,
          right: 220,
          bottom: 52,
          width: 200,
          height: 32,
        }),
      },
    );
    Object.defineProperty(form.querySelector("button"), "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        top: 1200,
        left: 20,
        right: 220,
        bottom: 1232,
        width: 200,
        height: 32,
      }),
    });
    await expect(
      executor.run(strategy, "autopilot"),
    ).resolves.toMatchObject({ status: "filled" });
    expect(submit).not.toHaveBeenCalled();
  });

  it("blacklists unapproved editables inside shadow roots and same-origin frames", async () => {
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    shadow.appendChild(editable);
    document.body.appendChild(host);
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const framedInput = frame.contentDocument!.createElement("input");
    frame.contentDocument!.body.appendChild(framedInput);
    const createAgent = vi.fn<PageAgentFactory>(() => ({
      dispose: vi.fn(),
      execute: async () => {
        document.querySelector<HTMLInputElement>("[name=name]")!.value =
          "Jamie Chen";
        return { success: true, data: "Filled", history: [] };
      },
      stop: vi.fn().mockResolvedValue(undefined),
    }));
    const executor = createPageAgentExecutor({
      createAgent,
      document,
      runtime: runtime(),
    });

    await executor.run(strategy, "fill");

    expect(createAgent.mock.calls[0]![0].interactiveBlacklist).toEqual(
      expect.arrayContaining([editable, framedInput]),
    );
  });
});
