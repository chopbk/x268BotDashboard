const crypto = require("crypto");
const QuantDataset = require("../../models/quant-dataset");
const QuantExperiment = require("../../models/quant-experiment");
const QuantRun = require("../../models/quant-run");
const QuantPromotion = require("../../models/quant-promotion");
const {
    runFixtureStub,
    walkForwardStub,
    blockBootstrapStress,
    hashPayload,
    ENGINE_CATALOG,
} = require("./stub-engine");
const { httpError } = require("../http");

const LEASE_MS = 30_000;
const WORKER_ID = `quant-${process.pid}`;

function actorIdOf(actor) {
    return actor?.id || (actor?._id ? String(actor._id) : "");
}

async function createDataset(actor, body = {}) {
    const actorId = actorIdOf(actor);
    if (!actorId) throw httpError(401, "Thiếu actor");
    const bars = Array.isArray(body.bars) ? body.bars.slice(0, 5000) : [];
    const checksum = body.checksum || hashPayload(bars);
    const datasetId = body.datasetId || crypto.randomUUID();
    const doc = await QuantDataset.create({
        datasetId,
        actorId,
        name: String(body.name || "dataset").slice(0, 120),
        version: String(body.version || "1"),
        source: body.source || "fixture",
        license: body.license,
        market: body.market || {},
        range: body.range,
        gapCoverage: body.gapCoverage,
        checksum,
        capturedAt: body.capturedAt ? new Date(body.capturedAt) : new Date(),
        availabilityNote: body.availabilityNote || "lab_fixture",
        survivorshipBiased: Boolean(body.survivorshipBiased),
        bars: bars.length ? bars : undefined,
        pinned: Boolean(body.pinned),
    });
    return publicDataset(doc);
}

function publicDataset(doc) {
    if (!doc) return null;
    return {
        datasetId: doc.datasetId,
        name: doc.name,
        version: doc.version,
        checksum: doc.checksum,
        market: doc.market,
        survivorshipBiased: doc.survivorshipBiased,
        availabilityNote: doc.availabilityNote,
        barCount: Array.isArray(doc.bars) ? doc.bars.length : null,
        createdAt: doc.createdAt,
    };
}

async function listDatasets(actor) {
    const rows = await QuantDataset.find({ actorId: actorIdOf(actor) })
        .sort({ updatedAt: -1 }).limit(50).lean();
    return { datasets: rows.map(publicDataset) };
}

async function createExperiment(actor, body = {}) {
    const actorId = actorIdOf(actor);
    const strategyId = String(body.strategyId || "").trim();
    if (!strategyId) throw httpError(400, "Thiếu strategyId");
    const engine = ENGINE_CATALOG.find((e) => e.id === strategyId || e.id === body.engineId);
    const runnable = strategyId === "fixture_stub"
        || ENGINE_CATALOG.some((e) => e.id === strategyId && e.runnableInLab);
    if (!runnable) {
        throw httpError(400, "Strategy chưa parity-ready / không chạy trong lab", {
            code: "unsupported_capability",
            catalog: ENGINE_CATALOG,
        });
    }
    const config = body.config || {};
    const configHash = hashPayload(config);
    const experimentId = crypto.randomUUID();
    const doc = await QuantExperiment.create({
        experimentId,
        actorId,
        hypothesis: body.hypothesis,
        strategyId,
        strategyVersion: body.strategyVersion || "1",
        datasetId: body.datasetId,
        datasetVersion: body.datasetVersion,
        config,
        configHash,
        codeRevision: body.codeRevision || "lab",
        engineVersion: body.engineVersion || engine?.id || "fixture_stub.v1",
        seed: Number(body.seed) || 1,
        stage: "draft",
        immutable: false,
    });
    return publicExperiment(doc);
}

