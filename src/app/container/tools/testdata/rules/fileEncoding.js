// The text of a list file whatever it was saved as: UTF-8 (with or without a byte order
// mark), UTF-16 with a byte order mark, or Big5. Found in that order: a byte order mark
// says it outright; bytes that are valid UTF-8 are UTF-8 (Big5 text practically never
// is); anything else is read as Big5. The decoders are the ones built into the browser
// part of the app (TextDecoder), nothing is bundled.

// what a file can be found to be; `utf8bom` and `utf16be` are never chosen by hand
export const DETECTED = ['utf8', 'utf8bom', 'utf16le', 'utf16be', 'big5'];

const LABELS = {
  utf8: 'utf-8',
  utf8bom: 'utf-8',
  utf16le: 'utf-16le',
  utf16be: 'utf-16be',
  big5: 'big5',
};

const decoderOf = (label, fatal) => {
  // eslint-disable-next-line global-require
  const Decoder = typeof TextDecoder !== 'undefined' ? TextDecoder : require('util').TextDecoder;
  return new Decoder(label, { fatal: !!fatal });
};

// true when this build of the app can read Big5 at all
export const big5Available = () => {
  try {
    return decoderOf('big5').decode(Uint8Array.from([0xA4, 0xA4])) === '中';
  } catch (e) {
    return false;
  }
};

const startsWith = (bytes, mark) => bytes.length >= mark.length
  && mark.every((b, i) => bytes[i] === b);

const strict = (bytes, label) => {
  try {
    decoderOf(label, true).decode(bytes);
    return true;
  } catch (e) {
    return false;
  }
};

// -> one of DETECTED
export const detectEncoding = (bytes) => {
  if (startsWith(bytes, [0xEF, 0xBB, 0xBF])) {
    return 'utf8bom';
  }
  if (startsWith(bytes, [0xFF, 0xFE])) {
    return 'utf16le';
  }
  if (startsWith(bytes, [0xFE, 0xFF])) {
    return 'utf16be';
  }
  return strict(bytes, 'utf-8') ? 'utf8' : 'big5';
};

// The start of a file that was cut anywhere: back to the end of its last whole line, so
// that half a character at the cut is not taken for a damaged file.
export const wholeLines = (bytes) => {
  const wide = startsWith(bytes, [0xFF, 0xFE]) || startsWith(bytes, [0xFE, 0xFF]);
  if (wide) {
    const low = bytes[0] === 0xFF ? 0 : 1;
    for (let i = bytes.length - (bytes.length % 2) - 2; i >= 2; i -= 2) {
      if (bytes[i + low] === 0x0A && bytes[i + 1 - low] === 0x00) {
        return bytes.slice(0, i + 2);
      }
    }
    return bytes.slice(0, 0);
  }
  // 0x0A is never part of a longer character in UTF-8 or in Big5
  const end = bytes.lastIndexOf(0x0A);
  return bytes.slice(0, end + 1);
};

// bytes -> {text, encoding: one of DETECTED, auto: found (true) or chosen by hand,
//           damaged: some bytes are no characters of that encoding}
// `choice`: 'auto' | 'utf8' | 'big5' | 'utf16le'
export const decodeBytes = (bytes, choice = 'auto') => {
  const auto = !['utf8', 'big5', 'utf16le'].includes(choice);
  const found = detectEncoding(bytes);
  let encoding = found;
  if (!auto) {
    // a byte order mark is still honoured inside the family that was chosen
    const sameFamily = found.startsWith(choice) || (choice === 'utf16le' && found === 'utf16be');
    encoding = sameFamily ? found : choice;
  }
  const text = decoderOf(LABELS[encoding]).decode(bytes).replace(/^\uFEFF/, '');
  return {
    text,
    encoding,
    auto,
    damaged: text.indexOf('\uFFFD') >= 0 || !strict(bytes, LABELS[encoding]),
  };
};
