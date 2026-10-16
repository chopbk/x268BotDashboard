/**
 * Tổng hợp đa khung theo phong cách giao dịch — market-v1.
 */
const { FORMULA_VERSION, STYLES, STYLE_WEIGHTS, config } = require("./config");
function frameBias(frame) {
    if (!frame || frame.longScore == null || frame.shortScore == null) return "wait";
    if (frame.bias) return frame.bias;
    if (frame.longScore >= frame.shortScore + 5) return "long";
    if (frame.shortScore >= frame.longScore + 5) return "short";
    return "wait";
}

function round1(n) {
    return Number(Number(n).toFixed(1));
}

function weighted(frames, key) {
    const [small, mid, large] = frames;
    if (small?.[key] == null || mid?.[key] == null || large?.[key] == null) return null;
    const v =
        small[key] * STYLE_WEIGHTS.small +
        mid[key] * STYLE_WEIGHTS.mid +
        large[key] * STYLE_WEIGHTS.large;
    return round1(v);
}

function leanLabel(longScore, shortScore) {
    if (longScore == null || shortScore == null) return "wait";
    if (longScore >= 65 && longScore - shortScore >= 15) return "lean_long";
    if (shortScore >= 65 && shortScore - longScore >= 15) return "lean_short";
    return "wait";
}

/**
 * @param {Record<string, object>} byTf map timeframe → score frame
 * @param {string} styleId
 */
function composeStyle(byTf, styleId = config.defaultStyle) {
    const style = STYLES[styleId] || STYLES.intraday;
    const frames = style.frames.map((tf) => byTf[tf] || null);
    const [small, mid, large] = frames;
    const missing = style.frames.filter((tf, i) => !frames[i] || frames[i].longScore == null);
    const compositeLong = missing.length ? null : weighted(frames, "longScore");
    const compositeShort = missing.length ? null : weighted(frames, "shortScore");
    const midBias = frameBias(mid);
    const largeBias = frameBias(large);
    const conflict =
        midBias !== "wait" && largeBias !== "wait" && midBias !== largeBias;
    const lean = leanLabel(compositeLong, compositeShort);
    const midTransitional = mid?.regime === "transitional";
    const eligible =
        !missing.length &&
        !midTransitional &&
        !conflict &&
        (lean === "lean_long" || lean === "lean_short");

    let status = "wait";
    if (missing.length) status = "incomplete";
    else if (conflict) status = "conflict";
    else if (lean === "lean_long") status = "lean_long";
    else if (lean === "lean_short") status = "lean_short";
    else status = "wait";

    return {
        style: style.id,
        styleLabel: style.label,
        frames: style.frames,
        weights: { ...STYLE_WEIGHTS },
        compositeLong,
        compositeShort,
        lean,
        status,
        conflict,
        eligible,
        midRegime: mid?.regime || null,
        largeBias,
        midBias,
        smallBias: frameBias(small),
        formulaVersion: FORMULA_VERSION,
        missingFrames: missing,
        frameScores: Object.fromEntries(
            style.frames.map((tf, i) => [
                tf,
                frames[i]
                    ? {
                          longScore: frames[i].longScore,
                          shortScore: frames[i].shortScore,
                          bias: frameBias(frames[i]),
                          regime: frames[i].regime,
                          quality: frames[i].quality?.overall,
                      }
                    : null,
            ])
        ),
    };
}

function composeAllStyles(byTf) {
    return {
        scalp: composeStyle(byTf, "scalp"),
        intraday: composeStyle(byTf, "intraday"),
        swing: composeStyle(byTf, "swing"),
    };
}

module.exports = {
    composeStyle,
    composeAllStyles,
    leanLabel,
    frameBias,
};
