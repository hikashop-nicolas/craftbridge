// Faces for scripts the module does not carry; `session.addFont` takes the bytes once a document needs them.
const dir = new URL("../../wasm/fonts/", import.meta.url);

export const deckFontUrls = {
  japanese: new URL("BIZUDPGothic-Regular.ttf", dir).href,
  hangul: new URL("NanumGothic-Regular.ttf", dir).href,
  hans: new URL("OmnitextHans-Regular.otf", dir).href,
};
