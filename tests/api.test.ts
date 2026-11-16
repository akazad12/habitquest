import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../apps/api/src/app.js";
describe("API foundation", () => {
  const app = createApp();
  it("provides typed liveness and security headers", async () => {
    const response = await request(app).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", service: "habitquest-api" });
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });
  it("returns a consistent JSON 404", async () => {
    const response = await request(app).get("/api/missing");
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });
  it("handles malformed JSON centrally", async () => {
    const response = await request(app)
      .post("/api/missing")
      .set("Content-Type", "application/json")
      .send("{");
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("BAD_REQUEST");
    expect(response.body.error.stack).toBeUndefined();
  });
  it("allows only the configured browser origin", async () => {
    const response = await request(app)
      .get("/api/health")
      .set("Origin", "https://untrusted.example");
    expect(response.headers["access-control-allow-origin"]).toBe(
      "http://localhost:5173",
    );
  });
});
