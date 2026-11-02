// Documentation freshness: a living document carries a stamp of the exact
// sources it was written against, so "is this page still true?" is a check
// rather than a memory.
//
// Two documents are tracked by default — the owner dashboard (`status`) and the
// architecture page — and both are configured in `autonomous.config.json`. Each
// carries a first-line HTML comment holding the fingerprints of its source
// scope. When a source changes, the fingerprint no longer matches and the
// document is reported as review due. Nothing is rewritten automatically: a
// human or an agent updates the prose and then restamps.
//
// The file reading here is deliberately paranoid — no symlinks, no reparse
// points, no hard links, identity rechecked after the read — because a
// fingerprint that can be fooled is worse than no fingerprint.

import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  lstatSync,
  opendirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  DEFAULT_CONFIG,
  LEGACY_STAMP_MARKERS,
  PACKAGE_NOTE,
  isKitPackage,
  loadConfig,
  taskIdPattern,
  withCounterparts,
} from "./autonomous-config.mjs";

export const DOCUMENTATION_LIMITS = Object.freeze({
  maxDirectoryEntries: 4_096,
  maxFiles: 512,
  maxStatusFiles: 4_096,
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalBytes: 16 * 1024 * 1024,
  maxPathBytes: 512,
  maxReminderBytes: 900,
});

export const ARCHIVE_MANIFEST_PATH = "docs/archive/manifest.json";
export const ARCHIVE_ATTRIBUTES_PATH = ".gitattributes";

const REPOSITORY_ROOT = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const METADATA_SUFFIX = " -->";
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const GIT_BLOB_IDENTITY_PATTERN = /^sha1:[a-f0-9]{40}$/;
const PROVISIONAL_FINGERPRINT = "pending";

/**
 * How a stamp line starts: first under the configured marker, which a restamp
 * writes, then under that marker's old or new name, which a check still reads.
 */
function metadataPrefixes(config) {
  const marker = config.documentation?.stampMarker ?? DEFAULT_CONFIG.documentation.stampMarker;
  return withCounterparts([marker], LEGACY_STAMP_MARKERS).map((name) => `<!-- ${name}: `);
}

function stampPrefix(line, prefixes) {
  return prefixes.find((prefix) => line.startsWith(prefix) && line.endsWith(METADATA_SUFFIX));
}

/** The documents this project stamps, in stable order. */
export function documentDefinitions(config = loadConfig()) {
  return Object.freeze({
    status: Object.freeze({
      path: config.documentation?.statusDocument ?? "docs/project/status.html",
      scope: "status-v2",
    }),
    architecture: Object.freeze({
      path: config.documentation?.architectureDocument ?? "docs/project/architecture.html",
      scope: "architecture-v1",
    }),
  });
}

export function sameDocumentationIdentity(left, right) {
  return (
    typeof left?.dev === "bigint" &&
    typeof left?.ino === "bigint" &&
    typeof right?.dev === "bigint" &&
    typeof right?.ino === "bigint" &&
    left.dev !== 0n &&
    left.ino !== 0n &&
    left.dev === right.dev &&
    left.ino === right.ino
  );
}

function hasDocumentationIdentity(stat) {
  return sameDocumentationIdentity(stat, stat);
}

