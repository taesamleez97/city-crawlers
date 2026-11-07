// Decodes a saved CDP Page.captureScreenshot response into an image file.
import { readFileSync, writeFileSync } from "node:fs";
const [src, out] = process.argv.slice(2);
const json = JSON.parse(readFileSync(src, "utf8"));
// Either a Page.captureScreenshot result or a Runtime.evaluate returning a data URL.
const raw = json.data ?? json.result?.data ?? json.result?.value ?? json.result?.result?.value;
const data = String(raw).replace(/^data:image\/\w+;base64,/, "");
writeFileSync(out, Buffer.from(data, "base64"));
console.log(out);
