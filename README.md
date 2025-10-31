# @pipobscure/store

This is a simple storage interface that works backed by files as well as S3 buckets.
In addition it supports encrypting data with a public/private keypair as well as
compression of data.

 * `Files` - the filesystem backend
 * `Bucket` - the S3 bucket backend
 * `Compression` - a backend that wraps another backend to provide compression
 * `Asymetric` - a backend that wraps another backend to provide encryption (Asymetric Key)
 * `Secret` - a backend that wraps another backend to provide encryption (Password/Salt Based)
 * `Frontend` - the developer interface that provides access to a backend for easy use

These classes together form a flexible and backend-agnostic storage system.

## `Backend` — Abstract Storage Backend

The `Backend` class defines the **abstract interface** for all storage backends.  
It describes how data is stored, retrieved, and deleted, but does not impose any specific storage technology or format.

Implementations can range from simple in-memory stores to remote databases or distributed systems.

### Responsibilities

- Provide a consistent API for reading, writing, and deleting content.
- Handle low-level data persistence and concurrency management.
- Define and enforce identifiers (`ContentId`), MIME types (`MimeType`), and conflict tokens (`ConflictToken`).

### Core Concepts

| Type | Description |
|------|--------------|
| `ContentId` | Unique hexadecimal identifier for stored content. |
| `MimeType` | MIME type string such as `"text/plain"` or `"application/json"`. |
| `ConflictToken` | Token used to handle concurrent writes safely. |

Each backend must ensure:
- Data integrity between reads and writes via `ConflictToken`
- Validation of identifiers and MIME types.

## `Frontend` — High-Level Data Interface

The `Frontend` class provides the **user-facing interface** for working with a backend.  
It handles content addressing, tagging, MIME types, and concurrency control in a simple API.

### Constructor

```ts
new Frontend(backend: Backend)
```
| Parameter | Type | Description |
|------------|------|-------------|
| `backend` | `Backend` | The backend instance to use for storage operations. |

### Content Addressable

#### `exists(cid: ContentId, options?: { signal?: AbortSignal })`
Checks if content pointed to by `cid` exists.

**Returns:** `Promise<boolean>`

#### `type(cid: ContentId, options?: { signal?: AbortSignal })`
Retrieves the MIME type of stored content.

**Returns:** `Promise<MimeType | null>`

#### `pull(cid: ContentId, options?: { signal?: AbortSignal })`
Retrieves binary content by its content ID.

**Returns:** `Promise<Buffer | null>`

#### `push(content: Buffer, options?: { type?: MimeType; signal?: AbortSignal })`
Stores binary data and returns its generated content identifier.

**Returns:** `Promise<ContentId>`

#### `pushStream(stream: AsyncIterable<Buffer>, options?: { type?: MimeType; signal?: AbortSignal })`
Stores streamed binary data from an asynchronous source.

**Returns:** `Promise<ContentId>`

#### `pullStream(cid: ContentId, options?: { signal?: AbortSignal })`
Opens a readable stream for incremental data retrieval.
If the content does not exist, the `AsyncIterable` will simply not yield any data.

**Returns:** `AsyncIterable<Buffer>`

### Named Content

#### `has(name: string, options?: { signal?: AbortSignal })`
Checks is a piece of named content exists

**Returns:** `Promise<boolean>`

#### `get(name: string, options?: { signal?: AbortSignal })`
Retrieves structured information (content, metadata, MIME type) for a given tag.

**Returns:** `Promise<{ data: Buffer; type: MimeType; ... } | null>`

#### `set(name: string, content: Buffer, options?: { type?: MimeType, token?: ConflictToken, signal?: AbortSignal })`
Writes or replaces the content for a name.

**Returns:** `Promise<boolean>` to indicate success

#### `readStream(name: string, options?: { signal?: AbortSignal })`
Opens a readable stream for incremental data retrieval.
If the content does not exist, the `AsyncIterable` will simply not yield any data.

**Returns:** `AsyncIterable<Buffer>`

#### `writeStream(name: string, stream: AsyncIterable<Buffer>, options?: { type?: MimeType; token?: ConflictToken; signal?: AbortSignal })`
Writes the content from `stream` as the new content.

**Returns:** `Promise<boolean>`indicating success

#### `delete(name: string, options?: { token?: ConflictToken, signal?: AbortSignal }})`
Removes the content associated with a given name.

**Returns:** `Promise<boolean>` indicating success

#### `tag(name: string, options?: { signal?: AbortSignal })`
Gets the associated metadata (`TagData`) for a name.

| Field | Type | Description |
|--------|------|-------------|
| `cid` | `ContentId` | The linked content ID. |
| `type` | `MimeType` | MIME type of the content. |
| `date` | `number` | Timestamp of creation or modification. |
| `pre` | `ContentId \| null` | Predecessor tag ID for versioning. |

**Returns:** `Promise<TagData>`

#### `tags(name: string, options?: { signal?: AbortSignal })`
Gets a list of historical associated metadata (`TagData`) for a name in reverse chronological order.

**Returns:** `AyncIterable<TagData>`

#### `async token(name: string, options?: { signal?: AbortSignal })`
Requests a new conflict token from the backend for concurrent operations.
This library is optimistic, and uses tokens to prevent overwriting data that
has changed. The writing functions will return false if a conflict occurred,
so that the user can refetch the data and possibly retry.

**Returns:** `Promise<ConflictToken | null>` where `null` means the tag does not exists, so locking isn't necessary

### Example Usage

```ts
import { Frontend } from "./frontend.ts";
import { MemoryBackend } from "./memory.ts";

const backend = new MemoryBackend();
const store = new Frontend(backend);

// Store text data
const id = await store.push(Buffer.from("Hello, world!"), { type: "text/plain" });

// Retrieve it
const content = await store.pull(id);
console.log(content?.toString()); // "Hello, world!"

// Set named data
await store.set('my content', Buffer.from('my content'), { type: 'text/plain' });

// Get named data
const taggedContent = await store.get('my content');

// Get metadata for a named content
const data = await store.tag('my content');
console.log('mime-type: ', data?.type);

```

## Implementing a Custom Backend

To add a new storage type, subclass `Backend` and implement all required methods.  
Each backend is responsible for data persistence, retrieval, and identifier validation.

Once implemented, this backend can be plugged directly into the `Frontend`.

Examples:

 * [Files](./src/files.ts)
 * [Bucket](./src/bucket.ts)
 * [Compression](./src/compression.ts)
 * [Asymetric Encryption](./src/asymetric.ts)
 * [Secret Based Encryption](./src/secret.ts)

## Summary

| Layer | Role | Typical Implementor |
|--------|------|--------------------|
| **Frontend** | High-level interface for users; manages metadata, types, and IDs | Application developers |
| **Backend** | Low-level persistence layer; defines how content is stored | Library or system developers |

## License

© 2025 Philipp Dunkel <pip@pipobscure.com> [EUPL v1.2](https://eupl.eu/1.2/en)