class DocumentationSafetyError extends Error {
  constructor(message, code = "EUNSAFE") {
    super(message);
    this.name = "DocumentationSafetyError";
    this.code = code;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function taggedSha256(value) {
  return `sha256:${sha256(value)}`;
}

/**
 * Paths whose bytes Git may rewrite when checking out. On Windows with
 * `core.autocrlf=true` these arrive as CRLF; CI checks the same commit out as
 * LF. Hashing the raw bytes would therefore produce a different fingerprint per
 * platform, so a document stamped on Windows would always read as review due on
 * Linux and the reverse. Archived sources are excluded by `.gitattributes`
 * (`-text`), stay byte-identical everywhere, and keep their byte-exact hashes.
 */
const BINARY_SOURCE_EXTENSION_RE =
  /\.(?:wav|mp3|m4a|ogg|flac|png|jpe?g|gif|webp|ico|bmp|tiff?|pdf|zip|gz|tgz|bz2|xz|7z|rar|woff2?|ttf|otf|eot|exe|dll|so|dylib|node|wasm|bin|db|sqlite3?|class|jar|pyc)$/i;

export function isTextSourcePath(path) {
  return !BINARY_SOURCE_EXTENSION_RE.test(String(path || ""));
}

/**
 * Collapse CRLF and lone CR to LF. CR and LF never appear inside a multi-byte
 * UTF-8 sequence, so operating on bytes is safe for any UTF-8 text.
 */
export function normalizeLineEndings(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
  if (!bytes.includes(0x0d)) return bytes;
  const out = Buffer.allocUnsafe(bytes.length);
  let length = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    if (byte === 0x0d) {
      if (bytes[index + 1] === 0x0a) continue;
      out[length] = 0x0a;
      length += 1;
      continue;
    }
    out[length] = byte;
    length += 1;
  }
  return out.subarray(0, length);
}

function fingerprintBytes(path, bytes) {
  return isTextSourcePath(path) ? normalizeLineEndings(bytes) : bytes;
}

function gitBlobIdentity(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return `sha1:${createHash("sha1")
    .update(Buffer.from(`blob ${bytes.byteLength}\0`, "utf8"))
    .update(bytes)
    .digest("hex")}`;
}

function codeUnitSort(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isUnsafeControl(character) {
  const codePoint = character.codePointAt(0);
  return (
    codePoint <= 31 ||
    codePoint === 127 ||
    (codePoint >= 128 && codePoint <= 159) ||
    codePoint === 0x2028 ||
    codePoint === 0x2029
  );
}

const UNEXPECTED_FORMAT_CONTROL = /\p{Cf}/u;

function safeDisplayCharacter(character) {
  const codePoint = character.codePointAt(0);
  return codePoint <= 31 ||
    (codePoint >= 127 && codePoint <= 159) ||
    codePoint === 0x2028 ||
    codePoint === 0x2029 ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
    UNEXPECTED_FORMAT_CONTROL.test(character)
    ? " "
    : character;
}

function normalizedPath(value) {
  if (typeof value !== "string" || !value) {
    throw new DocumentationSafetyError("source paths must be non-empty repository-relative paths");
  }
  if (Array.from(value).some(isUnsafeControl)) {
    throw new DocumentationSafetyError("source paths must not contain ASCII controls or DEL");
  }
  if (isAbsolute(value)) {
    throw new DocumentationSafetyError("source paths must be non-empty repository-relative paths");
  }
  const normalized = value.replaceAll("\\", "/");
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new DocumentationSafetyError(`unsafe repository-relative path: ${value}`);
  }
  if (Buffer.byteLength(normalized) > DOCUMENTATION_LIMITS.maxPathBytes) {
    throw new DocumentationSafetyError(
      `source path exceeds ${DOCUMENTATION_LIMITS.maxPathBytes} bytes: ${normalized}`,
      "ETOOBIG",
    );
  }
  return normalized;
}

export function validateDocumentationPath(value) {
  return normalizedPath(value);
}

/**
 * Resolve the root the way the identity checks below will resolve every path
 * under it. On Windows that means the native realpath: a temporary directory or
 * a mapped drive can arrive as an 8.3 short name, and comparing a short-name
 * root against a long-name child looks exactly like a reparse point.
 */
function canonicalRoot(root) {
  return nativeRealpath(resolve(root));
}

function nativeRealpath(path) {
  return typeof realpathSync.native === "function" ? realpathSync.native(path) : realpathSync(path);
}

function sameWindowsPath(left, right) {
  return resolve(left).toLocaleLowerCase("en-US") === resolve(right).toLocaleLowerCase("en-US");
}

function assertContained(root, absolute, label) {
  const fromRoot = relative(root, absolute);
  if (!fromRoot || fromRoot.startsWith(`..${sep}`) || fromRoot === ".." || isAbsolute(fromRoot)) {
    throw new DocumentationSafetyError(`${label} resolved outside the repository`);
  }
}

function captureWindowsDirectoryChain(root, directory, label) {
  if (process.platform !== "win32") return [];
  const base = resolve(root);
  const target = resolve(directory);
  if (!sameWindowsPath(base, target)) assertContained(base, target, label);
  const parts = sameWindowsPath(base, target)
    ? []
    : relative(base, target).split(/[\\/]/).filter(Boolean);
  const identities = [];
  let current = base;
  for (const part of [null, ...parts]) {
    if (part !== null) current = join(current, part);
    const stat = lstatSync(current, { bigint: true });
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new DocumentationSafetyError(`${label}: reparse-point directory paths are refused`);
    }
    if (!hasDocumentationIdentity(stat)) {
      throw new DocumentationSafetyError(`${label}: directory identity is unavailable`);
    }
    const resolved = nativeRealpath(current);
    if (!sameWindowsPath(base, current)) assertContained(base, resolved, label);
    if (!sameWindowsPath(current, resolved)) {
      throw new DocumentationSafetyError(`${label}: reparse-point directory paths are refused`);
    }
    identities.push({ path: current, dev: stat.dev, ino: stat.ino });
  }
  return identities;
}

function recheckWindowsDirectoryChain(root, identities, label) {
  for (const identity of identities) {
    const stat = lstatSync(identity.path, { bigint: true });
    if (
      stat.isSymbolicLink() ||
      !stat.isDirectory() ||
      stat.dev !== identity.dev ||
      stat.ino !== identity.ino
    ) {
      throw new DocumentationSafetyError(`${label}: directory identity changed while being read`);
    }
    const resolved = nativeRealpath(identity.path);
    if (!sameWindowsPath(root, identity.path)) assertContained(root, resolved, label);
    if (!sameWindowsPath(identity.path, resolved)) {
      throw new DocumentationSafetyError(`${label}: reparse-point directory paths are refused`);
    }
  }
}

function verifySourcePathMatchesDescriptor(root, absolute, path, descriptor, phase) {
  const pathIdentity = lstatSync(absolute, { bigint: true });
  const descriptorIdentity = fstatSync(descriptor, { bigint: true });
  if (pathIdentity.isSymbolicLink() || !pathIdentity.isFile() || !descriptorIdentity.isFile()) {
    throw new DocumentationSafetyError(`${path}: expected a real file ${phase}`);
  }
  if (pathIdentity.nlink !== 1n || descriptorIdentity.nlink !== 1n) {
    throw new DocumentationSafetyError(`${path}: multiply linked files are refused`);
  }
  if (!sameDocumentationIdentity(pathIdentity, descriptorIdentity)) {
    throw new DocumentationSafetyError(`${path}: source identity changed ${phase}`, "ECHANGED");
  }
  const resolved = nativeRealpath(absolute);
  assertContained(root, resolved, path);
  if (process.platform === "win32" && !sameWindowsPath(absolute, resolved)) {
    throw new DocumentationSafetyError(`${path}: reparse-point paths are refused`);
  }
  return descriptorIdentity;
}

function absoluteSourcePath(root, repositoryRelativePath) {
  const path = normalizedPath(repositoryRelativePath);
  const absolute = resolve(root, ...path.split("/"));
  assertContained(root, absolute, path);
  return { path, absolute };
}

function createBudget(maxFiles = DOCUMENTATION_LIMITS.maxFiles) {
  return { directoryEntries: 0, files: 0, bytes: 0, maxFiles };
}

function chargeFile(budget, path, bytes) {
  budget.files += 1;
  if (budget.files > budget.maxFiles) {
    throw new DocumentationSafetyError(
      `source scope exceeds ${budget.maxFiles} files at ${path}`,
      "ETOOBIG",
    );
  }
  if (bytes > DOCUMENTATION_LIMITS.maxFileBytes) {
    throw new DocumentationSafetyError(
      `${path} exceeds the ${DOCUMENTATION_LIMITS.maxFileBytes}-byte per-file limit`,
      "ETOOBIG",
    );
  }
  if (budget.bytes + bytes > DOCUMENTATION_LIMITS.maxTotalBytes) {
    throw new DocumentationSafetyError(
      `source scope exceeds the ${DOCUMENTATION_LIMITS.maxTotalBytes}-byte cumulative limit at ${path}`,
      "ETOOBIG",
    );
  }
  budget.bytes += bytes;
}

