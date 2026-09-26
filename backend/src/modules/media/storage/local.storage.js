const fs = require("fs/promises");
const path = require("path");

const { StorageAdapter } = require("./storage.interface");

const UPLOADS_ROOT = path.resolve(__dirname, "..", "..", "..", "..", "storage", "uploads");

function toAbsolute(relativePath) {
  const absolute = path.resolve(UPLOADS_ROOT, relativePath);
  if (absolute !== UPLOADS_ROOT && !absolute.startsWith(UPLOADS_ROOT + path.sep)) {
    throw new Error("Storage path escapes the upload root");
  }
  return absolute;
}

function toReference(absolutePath) {
  return path.relative(UPLOADS_ROOT, absolutePath).split(path.sep).join("/");
}

class LocalStorage extends StorageAdapter {
  async save(relativeDir, filename, buffer) {
    const absolute = toAbsolute(path.join(relativeDir, filename));
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, buffer);
    return toReference(absolute);
  }

  async remove(relativePath) {
    try {
      await fs.unlink(toAbsolute(relativePath));
      return true;
    } catch (err) {
      if (err.code === "ENOENT") {
        return false;
      }
      throw err;
    }
  }

  async exists(relativePath) {
    try {
      await fs.access(toAbsolute(relativePath));
      return true;
    } catch (err) {
      return false;
    }
  }
}

const localStorageAdapter = new LocalStorage();

module.exports = { LocalStorage, localStorageAdapter, UPLOADS_ROOT };
