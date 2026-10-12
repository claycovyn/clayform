import { describe, expect, it } from "vitest";
import { hashPassword, normalizeEmail, validEmail, verifyPassword } from "@/lib/auth";
import { isPrivateAddress, webhookBlocked } from "@/lib/netguard";

describe("passwords", () => {
  it("hashes with a random salt and verifies", async () => {
    const a = await hashPassword("correct horse battery");
    const b = await hashPassword("correct horse battery");
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery", a)).toBe(true);
    expect(await verifyPassword("correct horse batterY", a)).toBe(false);
    expect(await verifyPassword("anything", "plaintext")).toBe(false);
  });

  it("normalises and checks emails", () => {
    expect(normalizeEmail("  Ada@Example.COM ")).toBe("ada@example.com");
    expect(validEmail("ada@example.com")).toBe(true);
    expect(validEmail("ada@example")).toBe(false);
  });
});

describe("webhook guard", () => {
  it("flags private and special addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"])
      expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it("refuses private hosts and odd schemes", async () => {
    expect(await webhookBlocked("http://127.0.0.1:5432/")).toMatch(/private/);
    expect(await webhookBlocked("http://169.254.169.254/latest/meta-data")).toMatch(/private/);
    expect(await webhookBlocked("http://[::1]/")).toMatch(/private/);
    expect(await webhookBlocked("http://localhost:3000/")).toMatch(/private/);
    expect(await webhookBlocked("file:///etc/passwd")).toMatch(/http/);
    expect(await webhookBlocked("https://93.184.215.14/hook")).toBeNull();
  });
});