function readExactDescriptor(descriptor, expectedBytes) {
  const output = Buffer.alloc(expectedBytes + 1);
  let offset = 0;
  while (offset < output.length) {
    const count = readSync(descriptor, output, offset, output.length - offset, null);
    if (count === 0) break;
    offset += count;
  }
  if (offset !== expectedBytes) {
    throw new DocumentationSafetyError("source changed size while being read", "ECHANGED");
  }
  return output.subarray(0, offset);
}

function readSource(root, repositoryRelativePath, budget) {
  const { path, absolute } = absoluteSourcePath(root, repositoryRelativePath);
  let descriptor;
  try {
    const directoryChain = captureWindowsDirectoryChain(root, dirname(absolute), path);
    const noFollow = Number.isInteger(fsConstants.O_NOFOLLOW) ? fsConstants.O_NOFOLLOW : 0;
    descriptor = openSync(absolute, fsConstants.O_RDONLY | noFollow);
    const before = fstatSync(descriptor);
    const beforeIdentity = verifySourcePathMatchesDescriptor(
      root,
      absolute,
      path,
      descriptor,
      "before it was read",
    );
    chargeFile(budget, path, before.size);
    const bytes = readExactDescriptor(descriptor, before.size);
    const after = fstatSync(descriptor);
    recheckWindowsDirectoryChain(root, directoryChain, path);
    const afterIdentity = verifySourcePathMatchesDescriptor(
      root,
      absolute,
      path,
      descriptor,
      "after it was read",
    );
    if (
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      !sameDocumentationIdentity(afterIdentity, beforeIdentity) ||
      afterIdentity.nlink !== 1n
    ) {
      throw new DocumentationSafetyError(`${path}: source changed while being read`, "ECHANGED");
    }
    const fingerprinted = fingerprintBytes(path, bytes);
    return {
      path,
      bytes,
      // Raw values stay available for the byte-exact archive preservation check.
      rawByteLength: bytes.length,
      rawSha256: sha256(bytes),
      byteLength: fingerprinted.length,
      sha256: sha256(fingerprinted),
    };
  } catch (error) {
    if (error instanceof DocumentationSafetyError) throw error;
    const code = typeof error?.code === "string" ? ` (${error.code})` : "";
    throw new DocumentationSafetyError(`${path}: unreadable${code}`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function inspectDirectory(root, repositoryRelativePath, budget, { optional = false } = {}) {
  const { path, absolute } = absoluteSourcePath(root, repositoryRelativePath);
  let directory;
  try {
    const stat = lstatSync(absolute);
    const identity = lstatSync(absolute, { bigint: true });
    if (stat.isSymbolicLink()) {
      throw new DocumentationSafetyError(`${path}: symbolic-link directories are refused`);
    }
    if (!stat.isDirectory()) {
      throw new DocumentationSafetyError(`${path}: expected a real directory`);
    }
    assertContained(root, realpathSync(absolute), path);
    directory = opendirSync(absolute);
    const current = lstatSync(absolute);
    const currentIdentity = lstatSync(absolute, { bigint: true });
    if (
      current.isSymbolicLink() ||
      !current.isDirectory() ||
      !sameDocumentationIdentity(currentIdentity, identity)
    ) {
      throw new DocumentationSafetyError(`${path}: directory identity changed during enumeration`);
    }
    assertContained(root, realpathSync(absolute), path);
    const entries = [];
    for (;;) {
      const entry = directory.readSync();
      if (!entry) break;
      budget.directoryEntries += 1;
      if (budget.directoryEntries > DOCUMENTATION_LIMITS.maxDirectoryEntries) {
        throw new DocumentationSafetyError(
          `source enumeration exceeds ${DOCUMENTATION_LIMITS.maxDirectoryEntries} directory entries`,
          "ETOOBIG",
        );
      }
      entries.push(entry);
    }
    return entries.sort((left, right) => codeUnitSort(left.name, right.name));
  } catch (error) {
    if (optional && error?.code === "ENOENT") return [];
    if (error instanceof DocumentationSafetyError) throw error;
    const code = typeof error?.code === "string" ? ` (${error.code})` : "";
    throw new DocumentationSafetyError(`${path}: directory is unreadable${code}`);
  } finally {
    directory?.closeSync();
  }
}

function walkFiles(
  root,
  repositoryRelativePath,
  budget,
  { optional = false, recursive = true, prune = () => false } = {},
) {
  const files = [];
  const visit = (directoryPath, allowMissing) => {
    const entries = inspectDirectory(root, directoryPath, budget, { optional: allowMissing });
    for (const entry of entries) {
      if (prune(entry.name, directoryPath)) continue;
      const path = normalizedPath(`${directoryPath}/${entry.name}`);
      if (entry.isSymbolicLink()) {
        throw new DocumentationSafetyError(`${path}: symbolic links are refused`);
      }
      if (entry.isDirectory()) {
        if (recursive) visit(path, false);
        continue;
      }
      if (entry.isFile()) files.push(path);
      else throw new DocumentationSafetyError(`${path}: non-regular source entry is refused`);
    }
  };
  visit(normalizedPath(repositoryRelativePath), optional);
  return files.sort(codeUnitSort);
}

function sourceRecord(source) {
  return [source.path, source.byteLength, source.sha256.toLowerCase()];
}

function virtualSource(path, value) {
  const bytes = Buffer.from(typeof value === "string" ? value : JSON.stringify(value), "utf8");
  const fingerprinted = normalizeLineEndings(bytes);
  return {
    path,
    bytes,
    rawByteLength: bytes.length,
    rawSha256: sha256(bytes),
    byteLength: fingerprinted.length,
    sha256: sha256(fingerprinted),
  };
}

function fingerprintGroup(id, sources) {
  const files = [...sources].sort((left, right) => codeUnitSort(left.path, right.path));
  const duplicateCheck = new Set();
  for (const source of files) {
    const key = source.path.toLowerCase();
    if (duplicateCheck.has(key)) {
      throw new DocumentationSafetyError(`duplicate or case-colliding source path: ${source.path}`);
    }
    duplicateCheck.add(key);
  }
  const payload = { id, files: files.map(sourceRecord) };
  return { id, files, fingerprint: taggedSha256(JSON.stringify(payload)) };
}

function fingerprintScope(scope, groupLabel, groups) {
  const componentFingerprints = Object.fromEntries(
    groups.map((group) => [group.id, group.fingerprint]),
  );
  const payload = {
    schemaVersion: 1,
    scope,
    [groupLabel]: groups.map((group) => [group.id, group.fingerprint]),
  };
  return {
    scope,
    fingerprint: taggedSha256(JSON.stringify(payload)),
    componentFingerprints,
    groups,
  };
}

/**
 * Resolve one configured architecture scope entry into repository-relative
 * paths. A scope is `{ id, paths?, directories? }`; a directory entry is
 * `{ path, extensions?, recursive?, optional? }`.
 */
function resolveScopePaths(root, scope, budget) {
  const paths = new Set();
  for (const path of Array.isArray(scope.paths) ? scope.paths : []) {
    if (existsSync(resolve(root, path))) paths.add(normalizedPath(path));
  }
  for (const directory of Array.isArray(scope.directories) ? scope.directories : []) {
    if (!directory || typeof directory.path !== "string") continue;
    const extensions = Array.isArray(directory.extensions)
      ? directory.extensions.map((value) => String(value).toLowerCase())
      : null;
    const found = walkFiles(root, directory.path, budget, {
      optional: directory.optional !== false,
      recursive: directory.recursive !== false,
      prune: (name) => name === "node_modules" || name === ".git",
    });
    for (const path of found) {
      if (extensions && !extensions.some((extension) => path.toLowerCase().endsWith(extension)))
        continue;
      paths.add(path);
    }
  }
  return [...paths].sort(codeUnitSort);
}

export function collectArchitectureScope(root = REPOSITORY_ROOT, { config = null } = {}) {
  const base = canonicalRoot(root);
  const resolvedConfig = config ?? loadConfig({ root: base });
  const budget = createBudget();
  const scopes = Array.isArray(resolvedConfig.documentation?.architectureScopes)
    ? resolvedConfig.documentation.architectureScopes
    : [];
  const seen = new Map();
  const groups = [];
  for (const scope of scopes) {
    if (!scope || typeof scope.id !== "string" || !scope.id.trim()) {
      throw new DocumentationSafetyError("every architecture scope needs an id");
    }
    const paths = resolveScopePaths(base, scope, budget);
    for (const path of paths) {
      const key = path.toLowerCase();
      if (seen.has(key) && seen.get(key) !== scope.id) {
        throw new DocumentationSafetyError(
          `${path} matched architecture scopes ${seen.get(key)} and ${scope.id}`,
        );
      }
      seen.set(key, scope.id);
    }
    groups.push(
      fingerprintGroup(
        scope.id,
        paths.map((path) => readSource(base, path, budget)),
      ),
    );
  }
  return {
    ...fingerprintScope("architecture-v1", "categories", groups),
    metrics: { ...budget },
  };
}

function parseJsonSource(source, purpose) {
  try {
    const value = JSON.parse(source.bytes.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("expected an object");
    }
    return value;
  } catch {
    throw new DocumentationSafetyError(`${source.path}: malformed ${purpose} JSON`);
  }
}

function validUtcTimestamp(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

/**
 * Validate the document archive: every entry names a preserved copy whose bytes
 * still hash to the recorded digest, the original is gone (unless the archive is
 * a versioned replacement of a document that still exists), and `.gitattributes`
 * keeps the archived bytes out of Git's line-ending conversion.
 *
 * A project with no archive yet is valid, not broken.
 */
export function validateArchiveManifest(root = REPOSITORY_ROOT) {
  const path = ARCHIVE_MANIFEST_PATH;
  try {
    const base = canonicalRoot(root);
    if (!existsSync(resolve(base, path))) {
      return { path, valid: true, due: false, reasons: [], entries: [] };
    }
    const budget = createBudget(DOCUMENTATION_LIMITS.maxFiles);
    const manifestSource = readSource(base, path, budget);
    const manifest = parseJsonSource(manifestSource, "archive manifest");
    const reasons = [];

    let attributeLines = [];
    if (existsSync(resolve(base, ARCHIVE_ATTRIBUTES_PATH))) {
      const attributesSource = readSource(base, ARCHIVE_ATTRIBUTES_PATH, budget);
      attributeLines = attributesSource.bytes
        .toString("utf8")
        .replaceAll("\r\n", "\n")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));
    }

    if (manifest.schemaVersion !== 1) reasons.push("archive manifest schemaVersion must be 1");
    if (!Array.isArray(manifest.entries)) {
      reasons.push("archive manifest entries must be an array");
    }
    const entries = Array.isArray(manifest.entries) ? manifest.entries : [];
    const seenOriginal = new Set();
    const validatedEntries = [];

    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        reasons.push("archive manifest entries must be objects");
        continue;
      }
      let originalPath;
      let archivePath;
      try {
        originalPath = normalizedPath(entry.originalPath);
        archivePath = normalizedPath(entry.archivePath);
      } catch (error) {
        reasons.push(error.message);
        continue;
      }
      if (seenOriginal.has(originalPath)) reasons.push(`archive manifest repeats ${originalPath}`);
      seenOriginal.add(originalPath);
      if (!archivePath.startsWith("docs/archive/")) {
        reasons.push(`${originalPath} archivePath must live under docs/archive/`);
      }
      if (typeof entry.supersededBy !== "string" || !entry.supersededBy.trim()) {
        reasons.push(`${originalPath} requires a supersededBy path`);
      }
      if (typeof entry.reason !== "string" || !entry.reason.trim()) {
        reasons.push(`${originalPath} requires a non-empty reason`);
      }
      if (!validUtcTimestamp(entry.archivedAt)) {
        reasons.push(`${originalPath} requires a valid archivedAt timestamp`);
      }
      if (typeof entry.restorationNotes !== "string" || !entry.restorationNotes.trim()) {
        reasons.push(`${originalPath} requires restorationNotes`);
      }
      if (!SHA256_PATTERN.test(entry.sha256)) {
        reasons.push(`${originalPath} requires a tagged lowercase SHA-256`);
      }
      if (
        entry.gitBlobIdentity !== undefined &&
        !GIT_BLOB_IDENTITY_PATTERN.test(entry.gitBlobIdentity)
      ) {
        reasons.push(`${originalPath} gitBlobIdentity must be a tagged Git blob identity`);
      }
      if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0) {
        reasons.push(`${originalPath} requires a non-negative safe byte count`);
      }
      const expectedAttribute = `${archivePath} -text -diff`;
      if (attributeLines.length && !attributeLines.includes(expectedAttribute)) {
        reasons.push(`${ARCHIVE_ATTRIBUTES_PATH} is missing the exact rule: ${expectedAttribute}`);
      }

      let archived;
      try {
        archived = readSource(base, archivePath, budget);
      } catch (error) {
        reasons.push(error.message);
        continue;
      }
      // Preservation is a byte-exact guarantee, so this uses the raw digest.
      const actualSha256 = `sha256:${archived.rawSha256}`;
      const actualGitBlobIdentity = gitBlobIdentity(archived.bytes);
      if (entry.sha256 !== actualSha256) {
        reasons.push(`${archivePath} SHA-256 does not match its archived bytes`);
      }
      if (entry.gitBlobIdentity !== undefined && entry.gitBlobIdentity !== actualGitBlobIdentity) {
        reasons.push(`${archivePath} Git blob identity does not match its archived bytes`);
      }
      if (entry.bytes !== archived.rawByteLength) {
        reasons.push(`${archivePath} byte count does not match its archived bytes`);
      }
      const original = absoluteSourcePath(base, originalPath);
      const isVersionedReplacement = entry.supersededBy === originalPath;
      if (existsSync(original.absolute) && !isVersionedReplacement) {
        reasons.push(`${originalPath} still exists as a duplicate live document`);
      }
      validatedEntries.push({
        originalPath,
        archivePath,
        supersededBy: entry.supersededBy,
        bytes: archived.rawByteLength,
        sha256: actualSha256,
        gitBlobIdentity: actualGitBlobIdentity,
      });
    }

    // Every docs/archive rule in .gitattributes must belong to a manifest entry.
    const declared = new Set(validatedEntries.map((entry) => `${entry.archivePath} -text -diff`));
    for (const line of attributeLines.filter((line) => line.startsWith("docs/archive/"))) {
      if (!declared.has(line)) {
        reasons.push(
          `${ARCHIVE_ATTRIBUTES_PATH} scopes ${line}, which no archive manifest entry declares`,
        );
      }
    }

    return {
      path,
      valid: reasons.length === 0,
      due: reasons.length > 0,
      reasons,
      entries: validatedEntries,
    };
  } catch (error) {
    return {
      path,
      valid: false,
      due: true,
      reasons: [error instanceof Error ? error.message : "archive manifest validation failed"],
      entries: [],
    };
  }
}

