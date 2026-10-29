import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import contactHandler from "./api/contact.mjs";

const APP_ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(APP_ROOT, "public");
let staticRoot;

try {
  staticRoot = await realpath(PUBLIC_DIR);
} catch {
  // In the source checkout the existing site files live at the repository root.
  staticRoot = await realpath(APP_ROOT);
}

const CONTENT_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
]);

const PRIVATE_ROOT_FILES = new Set([
  "Dockerfile",
  "server.mjs",
  ".dockerignore",
  "COOLIFY.md",
]);

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(payload));
}

function createVercelResponseAdapter(res) {
  return {
    setHeader(name, value) {
      res.setHeader(name, value);
    },
    status(statusCode) {
      res.statusCode = statusCode;
      return this;
    },
    json(payload) {
      if (!res.hasHeader("Content-Type")) {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
      }
      res.end(JSON.stringify(payload));
      return this;
    },
  };
}

async function handleContact(req, res) {
  try {
    await contactHandler(req, createVercelResponseAdapter(res));
  } catch (error) {
    console.error("[server] contact handler failed", error?.message || "unknown error");
    if (!res.headersSent) {
      sendJson(res, 500, {
        ok: false,
        error: "Сервис временно недоступен. Попробуйте позже.",
      });
    } else {
      res.destroy();
    }
  }
}

function resolvePublicPath(pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  if (decodedPath.includes("\0") || decodedPath.includes("\\")) return null;

  const segments = decodedPath.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === ".." || segment.startsWith("."))) {
    return null;
  }
  if (segments[0]?.toLowerCase() === "api") return null;

  const relativePath = segments.length ? path.join(...segments) : "index.html";
  if (!segments.length || segments.length === 1) {
    if (PRIVATE_ROOT_FILES.has(relativePath)) return null;
  }

  const contentType = CONTENT_TYPES.get(path.extname(relativePath).toLowerCase());
  if (!contentType) return null;

  const filePath = path.resolve(staticRoot, relativePath);
  const relativeToRoot = path.relative(staticRoot, filePath);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) return null;

  return { filePath, contentType };
}

async function serveStatic(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    res.statusCode = 405;
    res.end("Method Not Allowed");
    return;
  }

  const publicFile = resolvePublicPath(pathname);
  if (!publicFile) {
    res.statusCode = 404;
    res.end("Not Found");
    return;
  }

  let resolvedFile;
  let fileInfo;
  try {
    resolvedFile = await realpath(publicFile.filePath);
    const relativeToRoot = path.relative(staticRoot, resolvedFile);
    if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
      res.statusCode = 404;
      res.end("Not Found");
      return;
    }
    fileInfo = await stat(resolvedFile);
  } catch {
    res.statusCode = 404;
    res.end("Not Found");
    return;
  }

  if (!fileInfo.isFile()) {
    res.statusCode = 404;
    res.end("Not Found");
    return;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", publicFile.contentType);
  res.setHeader("Content-Length", fileInfo.size);
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  const stream = createReadStream(resolvedFile);
  stream.on("error", (error) => {
    console.error("[server] static file read failed", error?.message || "unknown error");
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end("Internal Server Error");
    } else {
      res.destroy();
    }
  });
  stream.pipe(res);
}

const server = createServer((req, res) => {
  let pathname;
  try {
    pathname = new URL(req.url || "/", "http://localhost").pathname;
  } catch {
    res.statusCode = 400;
    res.end("Bad Request");
    return;
  }

  if (pathname === "/healthz") {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      res.statusCode = 405;
      res.end("Method Not Allowed");
      return;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(req.method === "HEAD" ? undefined : "ok");
    return;
  }

  if (pathname === "/api/contact") {
    void handleContact(req, res);
    return;
  }

  if (pathname === "/api" || pathname.startsWith("/api/")) {
    res.statusCode = 404;
    res.end("Not Found");
    return;
  }

  void serveStatic(req, res, pathname).catch((error) => {
    console.error("[server] static request failed", error?.message || "unknown error");
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end("Internal Server Error");
    } else {
      res.destroy();
    }
  });
});

const rawPort = process.env.PORT || "3000";
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

server.listen(port, "0.0.0.0", () => {
  console.log(`[server] listening on 0.0.0.0:${port}`);
});
