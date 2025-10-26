import type { Writable } from 'node:stream';

export async function pipe(stream: AsyncIterable<Buffer>, output: Writable, signal?: AbortSignal) {
	try {
		for await (const chunk of stream) {
			signal?.throwIfAborted();
			const deferred = Promise.withResolvers<void>();
			output.write(chunk, (err) => {
				if (err) deferred.reject(err);
				deferred.resolve();
			});
			await deferred.promise;
		}
		const deferred = Promise.withResolvers<void>();
		output.end(() => {
			deferred.resolve();
		});
		await deferred.promise;
	} catch (err) {
		signal?.throwIfAborted();
		output.emit('error', err);
	}
}
