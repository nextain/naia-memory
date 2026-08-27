import { createHash } from "node:crypto";

export interface HashableNativeCorpusDocument {
	docid: string;
	title: string;
	text: string;
}

export const NATIVE_CORPUS_CONTENT_HASH_ALGORITHM =
	"sha256-domain-v1-u64be-utf16be";

function updateFramedUtf16CodeUnits(
	hash: ReturnType<typeof createHash>,
	value: string,
): void {
	const bytes = Buffer.allocUnsafe(value.length * 2);
	for (let index = 0; index < value.length; index += 1) {
		bytes.writeUInt16BE(value.charCodeAt(index), index * 2);
	}
	const length = Buffer.allocUnsafe(8);
	length.writeBigUInt64BE(BigInt(value.length));
	hash.update(length);
	hash.update(bytes);
}

/**
 * Hash parsed corpus meaning without JSON whitespace or field-order ambiguity.
 * Length-prefixing every exact UTF-16 code-unit field prevents concatenation
 * boundary collisions without collapsing lone surrogates to replacement text.
 */
export class NativeCorpusContentHasher {
	private readonly hash = createHash("sha256").update(
		"naia-native-corpus-content-v1\0",
	);
	private finalDigest: string | undefined;

	update(document: HashableNativeCorpusDocument): void {
		if (this.finalDigest !== undefined)
			throw new Error("native corpus content hash is finalized");
		updateFramedUtf16CodeUnits(this.hash, document.docid);
		updateFramedUtf16CodeUnits(this.hash, document.title);
		updateFramedUtf16CodeUnits(this.hash, document.text);
	}

	digest(): string {
		this.finalDigest ??= this.hash.digest("hex");
		return this.finalDigest;
	}
}

export function hashNativeCorpusDocumentContents(
	documents: readonly HashableNativeCorpusDocument[],
): string {
	const hasher = new NativeCorpusContentHasher();
	for (const document of documents) hasher.update(document);
	return hasher.digest();
}
