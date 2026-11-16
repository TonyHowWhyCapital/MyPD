// A picture kept in the template: a png or jpeg data URL and its size in pixels.
const DATA = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/;
export const IMAGE_FIELDS = ['logo', 'background'];
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export const imageOf = (value) => {
  if (!value || !DATA.test(value.data || '') || !(value.width > 0) || !(value.height > 0)) return null;
  return { data: value.data, width: value.width, height: value.height };
};

export const extensionOf = image => DATA.exec(image.data)[1];

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export const bytesOf = (image) => {
  const text = DATA.exec(image.data)[2].replace(/=+$/, '');
  const out = new Uint8Array(Math.floor(text.length * 3 / 4));
  let bits = 0;
  let held = 0;
  let at = 0;
  for (let i = 0; i < text.length; i += 1) {
    held = (held << 6) | CHARS.indexOf(text[i]);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at] = (held >> bits) & 0xFF;
      at += 1;
    }
  }
  return out;
};

// The largest size with the picture's proportions that fits the box.
export const fitInto = (image, maxWidth, maxHeight) => {
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
  return { width: Math.round(image.width * scale), height: Math.round(image.height * scale) };
};

// How much to cut off each side, as fractions, so the picture fills the box undistorted.
export const cropToFill = (image, boxWidth, boxHeight) => {
  const wide = image.width / image.height;
  const box = boxWidth / boxHeight;
  const x = wide > box ? (1 - box / wide) / 2 : 0;
  const y = wide > box ? 0 : (1 - wide / box) / 2;
  return { x, y };
};
