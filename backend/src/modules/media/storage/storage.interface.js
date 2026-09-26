class StorageAdapter {
  async save(relativeDir, filename, buffer) {
    throw new Error("StorageAdapter.save is not implemented");
  }

  async remove(relativePath) {
    throw new Error("StorageAdapter.remove is not implemented");
  }

  async exists(relativePath) {
    throw new Error("StorageAdapter.exists is not implemented");
  }
}

module.exports = { StorageAdapter };
