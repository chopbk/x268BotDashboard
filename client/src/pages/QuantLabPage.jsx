import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";

export default function QuantLabPage() {
  const { user } = useAuth();
  const can = (user?.permissions || []).includes("research.run");
  const [engines, setEngines] = useState([]);
  const [datasets, setDatasets] = useState([]);
  const [experiments, setExperiments] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastRun, setLastRun] = useState(null);

  async function refresh() {
    const [e, d, x] = await Promise.all([
      api("/api/quant/engines"),
      api("/api/quant/datasets"),
      api("/api/quant/experiments"),
    ]);
    setEngines(e.engines || []);
    setDatasets(d.datasets || []);
    setExperiments(x.experiments || []);
  }

  useEffect(() => {
    if (!can) return undefined;
    refresh().catch((err) => setError(err.message));
    return undefined;
  }, [can]);

  async function seedStub() {
    setBusy(true);
    setError("");
    try {
      const bars = [];
      let px = 100;
      for (let i = 0; i < 120; i += 1) {
        const open = px;
        const close = px + ((i % 3) - 1) * 0.5;
        bars.push({
          t: i,
          open,
          high: Math.max(open, close) + 0.2,
          low: Math.min(open, close) - 0.2,
          close,
          availableAt: i,
          closeTime: i,
          openTime: i,
        });
        px = close;
      }
      const ds = await api("/api/quant/datasets", {
        method: "POST",
        body: {
          name: "stub-ohlc",
          bars,
          survivorshipBiased: true,
          availabilityNote: "lab_fixture_not_live_history",
        },
      });
      const exp = await api("/api/quant/experiments", {
        method: "POST",
        body: {
          strategyId: "fixture_stub",
          datasetId: ds.dataset.datasetId,
          config: { warmup: 5, capital: 10000, notional: 100, feeBps: 2 },
          seed: 7,
        },
      });
      const run = await api(`/api/quant/experiments/${exp.experiment.experimentId}/runs`, {
        method: "POST",
        body: {},
      });
      // poll
      let detail = null;
      for (let i = 0; i < 20; i += 1) {
        await new Promise((r) => setTimeout(r, 100));
        detail = await api(`/api/quant/runs/${run.runId}`);
        if (["succeeded", "failed", "cancelled"].includes(detail.status)) break;
      }
      setLastRun(detail);
      await refresh();
    } catch (err) {
      setError(err.message || "Lỗi Quant Lab");
    } finally {
      setBusy(false);
    }
  }

  if (!can) return <p className="muted">Cần quyền research.run.</p>;

  return (
    <section className="stack">
      <header>
        <h1>Quant Lab</h1>
        <p className="muted">
          `/research` giữ tracking setup. Lab không cấp live credentials; engine parity-ready mới được expose trade.
        </p>
      </header>
      {error ? <p className="form-error">{error}</p> : null}
      <button type="button" disabled={busy} onClick={seedStub}>
        Chạy fixture stub
      </button>
      <h2>Engines</h2>
      <ul>
        {engines.map((e) => (
          <li key={e.id}>
            {e.id} · parity={String(e.parityReady)} · lab={String(e.runnableInLab)} — {e.note}
          </li>
        ))}
      </ul>
      <h2>Datasets ({datasets.length})</h2>
      <h2>Experiments ({experiments.length})</h2>
      {lastRun ? (
        <pre className="muted" style={{ whiteSpace: "pre-wrap" }}>
          {JSON.stringify({
            status: lastRun.status,
            outputHash: lastRun.outputHash,
            trades: lastRun.result?.trades,
            limitations: lastRun.result?.limitations,
          }, null, 2)}
        </pre>
      ) : null}
    </section>
  );
}