/**
 * Read every item, and keep the accepted (done) ones by id and title. A
 * documentation-only task never counts: accepting the restamp itself must not
 * make the page due again.
 */
function loadTaskCatalog(root, budget, taskPattern) {
  const entries = inspectDirectory(root, "work/items", budget);
  const taskFile = new RegExp(`${taskPattern.source.replace(/\$$/, "")}\\.json$`);
  const taskPaths = entries
    .filter((entry) => taskFile.test(entry.name))
    .map((entry) => {
      const path = normalizedPath(`work/items/${entry.name}`);
      if (entry.isSymbolicLink()) {
        throw new DocumentationSafetyError(`${path}: symbolic links are refused`);
      }
      if (!entry.isFile()) throw new DocumentationSafetyError(`${path}: expected a regular file`);
      return path;
    })
    .sort(codeUnitSort);
  if (!taskPaths.length) throw new DocumentationSafetyError("work/items has no canonical tasks");
  const documentationTaskIds = new Set();
  const acceptedTasks = [];
  for (const path of taskPaths) {
    const value = parseJsonSource(readSource(root, path, budget), "task");
    const expectedId = path.slice("work/items/".length, -".json".length);
    if (value.id !== expectedId || !taskPattern.test(value.id)) {
      throw new DocumentationSafetyError(`${path}: task ID must match its canonical filename`);
    }
    if (value.documentationOnly !== undefined && typeof value.documentationOnly !== "boolean") {
      throw new DocumentationSafetyError(`${path}: documentationOnly must be boolean when present`);
    }
    if (value.documentationOnly === true) documentationTaskIds.add(expectedId);
    else if (value.status === "done")
      acceptedTasks.push(
        virtualSource(path, {
          id: value.id,
          title: typeof value.title === "string" ? value.title : null,
        }),
      );
  }
  return { documentationTaskIds, acceptedTasks };
}

