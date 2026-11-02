import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { tempDir } from "./temp-dirs.js";
import { clearConfigCache } from "../scripts/autonomous-config.mjs";
import {
  collectArchitectureScope,
  evaluateDocumentation,
  isTextSourcePath,
  normalizeLineEndings,
  renderDocumentationReminder,
  stampDocument,
  validateArchiveManifest,
  validateDocumentationPath,
} from "../scripts/documentation.mjs";

const CONFIG = {
  schemaVersion: 1,
  project: { name: "Fixture" },
  tasks: { idPrefix: "TASK", idDigits: 3 },
  documentation: {
    statusDocument: "docs/project/status.html",
    architectureDocument: "docs/project/architecture.html",
    stampMarker: "harness-doc-state",
    guidancePaths: ["AGENTS.md"],
    architectureScopes: [
      { id: "code", directories: [{ path: "src", extensions: [".js"] }] },
      { id: "boundary", paths: ["package.json"] },
    ],
  },
};

function write(root, path, contents) {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents, "utf8");
  return absolute;
}

/** A minimal project the documentation checker can evaluate end to end. */
function project() {
  clearConfigCache();
  const root = tempDir("autonomous-doc-");
  write(root, "autonomous.config.json", JSON.stringify(CONFIG, null, 2));
  write(root, "AGENTS.md", "# Rules\n");
  write(root, "package.json", '{ "name": "fixture" }\n');
  write(root, "src/app.js", "export const answer = 42;\n");
  write(root, "src/notes.txt", "not part of the scope\n");
  write(
    root,
    "work/items/TASK-001.json",
    JSON.stringify({ id: "TASK-001", title: "t", status: "in_progress" }, null, 2),
  );
  write(root, "docs/project/status.html", "<h1>Status</h1>\n");
  write(root, "docs/project/architecture.html", "<h1>Architecture</h1>\n");
  return root;
}

describe("line endings and paths", () => {
  it("normalizes CRLF and lone CR so a stamp survives a platform change", () => {
    expect(normalizeLineEndings("a\r\nb\rc").toString()).toBe("a\nb\nc");
    expect(normalizeLineEndings("a\nb").toString()).toBe("a\nb");
  });

  it("keeps binary sources byte-exact", () => {
    expect(isTextSourcePath("docs/a.md")).toBe(true);
    expect(isTextSourcePath("assets/tone.wav")).toBe(false);
  });

  it("refuses an unsafe source path", () => {
    expect(() => validateDocumentationPath("../escape.md")).toThrow(/unsafe/);
    // A leading slash is absolute on every platform; a drive letter is not.
    expect(() => validateDocumentationPath("/absolute.md")).toThrow(/repository-relative/);
  });
});

describe("architecture scope", () => {
  it("selects only the configured extensions", () => {
    const root = project();
    const scope = collectArchitectureScope(root);
    const code = scope.groups.find((group) => group.id === "code");
    expect(code.files.map((file) => file.path)).toEqual(["src/app.js"]);
  });

  it("refuses a path claimed by two scopes", () => {
    const root = project();
    write(
      root,
      "autonomous.config.json",
      JSON.stringify({
        ...CONFIG,
        documentation: {
          ...CONFIG.documentation,
          architectureScopes: [
            { id: "a", paths: ["package.json"] },
            { id: "b", paths: ["package.json"] },
          ],
        },
      }),
    );
    clearConfigCache();
    expect(() => collectArchitectureScope(root)).toThrow(/matched architecture scopes/);
    clearConfigCache();
  });
});

