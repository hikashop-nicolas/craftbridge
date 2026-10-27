// Faces for scripts the module does not carry; `session.addFont` takes the bytes once a document needs them.
export const deckFontUrls = {
  hangul: new URL("../../wasm/deck/fonts/NanumGothic-Regular.ttf", import.meta.url).href,
  hans: new URL("../../wasm/deck/fonts/OmnitextHans-Regular.otf", import.meta.url).href,
};
