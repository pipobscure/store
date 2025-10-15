import type { Readable, Writable } from "node:stream";

export type ContentId = string;
export function isContentId(value: string): value is ContentId {
    return (value.length > 127) && (value.length < 130) && !!/^-?[0-9a-f]{128}$/.exec(value);
}
export function assertContentId(value: string): asserts value is ContentId {
    if (!isContentId(value)) throw new TypeError(`invalid ContentId "${value}"`);
}
export function makePath(id: ContentId) {
    assertContentId(id);
    const chars = id.split('');
    return [...chars.slice(0, 6), chars.join('')].join('/');
}

export type ContentPrefix = string;
export function isContentPrefix(value: string): value is ContentPrefix {
    if (value[0] === '-' && value.length > 7) return false
    if (value[0] !== '-' && value.length > 6) return false;
    if (!/^-?[0..9a..f]*$/.exec(value)) return false
    return true;
}
export function assertContentPrefix(value: string): asserts value is ContentPrefix {
    if (!isContentPrefix(value)) throw new TypeError(`invalid ContentPrefix "${value}"`);
}
export function makePrefixPath(prefix: ContentPrefix) {
    assertContentPrefix(prefix);
    return prefix.split('').join('/')
}

export class ConflictToken {
    #value;
    constructor(value: string) {
        this.#value = value;
    }
    static value(token?: ConflictToken) {
        return token ? token.#value : undefined;
    }
}

export type MimeType = `${string}/${string}`;
export function isMimeType(value: string) : value is MimeType {
    return !!/^[\w|-]+\/[\w|-]+$/.exec(value);
}
export function assertMimeType(value: string) : asserts value is MimeType {
    if(!isMimeType(value)) throw new TypeError(`invalid mime-type: ${value}`);
}

export abstract class Backend {
    abstract token(id: ContentId) : Promise<ConflictToken|null>;
    abstract exists(id: ContentId): Promise<boolean>;
    abstract list(prefix: string): AsyncIterableIterator<ContentId>;
    abstract type(id: ContentId) : Promise<MimeType|null>;
    abstract hash(id: ContentId) : Promise<null|ContentId>;
    abstract read(id: ContentId): Promise<null | { content: Buffer<ArrayBufferLike>; type: MimeType }>;
    abstract write(id: ContentId, content: Buffer<ArrayBufferLike>, type?: MimeType, token?: ConflictToken): Promise<boolean>;
    abstract delete(id: ContentId): Promise<boolean>;
    abstract readStream(id: ContentId, stream: Writable) : Promise<null|MimeType>;
    abstract writeStream(id: ContentId, stream: Readable, type?: MimeType, token?: ConflictToken) : Promise<boolean>;
    abstract hashStream(stream: Readable, type?: MimeType) : Promise<ContentId|null>;
}