function publicExperiment(doc) {
    if (!doc) return null;
    return {
        experimentId: doc.experimentId,
        strategyId: doc.strategyId,
        datasetId: doc.datasetId,
        configHash: doc.configHash,
        stage: doc.stage,
        seed: doc.seed,
        immutable: doc.immutable,
        createdAt: doc.createdAt,
    };
}

async function listExperiments(actor) {
    const rows = await QuantExperiment.find({ actorId: actorIdOf(actor) })
        .sort({ updatedAt: -1 }).limit(50).lean();
    return { experiments: rows.map(publicExperiment), engines: ENGINE_CATALOG };
}

async function enqueueRun(actor, experimentId) {
    const actorId = actorIdOf(actor);
    const exp = await QuantExperiment.findOne({ experimentId, actorId });
    if (!exp) throw httpError(404, "Không tìm thấy experiment");
    const runId = crypto.randomUUID();
    const doc = await QuantRun.create({
        runId,
        experimentId,
        actorId,
        status: "queued",
        inputHash: hashPayload({
            experimentId,
            configHash: exp.configHash,
            datasetId: exp.datasetId,
            seed: exp.seed,
        }),
        resourceBudgetMs: 60_000,
    });
    // Process inline với lease — không spawn trader; CPU nhẹ stub
    setImmediate(() => {
        processRun(runId).catch(() => {});
    });
    return { runId: doc.runId, status: doc.status, accepted: true };
}

async function acquireLease(runId) {
    const now = new Date();
    const doc = await QuantRun.findOneAndUpdate(
        {
            runId,
            status: { $in: ["queued", "running"] },
            cancelRequested: { $ne: true },
            $or: [
                { leaseUntil: null },
                { leaseUntil: { $lte: now } },
                { leaseOwner: WORKER_ID },
            ],
        },
        {
            $set: {
                status: "running",
                leaseOwner: WORKER_ID,
                leaseUntil: new Date(now.getTime() + LEASE_MS),
            },
        },
        { new: true }
    );
    return doc;
}

async function processRun(runId) {
    const leased = await acquireLease(runId);
    if (!leased) return null;
    if (leased.cancelRequested) {
        leased.status = "cancelled";
        await leased.save();
        return leased;
    }
    const budgetMs = Number(leased.resourceBudgetMs) || 60_000;
    const started = Date.now();
    try {
        const exp = await QuantExperiment.findOne({
            experimentId: leased.experimentId,
            actorId: leased.actorId,
        }).lean();
        if (!exp) throw new Error("experiment_missing_or_wrong_actor");
        const ds = await QuantDataset.findOne({
            datasetId: exp.datasetId,
            actorId: leased.actorId,
        }).lean();
        if (!ds?.bars?.length) {
            throw new Error("dataset_bars_missing — không thay bằng snapshot hôm nay");
        }
        if (Date.now() - started > budgetMs) throw new Error("budget_exceeded_before_run");

        const fresh = await QuantRun.findOne({ runId }).lean();
        if (fresh?.cancelRequested) {
            await QuantRun.updateOne(
                { runId, status: { $in: ["queued", "running"] } },
                { $set: { status: "cancelled", leaseUntil: null } }
            );
            return QuantRun.findOne({ runId }).lean();
        }

        const result = runFixtureStub({
            dataset: ds,
            config: exp.config,
            seed: exp.seed,
            codeRevision: exp.codeRevision,
            engineVersion: exp.engineVersion,
        });
        const wf = walkForwardStub(ds, {
            ...(exp.config?.walkForward || {}),
            maxFolds: Math.min(50, Number(exp.config?.walkForward?.maxFolds) || 50),
        });
        const stress = blockBootstrapStress(
            result.decisions.map((d) => d.pnl),
            { seed: exp.seed }
        );
        if (Date.now() - started > budgetMs) throw new Error("budget_exceeded");

        // Không ghi đè cancelled
        const written = await QuantRun.findOneAndUpdate(
            {
                runId,
                leaseOwner: WORKER_ID,
                cancelRequested: { $ne: true },
                status: "running",
            },
            {
                $set: {
                    status: "succeeded",
                    outputHash: result.outputHash,
                    result: { ...result, walkForward: wf, stress },
                    leaseUntil: null,
                },
            },
            { new: true }
        );
        if (!written) {
            await QuantRun.updateOne(
                { runId, cancelRequested: true, status: "running" },
                { $set: { status: "cancelled", leaseUntil: null } }
            );
            return QuantRun.findOne({ runId }).lean();
        }
        await QuantExperiment.updateOne(
            { experimentId: exp.experimentId, actorId: leased.actorId },
            { $set: { immutable: true } }
        );
    } catch (error) {
        await QuantRun.updateOne(
            { runId, status: { $in: ["queued", "running"] }, cancelRequested: { $ne: true } },
            {
                $set: {
                    status: "failed",
                    error: String(error.message || error).slice(0, 500),
                    leaseUntil: null,
                },
            }
        );
        await QuantRun.updateOne(
            { runId, cancelRequested: true, status: { $in: ["queued", "running"] } },
            { $set: { status: "cancelled", leaseUntil: null } }
        );
    }
    return QuantRun.findOne({ runId }).lean();
}

