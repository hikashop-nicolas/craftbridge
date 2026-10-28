// The faces the PDF module is built without. Fetch each `url` and pass the bytes in `openPdf`'s `fonts`.
export const pdfFontFaces = [
  { url: new URL("../../wasm/fonts/BIZUDPGothic-Regular.ttf", import.meta.url).href, family: "BIZ UDPGothic", style: "Regular", scripts: "Jpan,Latn" },
  { url: new URL("../../wasm/fonts/OmnitextHans-Regular.otf", import.meta.url).href, family: "Omnitext Hans", style: "Regular", scripts: "Hans" },
  { url: new URL("../../wasm/fonts/NanumGothic-Regular.ttf", import.meta.url).href, family: "NanumGothic", style: "Regular", scripts: "Hang,Kore" },
];
