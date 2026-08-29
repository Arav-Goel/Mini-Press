// images.js — replaces sharp/jimp with Bun.Image, the built-in decode/
// resize/encode pipeline Bun ships since 1.3.14 (no native addon).
//
// CORRECTED after a real run against Bun failed on the first draft of
// this file: the original version guessed a `Bun.Image.decode(buffer)` /
// `.encode({format})` static-call shape. The real API (confirmed against
// the official docs at bun.com/docs/runtime/image and bun.com/blog/
// bun-v1.3.14) is a chainable pipeline built from a constructor, not
// static methods:
//
//   await new Bun.Image(buffer)
//     .resize(width, height, { fit, withoutEnlargement })
//     .webp({ quality })
//     .write(path)          // or .bytes() / .blob() to get data back
//
// Nothing decodes or encodes until a terminal (.write/.bytes/.blob) is
// awaited, and that work runs off the JS thread. `fit: "inside"` with a
// single width and `height: undefined` preserves aspect ratio for us —
// no manual aspect-ratio math needed, unlike the first draft.

import { mkdirSync } from "node:fs";

const SIZES = {
  thumb: 320,
  medium: 800,
  large: 1600,
};

function pipeline(buffer) {
  return new Bun.Image(buffer);
}

// withoutEnlargement: true means a source smaller than the target width
// is left at its own size rather than upscaled and blurred.
function resizeStep(img, width) {
  return img.resize(width, undefined, { fit: "inside", withoutEnlargement: true });
}

// Runs once at boot. Throws with a clear message if Bun.Image doesn't
// exist or doesn't behave as expected, rather than letting the first real
// upload fail mysteriously mid-demo.
export async function verifyImageSupport() {
  if (typeof Bun === "undefined" || !Bun.Image) {
    throw new Error(
      "Bun.Image is not available in this runtime. mini-press's image " +
      "pipeline (src/images.js) requires Bun >= 1.3.14. See " +
      "https://bun.com/docs/runtime/image."
    );
  }
  // 1x1 transparent PNG, smallest valid PNG that exists — exercises the
  // full decode -> resize -> encode -> bytes chain without needing a real
  // photo on disk.
  const tinyPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  try {
    const out = await resizeStep(pipeline(tinyPng), 1).webp({ quality: 80 }).bytes();
    if (!out || out.length === 0) throw new Error("Bun.Image produced empty output");
  } catch (err) {
    throw new Error(
      `Bun.Image smoke test failed: ${err.message}. If Bun's Image API has ` +
      "changed since this was written, update pipeline()/resizeStep() and " +
      "the .webp({quality}) call in src/images.js — those are the only " +
      "places that touch the Bun.Image surface."
    );
  }
}

export async function processUpload(buffer, postId) {
  const dir = `${process.env.MINIPRESS_DATA_DIR || "./data"}/uploads`;
  mkdirSync(dir, { recursive: true });

  const stem = `post-${postId}-${Date.now()}`;

  for (const [label, width] of Object.entries(SIZES)) {
    // A fresh pipeline per variant: the chain is built from the constructor
    // each time rather than trying to branch one pipeline three ways, since
    // the docs' own examples always show a single linear chain to one
    // terminal, not branching reuse.
    await resizeStep(pipeline(buffer), width)
      .webp({ quality: 82 })
      .write(`${dir}/${stem}-${label}.webp`);
  }

  return stem; // stored on posts.cover_image; sizes derived by convention
}

export function imageVariantPaths(stem) {
  if (!stem) return null;
  return {
    thumb: `/uploads/${stem}-thumb.webp`,
    medium: `/uploads/${stem}-medium.webp`,
    large: `/uploads/${stem}-large.webp`,
  };
}

