const crypto = require("crypto");
const RiskPolicy = require("../models/risk-policy");
const RiskProducerAck = require("../models/risk-producer-ack");
const { httpError } = require("./http");

function publicPolicy(doc) {
    if (!doc) return null;
    return {
        policyId: doc.policyId,
        revision: doc.revision,
        scope: doc.scope,
        enabled: doc.enabled !== false,
        mode: doc.mode || "observe",
        effectiveAt: doc.effectiveAt,
        limits: doc.limits || {},
        equityBasis: doc.equityBasis,
        valuationCurrency: doc.valuationCurrency,
        updatedBy: doc.updatedBy || null,
        updatedAt: doc.updatedAt,
    };
}

async function getPolicyForAccount(username) {
    const name = String(username || "").trim();
    if (!name) return null;
    const doc = await RiskPolicy.findOne({
        "scope.type": "account",
        "scope.username": name,
        enabled: true,
    }).lean();
    return publicPolicy(doc);
}

async function listPolicies({ username, actorId } = {}) {
    const filter = {};
    if (username) filter["scope.username"] = String(username);
    if (actorId) filter["scope.actorId"] = String(actorId);
    const rows = await RiskPolicy.find(filter).sort({ updatedAt: -1 }).limit(50).lean();
    return { policies: rows.map(publicPolicy) };
}

async function upsertPolicy(actor, body = {}) {
    const username = String(body.username || body.scope?.username || "").trim();
    if (!username) throw httpError(400, "Thiếu username scope");
    const policyId = String(body.policyId || `pol_${username}`).slice(0, 80);
    let doc = await RiskPolicy.findOne({ policyId });
    if (!doc) {
        doc = new RiskPolicy({
            policyId,
            revision: 0,
            scope: { type: "account", username },
        });
    } else if (body.expectedRevision != null && Number(body.expectedRevision) !== doc.revision) {
        throw httpError(409, "Policy revision đã đổi", { code: "source_changed" });
    }

    if (body.mode != null) {
        if (!["observe", "enforce"].includes(body.mode)) throw httpError(400, "mode phải observe|enforce");
        doc.mode = body.mode;
    }
    if (body.enabled != null) doc.enabled = Boolean(body.enabled);
    if (body.limits && typeof body.limits === "object") {
        doc.limits = { ...(doc.limits?.toObject?.() || doc.limits || {}), ...body.limits };
    }
    if (body.equityBasis) doc.equityBasis = String(body.equityBasis);
    doc.updatedBy = actor?.username || actor?.id || "";
    doc.revision += 1;
    doc.effectiveAt = body.effectiveAt ? new Date(body.effectiveAt) : new Date();
    await doc.save();
    return publicPolicy(doc);
}

async function ackProducer({ producerId, account, env, policyId, policyRevision, producerVersion }) {
    if (!producerId || policyRevision == null) {
        throw httpError(400, "Thiếu producerId/policyRevision");
    }
    const filter = {
        producerId: String(producerId),
        account: account ? String(account) : null,
        env: env ? String(env) : null,
        policyId: policyId ? String(policyId) : null,
    };
    const doc = await RiskProducerAck.findOneAndUpdate(
        filter,
        {
            $set: {
                policyRevision: Number(policyRevision),
                producerVersion: producerVersion || null,
                acknowledgedAt: new Date(),
            },
        },
        { upsert: true, new: true }
    ).lean();
    return {
        producerId: doc.producerId,
        account: doc.account,
        env: doc.env,
        policyId: doc.policyId,
        policyRevision: doc.policyRevision,
        acknowledgedAt: doc.acknowledgedAt,
    };
}

async function listProducerAcks(policyId) {
    const rows = await RiskProducerAck.find({ policyId: String(policyId || "") }).lean();
    return {
        acks: rows.map((d) => ({
            producerId: d.producerId,
            account: d.account,
            env: d.env,
            policyRevision: d.policyRevision,
            acknowledgedAt: d.acknowledgedAt,
            producerVersion: d.producerVersion,
        })),
    };
}

function newPolicyId(username) {
    return `pol_${String(username || "x").slice(0, 40)}_${crypto.randomBytes(3).toString("hex")}`;
}

module.exports = {
    getPolicyForAccount,
    listPolicies,
    upsertPolicy,
    ackProducer,
    listProducerAcks,
    publicPolicy,
    newPolicyId,
};