async function getRun(actor, runId) {
    const doc = await QuantRun.findOne({ runId, actorId: actorIdOf(actor) }).lean();
    if (!doc) throw httpError(404, "Không tìm thấy run");
    return {
        runId: doc.runId,
        experimentId: doc.experimentId,
        status: doc.status,
        inputHash: doc.inputHash,
        outputHash: doc.outputHash,
        result: doc.result,
        error: doc.error || null,
        cancelRequested: doc.cancelRequested,
    };
}

async function cancelRun(actor, runId) {
    const doc = await QuantRun.findOne({ runId, actorId: actorIdOf(actor) });
    if (!doc) throw httpError(404, "Không tìm thấy run");
    if (["succeeded", "failed", "cancelled"].includes(doc.status)) {
        return { runId, status: doc.status, note: "already_terminal" };
    }
    doc.cancelRequested = true;
    if (doc.status === "queued" || (doc.leaseUntil && doc.leaseUntil <= new Date())) {
        doc.status = "cancelled";
    }
    await doc.save();
    return { runId, status: doc.status, cancelRequested: true, liveSideEffect: false };
}

/**
 * Promotion proposal only — không APPLY_CONFIG / PAPER / INVERT.
 */
async function proposePromotion(actor, body = {}) {
    const actorId = actorIdOf(actor);
    const exp = await QuantExperiment.findOne({
        experimentId: body.experimentId,
        actorId,
    });
    if (!exp) throw httpError(404, "Không tìm thấy experiment");
    const toStage = String(body.toStage || "paper");
    if (toStage === "live") {
        throw httpError(400, "Live cần hành động explicit riêng — dùng live_candidate trước");
    }
    const promotionId = crypto.randomUUID();
    const doc = await QuantPromotion.create({
        promotionId,
        experimentId: exp.experimentId,
        actorId,
        fromStage: exp.stage,
        toStage,
        evidence: body.evidence || { outputHash: body.outputHash },
        proposedConfigDiff: body.proposedConfigDiff || {
            note: "Review in Config Lab — no auto PAPER/INVERT",
            fields: body.diffFields || [],
        },
        status: "proposed",
        autoApplied: false,
        note: "Promotion chỉ tạo proposal; không khởi động trader live",
    });
    return {
        promotion: {
            promotionId: doc.promotionId,
            fromStage: doc.fromStage,
            toStage: doc.toStage,
            status: doc.status,
            autoApplied: false,
            requiresConfigLabReview: true,
        },
    };
}

module.exports = {
    createDataset,
    listDatasets,
    createExperiment,
    listExperiments,
    enqueueRun,
    getRun,
    cancelRun,
    proposePromotion,
    processRun,
    ENGINE_CATALOG,
};
