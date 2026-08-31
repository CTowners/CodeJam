import { copyFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * The only way files move between Agents. A per-Job staging area that Agent
 * workspaces never see directly: `copyIn` stages -> workspace before a turn,
 * `copyOut` workspace -> staging after a turn passes verification. The staging
 * area persists past the Job (demo evidence); `clearWorkspaceCopies` is what
 * removes the temporary copies from an Agent's own workspace, called once at
 * Job completion/halt rather than after every Step, since a later Step may still
 * need them.
 *
 * `needs`/`produces` are model-drafted strings — `validatePlan` rejects an unsafe
 * one before a Job ever starts, but every path here is re-resolved and
 * bounds-checked again regardless, since this class runs in the Coordinator's own
 * host process, not inside the sandboxed Runtime container. A traversal that
 * slipped past validation would otherwise touch the real host filesystem.
 */
export class FileCourier {
  constructor(private readonly stagingDir: string) {}

  private resolveWithin(root: string, relativePath: string): string {
    const resolvedRoot = path.resolve(root);
    const resolved = path.resolve(resolvedRoot, relativePath);
    if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
      throw new Error(`Path "${relativePath}" escapes its intended root`);
    }
    return resolved;
  }

  private stagingPath(relativePath: string): string {
    return this.resolveWithin(this.stagingDir, relativePath);
  }

  async copyIn(relativePaths: readonly string[], workspaceDir: string): Promise<void> {
    for (const relativePath of relativePaths) {
      const destination = this.resolveWithin(workspaceDir, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(this.stagingPath(relativePath), destination);
    }
  }

  /** Null if every produces file exists and is non-empty; else the first problem, one line. */
  async verifyProduces(relativePaths: readonly string[], workspaceDir: string): Promise<string | null> {
    for (const relativePath of relativePaths) {
      let fullPath: string;
      try {
        fullPath = this.resolveWithin(workspaceDir, relativePath);
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
      let info;
      try {
        info = await stat(fullPath);
      } catch {
        return `missing produces file: ${relativePath}`;
      }
      if (!info.isFile() || info.size === 0) {
        return `empty produces file: ${relativePath}`;
      }
    }
    return null;
  }

  async copyOut(relativePaths: readonly string[], workspaceDir: string): Promise<void> {
    for (const relativePath of relativePaths) {
      const destination = this.stagingPath(relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(this.resolveWithin(workspaceDir, relativePath), destination);
    }
  }

  async clearWorkspaceCopies(relativePaths: Iterable<string>, workspaceDir: string): Promise<void> {
    for (const relativePath of relativePaths) {
      await rm(this.resolveWithin(workspaceDir, relativePath), { force: true });
    }
  }

  /** Test/bootstrap helper: place an externally-supplied input straight into staging. */
  async seed(relativePath: string, content: string): Promise<void> {
    const destination = this.stagingPath(relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content, "utf8");
  }
}
