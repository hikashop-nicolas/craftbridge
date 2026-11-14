// Faces for scripts the module does not carry; `session.addFont` takes the bytes once a document needs them. The Latin,
// Arabic and Hebrew files are for other code that subsets a face itself (scoredit's PDF export): the engines embed their own.
export const deckFontUrls = {
  japanese: new URL("../../wasm/fonts/BIZUDPGothic-Regular.ttf", import.meta.url).href,
  hangul: new URL("../../wasm/fonts/NanumGothic-Regular.ttf", import.meta.url).href,
  hans: new URL("../../wasm/fonts/OmnitextHans-Regular.otf", import.meta.url).href,
  latin: new URL("../../wasm/fonts/Inter-Regular.ttf", import.meta.url).href,
  arabic: new URL("../../wasm/fonts/NotoSansArabic.ttf", import.meta.url).href,
  hebrew: new URL("../../wasm/fonts/NotoSansHebrew-Regular.ttf", import.meta.url).href,
};