/**
 * What the owner dashboard is written against: the project guidance, the
 * implementation, and the accepted tasks. Day-to-day state (the checkpoint,
 * open items, receipts) is deliberately absent, so the page goes due only when
 * one of those three changes.
 */
export function collectStatusScope(
  root = REPOSITORY_ROOT,
  architecture = undefined,
  { config = null } = {},
) {
  const base = canonicalRoot(root);
  const resolvedConfig = config ?? loadConfig({ root: base });
  const taskPattern = taskIdPattern(resolvedConfig);
  const architectureScope =
    architecture || collectArchitectureScope(base, { config: resolvedConfig });
  const budget = createBudget(DOCUMENTATION_LIMITS.maxStatusFiles);
  const guidance = (resolvedConfig.documentation?.guidancePaths ?? [])
    .filter((path) => existsSync(resolve(base, path)))
    .map((path) => readSource(base, path, budget));
  const taskCatalog = loadTaskCatalog(base, budget, taskPattern);
  const groups = [
    fingerprintGroup("project-guidance", guidance),
    fingerprintGroup("implementation", [
      virtualSource("@architecture-v1", architectureScope.fingerprint),
    ]),
    fingerprintGroup("accepted-tasks", taskCatalog.acceptedTasks),
  ];
  return {
    ...fingerprintScope("status-v2", "components", groups),
    metrics: { ...budget },
    documentationTaskIds: [...taskCatalog.documentationTaskIds].sort(codeUnitSort),
  };
}

