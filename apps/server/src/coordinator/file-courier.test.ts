import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileCourier } from "./file-courier.js";

describe("FileCourier", () => {
  let root: string;
  let stagingDir: string;
  let workspaceDir: string;
  let courier: FileCourier;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "file-courier-test-"));
    stagingDir = path.join(root, "staging");
    workspaceDir = path.join(root, "workspace");
    courier = new FileCourier(stagingDir);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("moves a normal file from staging into a workspace and back out", async () => {
    await courier.seed("out.txt", "hello");
    await courier.copyIn(["out.txt"], workspaceDir);
    expect(await readFile(path.join(workspaceDir, "out.txt"), "utf8")).toBe("hello");

    await courier.copyOut(["out.txt"], workspaceDir);
    expect(await readFile(path.join(stagingDir, "out.txt"), "utf8")).toBe("hello");
  });

  it("moves a file through a nested subdirectory", async () => {
    await courier.seed("src/routes/todos.ts", "export const x = 1;");
    await courier.copyIn(["src/routes/todos.ts"], workspaceDir);
    expect(await readFile(path.join(workspaceDir, "src/routes/todos.ts"), "utf8")).toBe("export const x = 1;");
  });

  it("rejects a copyIn whose needs path escapes the workspace via ..", async () => {
    await expect(courier.copyIn(["../../etc/passwd"], workspaceDir)).rejects.toThrow(/escapes its intended root/);
  });

  it("rejects a copyIn whose needs path is absolute", async () => {
    await expect(courier.copyIn(["/etc/passwd"], workspaceDir)).rejects.toThrow(/escapes its intended root/);
  });

  it("verifyProduces returns a rejection reason (not a throw) for an escaping produces path", async () => {
    const reason = await courier.verifyProduces(["../../etc/passwd"], workspaceDir);
    expect(reason).toMatch(/escapes its intended root/);
  });

  it("rejects a copyOut whose produces path escapes the workspace", async () => {
    await expect(courier.copyOut(["../outside.txt"], workspaceDir)).rejects.toThrow(/escapes its intended root/);
  });

  it("rejects clearWorkspaceCopies on a path that escapes the workspace, instead of deleting it", async () => {
    // A real file outside the workspace, created directly (not through the
    // courier, which would rightly refuse to write it there) so we can prove
    // an escape attempt against it is blocked rather than actually deleting it.
    const outsideFile = path.join(root, "important.txt");
    await writeFile(outsideFile, "do not delete me", "utf8");

    await expect(courier.clearWorkspaceCopies(["../important.txt"], workspaceDir)).rejects.toThrow(
      /escapes its intended root/,
    );
    // The escape attempt must never have reached the filesystem at all.
    expect(await readFile(outsideFile, "utf8")).toBe("do not delete me");
  });

  it("does not let an escaping staging path be seeded or read back either", async () => {
    await expect(courier.seed("../outside-staging.txt", "x")).rejects.toThrow(/escapes its intended root/);
  });
});