describe("stamping", () => {
  it("reports an unstamped document as invalid, then fresh once stamped", () => {
    const root = project();
    expect(evaluateDocumentation(root).valid).toBe(false);
    stampDocument(root, "architecture");
    stampDocument(root, "status");
    const report = evaluateDocumentation(root);
    expect(report.valid).toBe(true);
    expect(report.due).toBe(false);
    expect(report.exitCode).toBe(0);
  });

  it("is idempotent: restamping an already-stamped document keeps one stamp line", () => {
    const root = project();
    stampDocument(root, "architecture");
    stampDocument(root, "architecture");
    const lines = readFileSync(join(root, "docs/project/architecture.html"), "utf8").split("\n");
    expect(lines[0]).toMatch(/^<!-- harness-doc-state: /);
    expect(lines[1]).toBe("<h1>Architecture</h1>");
  });

  it("marks the page review due when a scoped source changes", () => {
    const root = project();
    stampDocument(root, "architecture");
    stampDocument(root, "status");
    write(root, "src/app.js", "export const answer = 43;\n");
    const report = evaluateDocumentation(root);
    expect(report.due).toBe(true);
    expect(report.documents.architecture.reasons).toContain(
      "code sources changed after the recorded review",
    );
  });

  it("marks the page review due when its own prose changes", () => {
    const root = project();
    stampDocument(root, "architecture");
    const before = readFileSync(join(root, "docs/project/architecture.html"), "utf8");
    writeFileSync(
      join(root, "docs/project/architecture.html"),
      `${before}<p>new claim</p>\n`,
      "utf8",
    );
    const report = evaluateDocumentation(root);
    expect(report.documents.architecture.reasons).toContain(
      "document body changed after the recorded review",
    );
  });

  it("reads a stamp under the marker's old name, and restamps it under the configured one", () => {
    const root = project();
    stampDocument(root, "architecture");
    stampDocument(root, "status");
    // The fixture stamps under the old name; a config naming the new one still reads them.
    write(
      root,
      "autonomous.config.json",
      JSON.stringify({
        ...CONFIG,
        documentation: { ...CONFIG.documentation, stampMarker: "autonomous-doc-state" },
      }),
    );
    clearConfigCache();
    expect(evaluateDocumentation(root)).toMatchObject({ valid: true, due: false });
    expect(stampDocument(root, "architecture")).toMatch(/^<!-- autonomous-doc-state: /);
    const lines = readFileSync(join(root, "docs/project/architecture.html"), "utf8").split("\n");
    expect(lines[1]).toBe("<h1>Architecture</h1>");
    clearConfigCache();
  });

  it("uses the configured stamp marker", () => {
    const root = project();
    write(
      root,
      "autonomous.config.json",
      JSON.stringify({
        ...CONFIG,
        documentation: { ...CONFIG.documentation, stampMarker: "my-marker" },
      }),
    );
    clearConfigCache();
    const line = stampDocument(root, "architecture");
    expect(line.startsWith("<!-- my-marker: ")).toBe(true);
    clearConfigCache();
  });

  it("keeps the dashboard fresh while the checkpoint and open items change", () => {
    const root = project();
    stampDocument(root, "architecture");
    stampDocument(root, "status");
    write(root, "work/CHECKPOINT.md", "# Checkpoint\n\n## Queue\n\n| TASK-001 | | | |\n");
    write(
      root,
      "work/items/TASK-001.json",
      JSON.stringify({ id: "TASK-001", title: "t", status: "review", owner: "worker" }),
    );
    expect(evaluateDocumentation(root).documents.status.due).toBe(false);
  });

  it("makes the dashboard due when an item is accepted", () => {
    const root = project();
    stampDocument(root, "architecture");
    stampDocument(root, "status");
    write(
      root,
      "work/items/TASK-001.json",
      JSON.stringify({ id: "TASK-001", title: "t", status: "done" }),
    );
    const report = evaluateDocumentation(root);
    expect(report.documents.status.due).toBe(true);
    expect(report.documents.status.reasons).toContain(
      "accepted-tasks sources changed after the recorded review",
    );
  });

  it("renders a reminder only while something is due", () => {
    const root = project();
    expect(renderDocumentationReminder(evaluateDocumentation(root))).toContain("Documentation");
    stampDocument(root, "architecture");
    stampDocument(root, "status");
    expect(renderDocumentationReminder(evaluateDocumentation(root))).toBe("");
  });
});

describe("document archive", () => {
  it("treats a project with no archive as valid", () => {
    expect(validateArchiveManifest(project())).toMatchObject({ valid: true, entries: [] });
  });

  it("accepts an entry whose preserved bytes still hash correctly", () => {
    const root = project();
    const body = "# Retired\n";
    write(root, "docs/archive/2026-01-01/old.md", body);
    write(root, ".gitattributes", "docs/archive/2026-01-01/old.md -text -diff\n");
    write(
      root,
      "docs/archive/manifest.json",
      JSON.stringify({
        schemaVersion: 1,
        entries: [
          {
            originalPath: "docs/old.md",
            archivePath: "docs/archive/2026-01-01/old.md",
            supersededBy: "docs/project/architecture.html",
            reason: "folded into the architecture page",
            archivedAt: "2026-01-01T00:00:00Z",
            restorationNotes: "reference only",
            sha256: `sha256:${createHash("sha256").update(body).digest("hex")}`,
            bytes: Buffer.byteLength(body, "utf8"),
          },
        ],
      }),
    );
    expect(validateArchiveManifest(root).reasons).toEqual([]);
  });

  it("detects an edited archive copy and a missing gitattributes rule", () => {
    const root = project();
    write(root, "docs/archive/2026-01-01/old.md", "# Edited\n");
    write(root, ".gitattributes", "* text=auto\n");
    write(
      root,
      "docs/archive/manifest.json",
      JSON.stringify({
        schemaVersion: 1,
        entries: [
          {
            originalPath: "docs/old.md",
            archivePath: "docs/archive/2026-01-01/old.md",
            supersededBy: "docs/project/architecture.html",
            reason: "r",
            archivedAt: "2026-01-01T00:00:00Z",
            restorationNotes: "n",
            sha256: `sha256:${"0".repeat(64)}`,
            bytes: 9,
          },
        ],
      }),
    );
    const result = validateArchiveManifest(root);
    expect(result.valid).toBe(false);
    expect(result.reasons.join(" ")).toContain("SHA-256 does not match");
    expect(result.reasons.join(" ")).toContain("-text -diff");
  });

  it("refuses to leave the original in place beside its archive copy", () => {
    const root = project();
    const body = "# Retired\n";
    write(root, "docs/old.md", body);
    write(root, "docs/archive/2026-01-01/old.md", body);
    write(
      root,
      "docs/archive/manifest.json",
      JSON.stringify({
        schemaVersion: 1,
        entries: [
          {
            originalPath: "docs/old.md",
            archivePath: "docs/archive/2026-01-01/old.md",
            supersededBy: "docs/project/architecture.html",
            reason: "r",
            archivedAt: "2026-01-01T00:00:00Z",
            restorationNotes: "n",
            sha256: `sha256:${createHash("sha256").update(body).digest("hex")}`,
            bytes: Buffer.byteLength(body, "utf8"),
          },
        ],
      }),
    );
    expect(validateArchiveManifest(root).reasons.join(" ")).toContain(
      "still exists as a duplicate live document",
    );
  });
});
