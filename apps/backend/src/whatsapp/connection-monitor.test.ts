import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConnectionMonitor } from "./connection-monitor.js";

const MIN = 60_000;

describe("connection monitor", () => {
  let clock = 0;
  const timers: Array<{ at: number; callback: () => void; cancelled: boolean }> = [];
  const onAlert = vi.fn();
  const onRecovered = vi.fn();
  const onClientAlert = vi.fn();
  const onClientRecovered = vi.fn();

  const advance = (ms: number) => {
    clock += ms;
    for (const timer of timers) {
      if (!timer.cancelled && timer.at <= clock) {
        timer.cancelled = true;
        timer.callback();
      }
    }
  };
  const make = () => createConnectionMonitor({
    graceMs: 5 * MIN,
    loggedOutGraceMs: MIN,
    now: () => clock,
    setTimer: (callback, delayMs) => {
      const timer = { at: clock + delayMs, callback, cancelled: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => { (timer as { cancelled: boolean }).cancelled = true; },
    onAlert,
    onRecovered,
    clientGraceMs: 5 * MIN,
    onClientAlert,
    onClientRecovered,
  });

  beforeEach(() => {
    clock = 1_000_000;
    timers.length = 0;
    vi.clearAllMocks();
  });

  it("alerts once when a previously connected number stays disconnected past the grace period", () => {
    const monitor = make();
    monitor.handle("org-1", { status: "DISCONNECTED", reason: "connection_lost", previouslyConnected: true });
    advance(4 * MIN);
    expect(onAlert).not.toHaveBeenCalled();
    advance(2 * MIN);
    expect(onAlert).toHaveBeenCalledTimes(1);
    expect(onAlert).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-1", reason: "connection_lost", status: "DISCONNECTED" }));
    advance(60 * MIN);
    expect(onAlert).toHaveBeenCalledTimes(1);
  });

  it("stays silent when the automatic reconnection succeeds in time", () => {
    const monitor = make();
    monitor.handle("org-1", { status: "DISCONNECTED", reason: "connection_lost", previouslyConnected: true });
    advance(2 * MIN);
    monitor.handle("org-1", { status: "CONNECTED", previouslyConnected: true });
    advance(10 * MIN);
    expect(onAlert).not.toHaveBeenCalled();
    expect(onRecovered).not.toHaveBeenCalled();
  });

  it("passes the WhatsApp explanation along with the outage and keeps it through later updates", () => {
    const monitor = make();
    monitor.handle("org-1", { status: "DISCONNECTED", reason: "connection_lost", detail: "Session ouverte ailleurs (code 440)", previouslyConnected: true });
    monitor.handle("org-1", { status: "QR_PENDING", previouslyConnected: true });
    advance(6 * MIN);
    expect(onAlert).toHaveBeenCalledWith(expect.objectContaining({ detail: "Session ouverte ailleurs (code 440)", status: "QR_PENDING" }));
  });

  it("alerts sooner when the number was logged out from the phone", () => {
    const monitor = make();
    monitor.handle("org-1", { status: "DISCONNECTED", reason: "logged_out", previouslyConnected: true });
    advance(2 * MIN);
    expect(onAlert).toHaveBeenCalledWith(expect.objectContaining({ reason: "logged_out" }));
  });

  it("upgrades a pending connection-lost wait to a logged-out one", () => {
    const monitor = make();
    monitor.handle("org-1", { status: "DISCONNECTED", reason: "connection_lost", previouslyConnected: true });
    advance(MIN);
    monitor.handle("org-1", { status: "DISCONNECTED", reason: "logged_out", previouslyConnected: true });
    advance(MIN + 1);
    expect(onAlert).toHaveBeenCalledTimes(1);
    expect(onAlert.mock.calls[0]![0].reason).toBe("logged_out");
  });

  it("does not alert for a first connection still waiting for its QR code", () => {
    const monitor = make();
    monitor.handle("org-1", { status: "QR_PENDING", previouslyConnected: false });
    advance(60 * MIN);
    expect(onAlert).not.toHaveBeenCalled();
  });

  it("alerts when a known number needs a new QR code", () => {
    const monitor = make();
    monitor.handle("org-1", { status: "QR_PENDING", previouslyConnected: true });
    advance(6 * MIN);
    expect(onAlert).toHaveBeenCalledWith(expect.objectContaining({ status: "QR_PENDING" }));
  });

  it("never alerts for a voluntary disconnection", () => {
    const monitor = make();
    monitor.markIntentional("org-1");
    monitor.handle("org-1", { status: "DISCONNECTED", reason: "logged_out", previouslyConnected: true });
    monitor.handle("org-1", { status: "QR_PENDING", previouslyConnected: true });
    advance(60 * MIN);
    expect(onAlert).not.toHaveBeenCalled();
    monitor.handle("org-1", { status: "DISCONNECTED", reason: "manual", previouslyConnected: true });
    advance(60 * MIN);
    expect(onAlert).not.toHaveBeenCalled();
  });

  it("cancels a pending alert when the disconnection becomes voluntary", () => {
    const monitor = make();
    monitor.handle("org-1", { status: "DISCONNECTED", reason: "connection_lost", previouslyConnected: true });
    monitor.markIntentional("org-1");
    advance(60 * MIN);
    expect(onAlert).not.toHaveBeenCalled();
  });

  it("announces the recovery once after an alert, with the downtime", () => {
    const monitor = make();
    monitor.handle("org-1", { status: "DISCONNECTED", reason: "logged_out", previouslyConnected: true });
    advance(10 * MIN);
    monitor.handle("org-1", { status: "CONNECTED", previouslyConnected: true });
    expect(onRecovered).toHaveBeenCalledTimes(1);
    expect(onRecovered).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-1" }), 10 * MIN);
    monitor.handle("org-1", { status: "CONNECTED", previouslyConnected: true });
    expect(onRecovered).toHaveBeenCalledTimes(1);
  });

  it("alerts again for a new outage after a recovery", () => {
    const monitor = make();
    monitor.handle("org-1", { status: "DISCONNECTED", reason: "connection_lost", previouslyConnected: true });
    advance(6 * MIN);
    monitor.handle("org-1", { status: "CONNECTED", previouslyConnected: true });
    monitor.handle("org-1", { status: "DISCONNECTED", reason: "connection_lost", previouslyConnected: true });
    advance(6 * MIN);
    expect(onAlert).toHaveBeenCalledTimes(2);
  });

  it("tracks each organization independently", () => {
    const monitor = make();
    monitor.handle("org-1", { status: "DISCONNECTED", reason: "connection_lost", previouslyConnected: true });
    monitor.handle("org-2", { status: "DISCONNECTED", reason: "connection_lost", previouslyConnected: true });
    monitor.handle("org-2", { status: "CONNECTED", previouslyConnected: true });
    advance(6 * MIN);
    expect(onAlert).toHaveBeenCalledTimes(1);
    expect(onAlert.mock.calls[0]![0].organizationId).toBe("org-1");
  });

  it("survives a failing alert handler", async () => {
    onAlert.mockRejectedValueOnce(new Error("SMTP down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const monitor = make();
    monitor.handle("org-1", { status: "DISCONNECTED", reason: "logged_out", previouslyConnected: true });
    advance(2 * MIN);
    await Promise.resolve();
    expect(onAlert).toHaveBeenCalledTimes(1);
  });

  describe("prévenir le client lui-même", () => {
    it("emails the client after 5 minutes, even when the owner was alerted earlier", () => {
      const monitor = make();
      monitor.handle("org-1", { status: "DISCONNECTED", reason: "logged_out", previouslyConnected: true });
      advance(2 * MIN);
      expect(onAlert).toHaveBeenCalledTimes(1);
      expect(onClientAlert).not.toHaveBeenCalled();
      advance(4 * MIN);
      expect(onClientAlert).toHaveBeenCalledTimes(1);
      expect(onClientAlert).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-1" }));
    });

    it("emails the client only once per outage, counted from the start of the outage", () => {
      const monitor = make();
      monitor.handle("org-1", { status: "DISCONNECTED", reason: "connection_lost", previouslyConnected: true });
      advance(3 * MIN);
      monitor.handle("org-1", { status: "QR_PENDING", previouslyConnected: true });
      advance(3 * MIN);
      expect(onClientAlert).toHaveBeenCalledTimes(1);
      advance(60 * MIN);
      expect(onClientAlert).toHaveBeenCalledTimes(1);
    });

    it("stays silent when the number reconnects before 5 minutes", () => {
      const monitor = make();
      monitor.handle("org-1", { status: "DISCONNECTED", reason: "connection_lost", previouslyConnected: true });
      advance(3 * MIN);
      monitor.handle("org-1", { status: "CONNECTED", previouslyConnected: true });
      advance(10 * MIN);
      expect(onClientAlert).not.toHaveBeenCalled();
      expect(onClientRecovered).not.toHaveBeenCalled();
    });

    it("never emails the client for a voluntary disconnection or a first connection", () => {
      const monitor = make();
      monitor.markIntentional("org-1");
      monitor.handle("org-1", { status: "DISCONNECTED", reason: "logged_out", previouslyConnected: true });
      monitor.handle("org-2", { status: "QR_PENDING", previouslyConnected: false });
      advance(60 * MIN);
      expect(onClientAlert).not.toHaveBeenCalled();
    });

    it("cancels a pending client email when the disconnection becomes voluntary", () => {
      const monitor = make();
      monitor.handle("org-1", { status: "DISCONNECTED", reason: "connection_lost", previouslyConnected: true });
      advance(MIN);
      monitor.markIntentional("org-1");
      advance(60 * MIN);
      expect(onClientAlert).not.toHaveBeenCalled();
    });

    it("tells the client when the number is back, only if they had been warned", () => {
      const monitor = make();
      monitor.handle("org-1", { status: "DISCONNECTED", reason: "connection_lost", previouslyConnected: true });
      advance(8 * MIN);
      monitor.handle("org-1", { status: "CONNECTED", previouslyConnected: true });
      expect(onClientRecovered).toHaveBeenCalledTimes(1);
      expect(onClientRecovered).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-1" }), 8 * MIN);
    });

    it("warns the client again for a later outage", () => {
      const monitor = make();
      for (let i = 0; i < 2; i += 1) {
        monitor.handle("org-1", { status: "DISCONNECTED", reason: "connection_lost", previouslyConnected: true });
        advance(6 * MIN);
        monitor.handle("org-1", { status: "CONNECTED", previouslyConnected: true });
      }
      expect(onClientAlert).toHaveBeenCalledTimes(2);
    });
  });
});