function splitDocumentSource(source) {
  const newlineIndex = source.bytes.indexOf(0x0a);
  if (newlineIndex === -1) {
    return {
      firstLine: source.bytes.toString("utf8").replace(/\r$/, ""),
      remainder: Buffer.alloc(0),
      complete: source.bytes,
    };
  }
  return {
    firstLine: source.bytes.subarray(0, newlineIndex).toString("utf8").replace(/\r$/, ""),
    remainder: source.bytes.subarray(newlineIndex + 1),
    complete: source.bytes,
  };
}

function parseDocumentMetadata(firstLine, definition, prefixes) {
  const prefix = stampPrefix(firstLine, prefixes);
  if (!prefix) {
    return {
      value: null,
      errors: [`the first line is missing the ${prefixes[0].trim()} metadata`],
    };
  }
  let value;
  try {
    value = JSON.parse(firstLine.slice(prefix.length, -METADATA_SUFFIX.length));
  } catch {
    return { value: null, errors: ["the first-line stamp metadata is malformed"] };
  }
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { value: null, errors: ["the first-line metadata must be a JSON object"] };
  }
  if (value.schemaVersion !== 1) errors.push("metadata schemaVersion must be 1");
  if (value.document !== definition.document) {
    errors.push(`metadata document must be ${definition.document}`);
  }
  if (value.sourceScope !== definition.scope) {
    errors.push(`metadata sourceScope must be ${definition.scope}`);
  }
  if (
    value.sourceFingerprint !== PROVISIONAL_FINGERPRINT &&
    !SHA256_PATTERN.test(value.sourceFingerprint)
  ) {
    errors.push(
      `metadata sourceFingerprint must be "${PROVISIONAL_FINGERPRINT}" or a lowercase tagged SHA-256 value`,
    );
  }
  if (
    value.documentFingerprint !== PROVISIONAL_FINGERPRINT &&
    !SHA256_PATTERN.test(value.documentFingerprint)
  ) {
    errors.push(
      `metadata documentFingerprint must be "${PROVISIONAL_FINGERPRINT}" or a lowercase tagged SHA-256 value`,
    );
  }
  if (
    !value.componentFingerprints ||
    typeof value.componentFingerprints !== "object" ||
    Array.isArray(value.componentFingerprints)
  ) {
    errors.push("metadata componentFingerprints must be an object");
  } else if (
    Object.values(value.componentFingerprints).some(
      (fingerprint) => fingerprint !== PROVISIONAL_FINGERPRINT && !SHA256_PATTERN.test(fingerprint),
    )
  ) {
    errors.push(
      `metadata componentFingerprints must contain "${PROVISIONAL_FINGERPRINT}" or lowercase tagged SHA-256 values`,
    );
  }
  if (
    typeof value.refreshedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value.refreshedAt) ||
    Number.isNaN(Date.parse(value.refreshedAt))
  ) {
    errors.push("metadata refreshedAt must be a valid UTC ISO timestamp");
  }
  return { value, errors };
}

function changedComponents(metadata, scope) {
  if (!metadata?.componentFingerprints || typeof metadata.componentFingerprints !== "object") {
    return [];
  }
  const expectedKeys = Object.keys(scope.componentFingerprints);
  const actualKeys = Object.keys(metadata.componentFingerprints).sort(codeUnitSort);
  if (JSON.stringify(actualKeys) !== JSON.stringify([...expectedKeys].sort(codeUnitSort))) {
    return expectedKeys;
  }
  return expectedKeys.filter(
    (key) => metadata.componentFingerprints[key] !== scope.componentFingerprints[key],
  );
}

