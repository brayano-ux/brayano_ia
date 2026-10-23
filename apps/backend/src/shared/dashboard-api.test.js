import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, setUnauthorizedHandler } from "../../../dashboard/src/services/api.js";
import { readSession, writeSession } from "../../../dashboard/src/services/storage.js";

let handler;
const response = status => new Response(JSON.stringify({ message: "Réponse de test" }), { status, headers: { "Content-Type": "application/json" } });
beforeEach(() => {
  const values = new Map();
  vi.stubGlobal("localStorage", { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) });
  vi.stubGlobal("window", { API_BASE_URL: "https://qa.example.test" });
  vi.stubGlobal("fetch", vi.fn());
  handler = vi.fn(); setUnauthorizedHandler(handler);
  writeSession({ email: "owner@example.test", token: "old-token" });
});
afterEach(() => vi.unstubAllGlobals());

describe("dashboard session failures", () => {
  it("expires a rejected session once even for concurrent requests", async () => {
    fetch.mockImplementation(async () => response(401));
    await Promise.allSettled([api("/organizations/org/ai-settings"), api("/organizations/org/conversations")]);
    expect(handler).toHaveBeenCalledOnce(); expect(readSession()).toBeNull();
    await expect(api("/organizations/org/conversations")).rejects.toMatchObject({ status: 401 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([403, 500, 503])("keeps the session on HTTP %i", async status => {
    fetch.mockResolvedValue(response(status));
    await expect(api("/me")).rejects.toMatchObject({ status });
    expect(readSession().token).toBe("old-token"); expect(handler).not.toHaveBeenCalled();
  });

  it("keeps the session on network failure", async () => {
    fetch.mockRejectedValue(new Error("offline"));
    await expect(api("/me")).rejects.toThrow("Failed to fetch");
    expect(readSession().token).toBe("old-token"); expect(handler).not.toHaveBeenCalled();
  });

  it("does not expire a session for incorrect login credentials", async () => {
    fetch.mockResolvedValue(response(401));
    await expect(api("/login", { method: "POST" })).rejects.toMatchObject({ status: 401 });
    expect(readSession().token).toBe("old-token"); expect(handler).not.toHaveBeenCalled();
  });

  it("ignores a late rejection from an older session", async () => {
    let resolve;
    fetch.mockImplementation(() => new Promise(r => { resolve = r; }));
    const pending = api("/me");
    writeSession({ email: "owner@example.test", token: "new-token" });
    resolve(response(401));
    await expect(pending).rejects.toMatchObject({ status: 401 });
    expect(readSession().token).toBe("new-token"); expect(handler).not.toHaveBeenCalled();
  });
});
