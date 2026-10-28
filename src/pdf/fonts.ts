// The faces the PDF module is built without. Fetch each `url` and pass the bytes in `openPdf`'s `fonts`.
const dir = new URL("../../wasm/fonts/", import.meta.url);

export const pdfFontFaces = [
  { url: new URL("BIZUDPGothic-Regular.ttf", dir).href, family: "BIZ UDPGothic", style: "Regular", scripts: "Jpan,Latn" },
  { url: new URL("OmnitextHans-Regular.otf", dir).href, family: "Omnitext Hans", style: "Regular", scripts: "Hans" },
  { url: new URL("NanumGothic-Regular.ttf", dir).href, family: "NanumGothic", style: "Regular", scripts: "Hang,Kore" },
];