function evaluateDocument(root, document, scope, config) {
  const definition = { document, ...documentDefinitions(config)[document] };
  const prefixes = metadataPrefixes(config);
  const budget = createBudget();
  let source;
  try {
    source = readSource(root, definition.path, budget);
  } catch (error) {
    return {
      document,
      path: definition.path,
      valid: false,
      due: true,
      reasons: [error.message],
      sourceFingerprint: scope.fingerprint,
      componentFingerprints: scope.componentFingerprints,
      documentFingerprint: null,
      metadata: null,
      expectedMetadata: null,
    };
  }
  const parts = splitDocumentSource(source);
  const metadataResult = parseDocumentMetadata(parts.firstLine, definition, prefixes);
  if (metadataResult.value?.componentFingerprints) {
    const actualKeys = Object.keys(metadataResult.value.componentFingerprints).sort(codeUnitSort);
    const expectedKeys = Object.keys(scope.componentFingerprints).sort(codeUnitSort);
    if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
      metadataResult.errors.push(
        "metadata componentFingerprints keys must exactly match the current source scope",
      );
    }
  }
  const body = metadataResult.errors.length ? parts.complete : parts.remainder;
  // The document is text and may be checked out CRLF on one platform and LF on
  // another, so its own body digest is normalized too.
  const documentFingerprint = taggedSha256(normalizeLineEndings(body));
  const expectedMetadata = {
    schemaVersion: 1,
    document,
    sourceScope: definition.scope,
    sourceFingerprint: scope.fingerprint,
    documentFingerprint,
    componentFingerprints: scope.componentFingerprints,
    refreshedAt: metadataResult.value?.refreshedAt || null,
  };
  if (metadataResult.errors.length) {
    return {
      document,
      path: definition.path,
      valid: false,
      due: true,
      reasons: metadataResult.errors,
      sourceFingerprint: scope.fingerprint,
      componentFingerprints: scope.componentFingerprints,
      documentFingerprint,
      metadata: metadataResult.value,
      expectedMetadata,
    };
  }
  const reasons = [];
  if (
    metadataResult.value.sourceFingerprint === PROVISIONAL_FINGERPRINT ||
    metadataResult.value.documentFingerprint === PROVISIONAL_FINGERPRINT ||
    Object.values(metadataResult.value.componentFingerprints).includes(PROVISIONAL_FINGERPRINT)
  ) {
    reasons.push("the stamp is provisional and requires review");
  }
  if (metadataResult.value.documentFingerprint !== documentFingerprint) {
    reasons.push("document body changed after the recorded review");
  }
  const changed = changedComponents(metadataResult.value, scope);
  for (const component of changed) {
    reasons.push(`${component} sources changed after the recorded review`);
  }
  if (metadataResult.value.sourceFingerprint !== scope.fingerprint && !changed.length) {
    reasons.push("the aggregate source fingerprint does not match current sources");
  }
  return {
    document,
    path: definition.path,
    valid: true,
    due: reasons.length > 0,
    reasons,
    sourceFingerprint: scope.fingerprint,
    componentFingerprints: scope.componentFingerprints,
    documentFingerprint,
    metadata: metadataResult.value,
    expectedMetadata,
  };
}

function flattenDisplayText(value, limit = 500) {
  let text;
  if (typeof value === "string") text = value;
  else if (["number", "boolean", "bigint"].includes(typeof value)) text = String(value);
  else text = "unavailable detail";
  const flattened = Array.from(text, (character) => safeDisplayCharacter(character))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return truncateUtf8(flattened || "unspecified detail", limit);
}

function invalidReport(message) {
  return {
    schemaVersion: 1,
    valid: false,
    due: true,
    exitCode: 2,
    reasons: [flattenDisplayText(message)],
    documents: {},
    companions: {},
    scopes: {},
  };
}

export function evaluateDocumentation(root = REPOSITORY_ROOT) {
  try {
    const base = canonicalRoot(root);
    const config = loadConfig({ root: base });
    const archive = validateArchiveManifest(base);
    const architecture = collectArchitectureScope(base, { config });
    const status = collectStatusScope(base, architecture, { config });
    const documents = {
      status: evaluateDocument(base, "status", status, config),
      architecture: evaluateDocument(base, "architecture", architecture, config),
    };
    const allResults = Object.values(documents);
    const valid = archive.valid && allResults.every((document) => document.valid);
    const due = !valid || allResults.some((document) => document.due);
    const reasons = [
      ...archive.reasons.map((reason) => `archive: ${reason}`),
      ...Object.values(documents).flatMap((document) =>
        document.reasons.map((reason) => `${document.document} HTML: ${reason}`),
      ),
    ];
    return {
      schemaVersion: 1,
      valid,
      due,
      exitCode: valid ? (due ? 1 : 0) : 2,
      reasons,
      documents,
      companions: {},
      archive,
      scopes: {
        status: {
          scope: status.scope,
          fingerprint: status.fingerprint,
          componentFingerprints: status.componentFingerprints,
          metrics: status.metrics,
        },
        architecture: {
          scope: architecture.scope,
          fingerprint: architecture.fingerprint,
          componentFingerprints: architecture.componentFingerprints,
          metrics: architecture.metrics,
        },
      },
    };
  } catch (error) {
    const message =
      error instanceof DocumentationSafetyError
        ? error.message
        : `documentation evaluation failed safely: ${error?.message || "unknown error"}`;
    return invalidReport(message);
  }
}

function utf8Prefix(text, limit) {
  if (Buffer.byteLength(text) <= limit) return text;
  const characters = Array.from(text);
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(characters.slice(0, middle).join("")) <= limit) low = middle;
    else high = middle - 1;
  }
  return characters.slice(0, low).join("");
}

function truncateUtf8(text, limit) {
  if (Buffer.byteLength(text) <= limit) return text;
  const suffix = "…";
  return `${utf8Prefix(text, Math.max(0, limit - Buffer.byteLength(suffix))).trimEnd()}${suffix}`;
}

export function renderDocumentationReminder(
  report,
  { audience = "coordinator", maxBytes = DOCUMENTATION_LIMITS.maxReminderBytes } = {},
) {
  if (!report?.due) return "";
  const state = report.valid ? "review due" : "check invalid";
  const paths = Object.values(report.documents || {})
    .filter((document) => document?.due)
    .map((document) => flattenDisplayText(document.path, 180))
    .concat(report.archive?.due ? [flattenDisplayText(report.archive.path, 180)] : [])
    .join(" and ");
  const reasonText =
    (Array.isArray(report.reasons) ? report.reasons : [])
      .slice(0, 4)
      .map((reason) => flattenDisplayText(reason, 260))
      .join("; ") || "source validation failed";
  const action =
    audience === "subagent"
      ? "Do not edit these documents unless they are in your assigned paths; report material status or architecture impact in your result packet."
      : audience === "precompact"
        ? "Preserve this review need in the checkpoint queue before relying on recovery; the hook will not edit any file."
        : audience === "integration"
          ? "Before integrating the result, run the read-only documentation check and assign any required refresh; the hook will not edit canonical state."
          : "Run npm run docs:check, review the named source changes, then update and independently review the affected document. No file is changed automatically.";
  return truncateUtf8(
    `Documentation ${state}${paths ? ` for ${paths}` : ""}: ${reasonText}. ${action}`,
    maxBytes,
  );
}

