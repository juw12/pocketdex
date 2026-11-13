// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-green; icon-glyph: leaf;

// juw12 trio widget: PocketDex, Haru, Cozy Island and Cairn together.
// Setup page: https://juw12.github.io/pocketdex/widget/
const CODE = "__CODE__";
const SOURCE = "https://juw12.github.io/pocketdex/widget/trio.js";

const files = FileManager.local();
const cachePath = files.joinPath(files.documentsDirectory(), "juw12-trio-widget.js");
let source = null;
try {
  const request = new Request(SOURCE + "?h=" + Math.floor(Date.now() / 3600000));
  request.timeoutInterval = 10;
  const text = await request.loadString();
  if (text.includes("async function main(")) {
    source = text;
    files.writeString(cachePath, text);
  }
} catch (error) {
  // offline: use the copy saved last time
}
if (!source && files.fileExists(cachePath)) {
  source = files.readString(cachePath);
}
if (source) {
  await new Function("ctx", source + "\nreturn main(ctx);")({ code: CODE, param: args.widgetParameter });
} else {
  const widget = new ListWidget();
  widget.addText("Trio widget needs the internet once.");
  Script.setWidget(widget);
  Script.complete();
}
