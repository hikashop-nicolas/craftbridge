// Faces for scripts the module does not carry; `session.addFont` takes the bytes once a document needs them.
export const deckFontUrls = {
  japanese: new URL("../../wasm/fonts/BIZUDPGothic-Regular.ttf", import.meta.url).href,
  hangul: new URL("../../wasm/fonts/NanumGothic-Regular.ttf", import.meta.url).href,
  hans: new URL("../../wasm/fonts/OmnitextHans-Regular.otf", import.meta.url).href,
};