export function formatDocumentationReport(report) {
  const heading = report.valid ? (report.due ? "REVIEW DUE" : "FRESH") : "INVALID";
  const lines = [`Documentation: ${heading}`];
  for (const document of Object.values(report.documents || {})) {
    const state = document.valid ? (document.due ? "review due" : "fresh") : "invalid";
    lines.push(`${flattenDisplayText(document.path, 240)}: ${state}`);
    lines.push(`  source ${document.sourceFingerprint}`);
    if (document.documentFingerprint) lines.push(`  body ${document.documentFingerprint}`);
    for (const reason of document.reasons) lines.push(`  - ${flattenDisplayText(reason)}`);
  }
  if (report.archive) {
    const state = report.archive.valid ? "valid" : "invalid";
    lines.push(`${flattenDisplayText(report.archive.path, 240)}: ${state}`);
    for (const reason of report.archive.reasons) lines.push(`  - ${flattenDisplayText(reason)}`);
  }
  for (const reason of report.reasons || []) {
    if (!Object.keys(report.documents || {}).length) {
      lines.push(`- ${flattenDisplayText(reason)}`);
    }
  }
  lines.push("Read-only check: no document or canonical state was changed.");
  return lines.join("\n");
}

function metadataTemplate(report, document) {
  const result = report.documents?.[document];
  const candidate = result?.expectedMetadata;
  const componentFingerprints = Object.values(candidate?.componentFingerprints || {});
  const fingerprints = [
    candidate?.sourceFingerprint,
    candidate?.documentFingerprint,
    ...componentFingerprints,
  ];
  if (
    !result?.valid ||
    !candidate ||
    !fingerprints.length ||
    fingerprints.some((fingerprint) => !SHA256_PATTERN.test(fingerprint)) ||
    typeof candidate.refreshedAt !== "string"
  ) {
    throw new Error(`No safe metadata template is available for ${document}.`);
  }
  return candidate;
}

/**
 * Rewrite one document's first-line stamp from the current sources, and return
 * the line that was written. This is the only function in this file that writes,
 * and it writes exactly one line of metadata — never the prose.
 *
 * It strips any existing stamp before hashing the body, so a restamp is
 * idempotent and a document with no stamp yet gets one.
 */
export function stampDocument(root = REPOSITORY_ROOT, document = "status", { config = null } = {}) {
  const base = canonicalRoot(root);
  const resolvedConfig = config ?? loadConfig({ root: base });
  const definitions = documentDefinitions(resolvedConfig);
  const definition = definitions[document];
  if (!definition) throw new Error(`Unknown document: ${document}`);
  const prefixes = metadataPrefixes(resolvedConfig);
  const architecture = collectArchitectureScope(base, { config: resolvedConfig });
  const scope =
    document === "architecture"
      ? architecture
      : collectStatusScope(base, architecture, { config: resolvedConfig });

  const absolute = resolve(base, ...definition.path.split("/"));
  const raw = readFileSync(absolute, "utf8");
  const firstNewline = raw.indexOf("\n");
  const firstLine = (firstNewline === -1 ? raw : raw.slice(0, firstNewline)).replace(/\r$/, "");
  const body =
    stampPrefix(firstLine, prefixes) && firstNewline !== -1 ? raw.slice(firstNewline + 1) : raw;

  const metadata = {
    schemaVersion: 1,
    document,
    sourceScope: definition.scope,
    sourceFingerprint: scope.fingerprint,
    documentFingerprint: taggedSha256(normalizeLineEndings(Buffer.from(body, "utf8"))),
    componentFingerprints: scope.componentFingerprints,
    refreshedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  };
  const line = `${prefixes[0]}${JSON.stringify(metadata)}${METADATA_SUFFIX}`;
  writeFileSync(absolute, `${line}\n${body}`, "utf8");
  return line;
}

function parseCli(arguments_, config) {
  const argumentsCopy = [...arguments_];
  const command = argumentsCopy.shift() || "check";
  const json = argumentsCopy.includes("--json");
  const definitions = documentDefinitions(config);
  if (command === "check" && argumentsCopy.every((argument) => argument === "--json")) {
    return { command, json, document: null };
  }
  if (
    (command === "metadata" || command === "stamp") &&
    argumentsCopy.length === 1 &&
    definitions[argumentsCopy[0]]
  ) {
    return { command, json: true, document: argumentsCopy[0] };
  }
  return null;
}

const CLI_USAGE =
  "Usage: documentation.mjs check [--json] | documentation.mjs metadata <status|architecture> | documentation.mjs stamp <status|architecture>\n";

export function executeDocumentationCommand({ root = REPOSITORY_ROOT, args = [] } = {}) {
  // The package's own folder ships this script but has no living documents: say so instead of failing.
  if (isKitPackage(root)) return { stdout: `${PACKAGE_NOTE}\n`, stderr: "", exitCode: 0 };
  const config = loadConfig({ root });
  const parsed = parseCli(args, config);
  if (!parsed) {
    return { stdout: "", stderr: CLI_USAGE, exitCode: 2 };
  }
  const report = evaluateDocumentation(root);
  if (parsed.command === "metadata" || parsed.command === "stamp") {
    try {
      if (parsed.command === "stamp") {
        stampDocument(root, parsed.document, { config });
        return {
          stdout: `Restamped ${documentDefinitions(config)[parsed.document].path} from the current sources.\n`,
          stderr: "",
          exitCode: 0,
        };
      }
      return {
        stdout: `${JSON.stringify(metadataTemplate(report, parsed.document), null, 2)}\n`,
        stderr: "",
        exitCode: 0,
      };
    } catch (error) {
      return { stdout: "", stderr: `${flattenDisplayText(error?.message)}\n`, exitCode: 2 };
    }
  }
  return {
    stdout: parsed.json
      ? `${JSON.stringify(report, null, 2)}\n`
      : `${formatDocumentationReport(report)}\n`,
    stderr: "",
    exitCode: report.exitCode,
  };
}

async function main() {
  const result = executeDocumentationCommand({ args: process.argv.slice(2) });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
