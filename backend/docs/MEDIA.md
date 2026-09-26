# Media Architecture

## 1. Storage Strategy

Images are stored on the backend server filesystem.

Cloud storage is not used initially.

Physical structure:

```text
storage/
└── uploads/
    ├── products/
    ├── categories/
    └── users/
```

## 2. Product Images

Product images are stored under a product-specific directory.

Example:

```text
storage/uploads/products/<product-uuid>/
├── image-1.webp
├── image-2.webp
└── image-3.webp
```

## 3. Database

MySQL stores media metadata only.

The database does not store image binaries.

Product image metadata includes:

* id
* product_id
* variant_id
* filename
* storage_path
* image_type
* alt_text
* sort_order
* is_primary
* created_at
* updated_at

## 4. Upload Flow

```text
HTTP multipart/form-data
        ↓
Media Controller
        ↓
Zod / file validation
        ↓
Sharp
        ↓
WebP processing
        ↓
Filesystem
        ↓
Database metadata
        ↓
API response
```

## 5. Validation

Uploaded images must be validated for:

* allowed image MIME types
* actual file type
* maximum file size
* dimensions
* safe extension

The original filename must not determine the final storage filename.

## 6. Image Processing

Sharp is responsible for image processing.

Images should be converted to WebP.

Processing should happen before permanent storage.

## 7. Storage Naming

Storage directories should use UUIDs.

Generated filenames must be server-controlled.

Do not allow clients to specify arbitrary filesystem paths.

## 8. Business Module Boundary

Products, categories, and users must not directly manipulate filesystem paths.

They interact with media through the Media Service.

Conceptually:

```text
Media Controller
      ↓
Media Service
      ↓
Storage Adapter
      ↓
Filesystem
```

## 9. Storage Abstraction

The initial storage implementation is local filesystem storage.

The architecture should allow a future storage provider without changing business modules.

Example:

```text
StorageService
├── LocalStorage
└── FutureCloudStorage
```

No cloud provider needs to be implemented initially.

## 10. Deletion

Media deletion must remove database metadata and associated filesystem data according to the relevant business operation.

Avoid deleting files without considering database consistency.

## 11. Backup

Filesystem uploads and MySQL data are both required for complete recovery.

Database backup alone is not sufficient to recover uploaded images.
