import { describe, expect, it } from "vitest";
import { isPublicRoute } from "./public-route.js";

describe("public routes", () => {
  it("allows signed product image paths so img elements can fetch them without bearer headers", () => {
    expect(isPublicRoute("/media/products/123e4567-e89b-12d3-a456-426614174000/123e4567-e89b-12d3-a456-426614174001.webp?t=123:signature"))
      .toBe(true);
  });

  it("allows signed client media paths but nothing else under /media/client", () => {
    expect(isPublicRoute("/media/client/123e4567-e89b-12d3-a456-426614174000/123e4567-e89b-12d3-a456-426614174001.jpg?t=123:signature")).toBe(true);
    expect(isPublicRoute("/media/client/123e4567-e89b-12d3-a456-426614174000/../secret.jpg")).toBe(false);
    expect(isPublicRoute("/media/client/invalid/file.jpg")).toBe(false);
  });

  it("exposes the anonymous landing-view counter, nothing else under /analytics", () => {
    expect(isPublicRoute("/analytics/landing-view")).toBe(true);
    expect(isPublicRoute("/analytics/landing-view/other")).toBe(false);
    expect(isPublicRoute("/analytics/anything-else")).toBe(false);
  });

  it("leaves /admin routes to their own platform token check", () => {
    expect(isPublicRoute("/admin/organizations")).toBe(true);
    expect(isPublicRoute("/administrator")).toBe(false);
  });

  it("does not make other media paths public", () => {
    expect(isPublicRoute("/media/products/invalid/product.webp?t=123:signature")).toBe(false);
    expect(isPublicRoute("/media/other/file.webp")).toBe(false);
    expect(isPublicRoute("/organizations/org-id/products")).toBe(false);
  });
});
