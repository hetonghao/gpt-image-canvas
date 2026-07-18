import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const [component, poolPage, galleryPage] = await Promise.all([
  readFile(path.join(currentDir, "SearchField.tsx"), "utf8"),
  readFile(path.resolve(currentDir, "../../features/pool/PromptPoolPage.tsx"), "utf8"),
  readFile(path.resolve(currentDir, "../../features/gallery/GalleryPage.tsx"), "utf8")
]);

assert.match(component, /<search className="contents">/u, "SearchField should use the native search landmark");
assert.match(component, /<label className=\{wrapperClassName\}>/u, "SearchField should make the visible shell label its input");
assert.match(component, /<Search[^>]*aria-hidden="true"/u, "SearchField should keep the decorative search icon hidden from assistive tech");
assert.match(poolPage, /<SearchField[\s\S]*?inputClassName="pool-search__input"[\s\S]*?wrapperClassName="pool-search"[\s\S]*?\/>/u);
assert.match(galleryPage, /<SearchField[\s\S]*?inputClassName="gallery-search__input"[\s\S]*?wrapperClassName="gallery-search"[\s\S]*?\/>/u);

process.stdout.write("search-field.smoke.ts passed\n");
