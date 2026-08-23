(() => {
  'use strict';

  // CRC32 Lookup Table
  const CRC_TABLE = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    CRC_TABLE[i] = c >>> 0;
  }

  function crc32(uint8Array) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < uint8Array.length; i++) {
      crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ uint8Array[i]) & 0xFF];
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  const textEncoder = new TextEncoder();

  function dosDateTime(date) {
    const d = date || new Date();
    const dosTime = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF;
    const dosDate = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
    return { dosTime, dosDate };
  }

  class ZipEntry {
    constructor(path, content) {
      this.path = path.replace(/\\/g, '/').replace(/^\/+/, '');
      this.isDir = this.path.endsWith('/');
      if (typeof content === 'string') {
        this.data = textEncoder.encode(content);
      } else if (content instanceof Uint8Array) {
        this.data = content;
      } else if (content instanceof ArrayBuffer) {
        this.data = new Uint8Array(content);
      } else {
        this.data = new Uint8Array(0);
      }
      this.crc = this.isDir ? 0 : crc32(this.data);
      this.size = this.data.length;
      this.date = new Date();
    }
  }

  class JSZip {
    constructor(prefix = '') {
      this._prefix = prefix ? prefix.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/?$/, '/') : '';
      this._files = new Map();
    }

    file(name, content) {
      if (arguments.length === 1) {
        return this._files.get(this._prefix + name) || null;
      }
      const fullPath = this._prefix + name;
      const entry = new ZipEntry(fullPath, content);
      this._files.set(fullPath, entry);
      return this;
    }

    folder(name) {
      const folderPath = this._prefix + name.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/?$/, '/') + '/';
      if (!this._files.has(folderPath)) {
        this._files.set(folderPath, new ZipEntry(folderPath, null));
      }
      const subZip = new JSZip(folderPath);
      subZip._files = this._files;
      return subZip;
    }

    async generateAsync(options = {}, onUpdate) {
      const entries = Array.from(this._files.values()).sort((a, b) => a.path.localeCompare(b.path));
      const totalEntries = entries.length;
      const localChunks = [];
      const centralChunks = [];
      let offset = 0;

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const pathBytes = textEncoder.encode(entry.path);
        const { dosTime, dosDate } = dosDateTime(entry.date);

        // Local file header (30 bytes + path length + data length)
        const localHeader = new Uint8Array(30 + pathBytes.length);
        const view = new DataView(localHeader.buffer);
        view.setUint32(0, 0x04034b50, true); // Local header signature
        view.setUint16(4, 20, true); // Version needed to extract (2.0)
        view.setUint16(6, 0x0800, true); // Flags (bit 11: UTF-8)
        view.setUint16(8, 0, true); // Compression method (0 = store)
        view.setUint16(10, dosTime, true);
        view.setUint16(12, dosDate, true);
        view.setUint32(14, entry.crc, true);
        view.setUint32(18, entry.size, true); // Compressed size
        view.setUint32(22, entry.size, true); // Uncompressed size
        view.setUint16(26, pathBytes.length, true);
        view.setUint16(28, 0, true); // Extra field length
        localHeader.set(pathBytes, 30);

        localChunks.push(localHeader);
        if (entry.data.length > 0) {
          localChunks.push(entry.data);
        }

        // Central directory header (46 bytes + path length)
        const centralHeader = new Uint8Array(46 + pathBytes.length);
        const cView = new DataView(centralHeader.buffer);
        cView.setUint32(0, 0x02014b50, true); // Central header signature
        cView.setUint16(4, 20, true); // Version made by
        cView.setUint16(6, 20, true); // Version needed to extract
        cView.setUint16(8, 0x0800, true); // Flags (UTF-8)
        cView.setUint16(10, 0, true); // Compression method
        cView.setUint16(12, dosTime, true);
        cView.setUint16(14, dosDate, true);
        cView.setUint32(16, entry.crc, true);
        cView.setUint32(20, entry.size, true);
        cView.setUint32(24, entry.size, true);
        cView.setUint16(28, pathBytes.length, true);
        cView.setUint16(30, 0, true); // Extra field length
        cView.setUint16(32, 0, true); // Comment length
        cView.setUint16(34, 0, true); // Disk number start
        cView.setUint16(36, 0, true); // Internal attributes
        cView.setUint32(38, entry.isDir ? 0x10 : 0, true); // External attributes (0x10 = directory)
        cView.setUint32(42, offset, true); // Relative offset of local header
        centralHeader.set(pathBytes, 46);

        centralChunks.push(centralHeader);
        offset += localHeader.length + entry.data.length;

        if (typeof onUpdate === 'function') {
          onUpdate({ percent: Math.round(((i + 1) / totalEntries) * 100) });
        }
      }

      const centralDirSize = centralChunks.reduce((sum, c) => sum + c.length, 0);
      const centralDirOffset = offset;

      // End of central directory record (22 bytes)
      const eocd = new Uint8Array(22);
      const eView = new DataView(eocd.buffer);
      eView.setUint32(0, 0x06054b50, true); // EOCD signature
      eView.setUint16(4, 0, true); // Disk number
      eView.setUint16(6, 0, true); // Disk with central directory
      eView.setUint16(8, entries.length, true); // Entries on this disk
      eView.setUint16(10, entries.length, true); // Total entries
      eView.setUint32(12, centralDirSize, true); // Size of central directory
      eView.setUint32(16, centralDirOffset, true); // Offset of central directory
      eView.setUint16(20, 0, true); // Comment length

      const allParts = [...localChunks, ...centralChunks, eocd];
      const blob = new Blob(allParts, { type: 'application/zip' });

      if (options.type === 'blob' || !options.type) {
        return blob;
      } else if (options.type === 'uint8array') {
        const buf = await blob.arrayBuffer();
        return new Uint8Array(buf);
      } else if (options.type === 'arraybuffer') {
        return await blob.arrayBuffer();
      }
      return blob;
    }
  }

  globalThis.JSZip = JSZip;
  if (globalThis.BSE) {
    globalThis.BSE.JSZip = JSZip;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = JSZip;
  }
})();
