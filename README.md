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

## `Frontend` API

 * `new Frontend(backend: Backend)` - constructs a new Frontend instance
 * `frontend.push(content: Buffer, type?: MimeType)` - push data into the CAS (Content-Addressable-Store) and returns a `ContentId`
 * `frontend.pull(cid: ContentId)` - pulls data from the CAS
 * `frontend.pushStream(stream: Readable, type?: MimeType)` - pushes a `Readable` into the CAS
 * `frontend.pullStream(cid: ContentId)` - pulls a data from the CAS into a `Writable`
 * `frontend.type(cid: ContentId)` - gets the type of content from the CAS
 * `frontend.tag(name: string)` - gets the `TagData` from the store. Tags are named and versioned content pointers.
 * `frontend.tag(name: string)` - gets an `AsyncGenerator<TagData>` to walk backwards through the versions of a tag.
 * `frontend.token(name: string)` - gets a `ConflictToken` for a tag. When passing it into `.set` it only allows writing the tag if it hasn't been modified.
 * `frontend.set(name: string, content: Buffer, type?: MimeType, token?: ConflictToken)` - sets a named value into the CAS
 * `frontend.get(name: string)` - gets the named value from the CAS
 * `frontend.readStream(name: string)` - gets the named value from the CAS as a `Readable`
 * `frontend.writeStream(name: string, stream: Readable,  type?: MimeType, token?: ConflictToken)` - sets the named value into the CAS from a `Readable`
 * `frontend.delete(name: string)` - deletes the named value from the CAS
