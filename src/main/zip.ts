// Read-only ZIP reader (xlsx and docx are ZIP archives of XML). Node's own zlib, no dependency.
// Layout per PKWARE APPNOTE 6.3: end-of-central-directory record → central directory → local headers.
// Writing documents stays in konkurss-tools (Python); this file only ever reads.
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

const EOCD = 0x06054b50;
const CEN = 0x02014b50;
const LOC = 0x04034b50;

export interface ZipEntry {
	name: string;
	method: number;
	compressedSize: number;
	size: number;
	offset: number;
}

export class ZipReader {
	readonly entries: Map<string, ZipEntry>;
	private constructor(private readonly buf: Buffer) {
		this.entries = readCentralDirectory(buf);
	}
	static fromFile(path: string): ZipReader {
		return new ZipReader(readFileSync(path));
	}
	static fromBuffer(buf: Buffer): ZipReader {
		return new ZipReader(buf);
	}
	has(name: string): boolean {
		return this.entries.has(name);
	}
	/** The entry's bytes, or null when the archive has no such entry. */
	read(name: string): Buffer | null {
		const e = this.entries.get(name);
		if (!e) return null;
		const b = this.buf;
		if (b.readUInt32LE(e.offset) !== LOC) throw new Error(`ZIP: bojāta lokālā galvene „${name}”.`);
		const start = e.offset + 30 + b.readUInt16LE(e.offset + 26) + b.readUInt16LE(e.offset + 28);
		const raw = b.subarray(start, start + e.compressedSize);
		if (e.method === 0) return Buffer.from(raw);
		if (e.method === 8) return inflateRawSync(raw);
		throw new Error(`ZIP: nezināma saspiešanas metode ${e.method} („${name}”).`);
	}
	text(name: string): string | null {
		return this.read(name)?.toString("utf8") ?? null;
	}
}

function readCentralDirectory(b: Buffer): Map<string, ZipEntry> {
	// the EOCD record is 22 bytes plus a comment of up to 65 535 bytes, at the very end
	let eocd = -1;
	for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) {
		if (b.readUInt32LE(i) === EOCD) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) throw new Error("Fails nav ZIP arhīvs (nav atrasts centrālā kataloga beigu ieraksts).");
	const count = b.readUInt16LE(eocd + 10);
	let p = b.readUInt32LE(eocd + 16);
	if (count === 0xffff || p === 0xffffffff) throw new Error("ZIP64 arhīvi netiek atbalstīti.");
	const out = new Map<string, ZipEntry>();
	for (let n = 0; n < count; n++) {
		if (b.readUInt32LE(p) !== CEN) throw new Error("ZIP: bojāts centrālais katalogs.");
		const flags = b.readUInt16LE(p + 8);
		const method = b.readUInt16LE(p + 10);
		const compressedSize = b.readUInt32LE(p + 20);
		const size = b.readUInt32LE(p + 24);
		const nameLen = b.readUInt16LE(p + 28);
		const extraLen = b.readUInt16LE(p + 30);
		const commentLen = b.readUInt16LE(p + 32);
		const offset = b.readUInt32LE(p + 42);
		const rawName = b.subarray(p + 46, p + 46 + nameLen);
		// bit 11 = UTF-8 names; Office always sets it or uses ASCII part names
		const name = rawName.toString(flags & 0x800 ? "utf8" : "latin1");
		out.set(name, { name, method, compressedSize, size, offset });
		p += 46 + nameLen + extraLen + commentLen;
	}
	return out;
}
