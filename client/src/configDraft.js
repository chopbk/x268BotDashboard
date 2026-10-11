// Shared serializer: keep the existing config API units and field semantics.
export function splitConfigList(value) {
  return String(value || "").split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
}
function optionalNumber(value) {
  if (value === "" || value == null) return null;
  return Number(value);
}
export function configPayload(form, lists) {
  const splitList = splitConfigList;
  return {
          on: !!form.on,
          long: !!form.long,
          short: !!form.short,
          invert: !!form.invert,
          paper: !!form.paper,
          monitor: !!form.monitor,
          wl: !!form.wl,
          autoConfig: !!form.autoConfig,
          reportProfit: !!form.reportProfit,
          signals: splitList(lists.signals),
          blacklist: splitList(lists.blacklist),
          whitelist: splitList(lists.whitelist),
          mode: form.mode,
          cost: Number(form.cost),
          leverage: Number(form.leverage),
          shortLeverage: optionalNumber(form.shortLeverage),
          level: optionalNumber(form.level),
          ratio: optionalNumber(form.ratio),
          fixloss: optionalNumber(form.fixloss),
          marginPeriod: optionalNumber(form.marginPeriod),
          openType: form.openType,
          spread: optionalNumber(form.spread),
          wait: optionalNumber(form.wait),
          risk: optionalNumber(form.risk),
          mark: optionalNumber(form.mark),
          maxPosition: optionalNumber(form.maxPosition),
          symbolTypes: splitList(lists.symbolTypes),
          symbolTypesDeny: splitList(lists.symbolTypesDeny),
          filterOn: !!form.filterOn,
          filters: splitList(lists.filters),
          chasePct: optionalNumber(form.chasePct),
          blowAtr: optionalNumber(form.blowAtr),
          fomoAtr: optionalNumber(form.fomoAtr),
          tpType: form.tpType,
          tpPercent: splitList(lists.tpPercent).map(Number),
          tpClose: optionalNumber(form.tpClose),
          tpTime: optionalNumber(form.tpTime),
          tpHold: !!form.tpHold,
          slType: form.slType,
          slCandle: form.slCandle,
          slPeriod: optionalNumber(form.slPeriod),
          sl: optionalNumber(form.sl),
          sli: optionalNumber(form.sli),
          sl2: optionalNumber(form.sl2),
          slTime: optionalNumber(form.slTime),
          maxLoss: optionalNumber(form.maxLoss),
          slPosition: !!form.slPosition,
          trailing: !!form.trailing,
          trailingType: form.trailingType,
          sp: optionalNumber(form.sp),
          trigger: optionalNumber(form.trigger),
          r: optionalNumber(form.r),
          hp: !!form.hp,
          hpTrigger: optionalNumber(form.hpTrigger),
          rhsl: optionalNumber(form.rhsl),
          rh: optionalNumber(form.rh),
          copy: !!form.copy,
          copyFix: !!form.copyFix,
          copyDca: !!form.copyDca,
          copyFollow: !!form.copyFollow,
          maxVolume: optionalNumber(form.maxVolume),
          copyRate: optionalNumber(form.copyRate),
          interval: optionalNumber(form.interval),
          syncFrom: form.syncFrom || "",
          syncExcept: splitList(lists.syncExcept),
          syncScale: !!form.syncScale,
          syncMarginRatio: optionalNumber(form.syncMarginRatio),
          syncWalletBal: optionalNumber(form.syncWalletBal),
  };
}
export function configChanges(snapshot, form, lists) {
  if (!snapshot || !form) return [];
  const before = configPayload(snapshot.form, snapshot.lists);
  const after = configPayload(form, lists);
  return Object.keys(after).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => ({ key, before: before[key], after: after[key] }));
}
export function changedPatch(changes) {
  return Object.fromEntries(changes.map(({ key, after }) => [key, after]));
}
export function signalNames(value) {
  return [...new Set(String(value || "").split(/[,\s]+/).map((item) => item.trim()).filter(Boolean))];
}
export function filterConfigs(rows, { q = "", username = "", status = "", book = "" }) {
  const term = q.trim().toLowerCase();
  return rows.filter((row) => (!username || row.username === username)
    && (!status || (status === "on" ? row.on === true : row.on === false))
    && (!book || (book === "paper" ? row.paper === true : row.paper === false))
    && (!term || [row.env, row.username, ...(row.signals || [])].join(" ").toLowerCase().includes(term)));
}

export const FIELD_LABELS = {
  "on": "On",
  "long": "Long",
  "short": "Short",
  "invert": "Invert",
  "monitor": "Monitor",
  "mode": "Mode",
  "leverage": "Đòn bẩy long",
  "shortLeverage": "Đòn bẩy short",
  "level": "Level",
  "maxPosition": "Max position",
  "openType": "Open type",
  "spread": "Spread",
  "wait": "Wait (phút)",
  "risk": "Risk",
  "mark": "Mark",
  "slType": "SL type",
  "slCandle": "SL candle",
  "slPeriod": "Period",
  "sl": "SL2",
  "sli": "SLI",
  "slTime": "SL time (giây)",
  "maxLoss": "Max loss",
  "slPosition": "SL theo position",
  "tpType": "TP type",
  "tpClose": "Close",
  "tpTime": "TP time (giây)",
  "tpHold": "Hold",
  "wl": "Whitelist mode",
  "filterOn": "Filter on",
  "chasePct": "Chase %",
  "blowAtr": "Blow ATR",
  "fomoAtr": "Fomo ATR",
  "trailing": "Trailing",
  "trailingType": "Trailing type",
  "sp": "SP",
  "trigger": "Trigger",
  "r": "R",
  "hp": "HP",
  "hpTrigger": "HP trigger",
  "rhsl": "RHSL",
  "rh": "RH",
  "copy": "Copy",
  "copyFix": "Fix cost",
  "copyDca": "DCA",
  "copyFollow": "Follow",
  "maxVolume": "Max volume ($)",
  "copyRate": "Rate",
  "interval": "Interval (giây)",
  "syncFrom": "Sync from",
  "syncScale": "Sync scale",
  "syncMarginRatio": "Sync margin ratio",
  "syncWalletBal": "Sync wallet",
  "autoConfig": "Auto config",
  "reportProfit": "Report profit",
  "marginPeriod": "Margin period",
  "cost": "Cost ($)",
  "ratio": "Ratio",
  "fixloss": "Fix loss ($)",
  "signals": "Signal",
  "blacklist": "Blacklist",
  "whitelist": "Whitelist",
  "symbolTypes": "Symbol types",
  "symbolTypesDeny": "Symbol types deny",
  "filters": "Filters",
  "tpPercent": "TP Percent",
  "syncExcept": "Sync except",
  "paper": "Live / Paper"
};
