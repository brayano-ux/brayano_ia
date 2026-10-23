import { describe, expect, it } from "vitest";
import { onboardingSteps } from "../../../dashboard/src/features/onboarding/progress.js";
const status = { profileComplete: false, testComplete: false, whatsappConnected: false, firstReplySent: false };
describe("onboarding presentation", () => {
  it("starts with the company information then the tester", () => {
    expect(onboardingSteps(status).find(step => !step.done).id).toBe("profile");
    expect(onboardingSteps({ ...status, profileComplete: true }).find(step => !step.done).id).toBe("test");
  });
  it("does not mark a real response complete merely because WhatsApp is connected", () => {
    const steps = onboardingSteps({ ...status, profileComplete: true, testComplete: true, whatsappConnected: true });
    expect(steps.filter(step => step.done)).toHaveLength(3);
    expect(steps.find(step => !step.done).id).toBe("first");
  });
  it("reports four completed steps when the server confirms them", () => {
    expect(onboardingSteps({ profileComplete: true, testComplete: true, whatsappConnected: true, firstReplySent: true }).every(step => step.done)).toBe(true);
  });
});
