export type ContentId = string;
export function isContentId(value: string): value is ContentId {
	return value.length > 127 && value.length < 130 && !!/^-?[0-9a-f]{128}$/.test(value);
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
	if (value[0] === '-' && value.length > 7) return false;
	if (value[0] !== '-' && value.length > 6) return false;
	if (!/^-?[0..9a..f]*$/.exec(value)) return false;
	return true;
}
export function assertContentPrefix(value: string): asserts value is ContentPrefix {
	if (!isContentPrefix(value)) throw new TypeError(`invalid ContentPrefix "${value}"`);
}
export function makePrefixPath(prefix: ContentPrefix) {
	assertContentPrefix(prefix);
	return prefix.split('').join('/');
}

export class ConflictToken {
	#owner;
	#value;
	constructor(owner: Backend, value: string) {
		this.#owner = owner;
		this.#value = value;
	}
	value(owner: Backend) {
		if (owner !== this.#owner) throw new Error('invalid token owner');
		return this.#value;
	}
	toString() {
		return `[ConflictToken:${this.#value}]`;
	}
}

export type MimeType = `${string}/${string}`;
export function isMimeType(value: string): value is MimeType {
	return !!/^[\w|-]+\/[\w|-]+(?:;\s\w+=[\w-]+)*$/.exec(value);
}
export function assertMimeType(value: string): asserts value is MimeType {
	if (!isMimeType(value)) throw new TypeError(`invalid mime-type: ${value}`);
}

export abstract class Backend {
	abstract token(id: ContentId, signal?: AbortSignal): Promise<ConflictToken | null>;
	abstract exists(id: ContentId, signal?: AbortSignal): Promise<boolean>;
	abstract list(signal?: AbortSignal): AsyncIterableIterator<ContentId>;
	abstract type(id: ContentId, signal?: AbortSignal): Promise<MimeType | null>;
	abstract hash(id: ContentId, signal?: AbortSignal): Promise<null | string>;
	abstract read(id: ContentId, signal?: AbortSignal): Promise<null | { content: Buffer<ArrayBufferLike>; type: MimeType }>;
	abstract write(id: ContentId, content: Buffer<ArrayBufferLike>, type?: MimeType, token?: ConflictToken, signal?: AbortSignal): Promise<boolean>;
	abstract delete(id: ContentId, token: ConflictToken, signal?: AbortSignal): Promise<boolean>;
	abstract readStream(id: ContentId, signal?: AbortSignal): AsyncIterable<Buffer>;
	abstract writeStream(id: ContentId, stream: AsyncIterable<Buffer>, type?: MimeType, token?: ConflictToken, signal?: AbortSignal): Promise<boolean>;
	abstract rename(source: ContentId, target: ContentId, signal?: AbortSignal): Promise<boolean>;
}
