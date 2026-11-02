const crypto = require("crypto");
const RiskPolicy = require("../models/risk-policy");
const RiskProducerAck = require("../models/risk-producer-ack");
const { httpError } = require("./http");

/** Enforce chỉ bật khi vận hành xác nhận sẵn sàng (atomic + book + ACK). */
function enforceReady() {
    return String(process.env.RISK_ENFORCE_READY || "").toLowerCase() === "true";
}

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
        enforceReady: enforceReady(),
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
    return { policies: rows.map(publicPolicy), enforceReady: enforceReady() };
}

async function upsertPolicy(actor, body = {}) {
    const username = String(body.username || body.scope?.username || "").trim();
    if (!username) throw httpError(400, "Thiếu username scope");
    const policyId = String(body.policyId || `pol_${username}`).slice(0, 80);

    if (body.mode != null) {
        if (!["observe", "enforce"].includes(body.mode)) throw httpError(400, "mode phải observe|enforce");
        if (body.mode === "enforce" && !enforceReady()) {
            throw httpError(409, "Enforce chưa sẵn sàng — cần RISK_ENFORCE_READY=true sau nghiệm thu", {
                code: "unsupported_capability",
            });
        }
    }

    const existing = await RiskPolicy.findOne({ policyId }).lean();
    if (existing) {
        const docUser = String(existing.scope?.username || "").trim();
        if (docUser && docUser !== username) {
            throw httpError(403, "policyId không thuộc username đã gửi", { code: "conflict" });
        }
        const expected = body.expectedRevision != null
            ? Number(body.expectedRevision)
            : Number(existing.revision);
        const prevLimits = existing.limits || {};
        const nextLimits = body.limits && typeof body.limits === "object"
            ? { ...prevLimits, ...body.limits }
            : prevLimits;
        const updated = await RiskPolicy.findOneAndUpdate(
            { policyId, revision: expected },
            {
                $set: {
                    mode: body.mode != null ? body.mode : existing.mode,
                    enabled: body.enabled != null ? Boolean(body.enabled) : existing.enabled,
                    limits: nextLimits,
                    equityBasis: body.equityBasis != null ? String(body.equityBasis) : existing.equityBasis,
                    updatedBy: actor?.username || actor?.id || "",
                    effectiveAt: body.effectiveAt ? new Date(body.effectiveAt) : new Date(),
                    scope: { type: "account", username: docUser || username },
                },
                $inc: { revision: 1 },
            },
            { new: true }
        );
        if (!updated) throw httpError(409, "Policy revision đã đổi", { code: "source_changed" });
        return publicPolicy(updated);
    }

    const created = await RiskPolicy.create({
        policyId,
        revision: 1,
        scope: { type: "account", username },
        mode: body.mode || "observe",
        enabled: body.enabled != null ? Boolean(body.enabled) : true,
        limits: body.limits || {},
        equityBasis: body.equityBasis,
        updatedBy: actor?.username || actor?.id || "",
        effectiveAt: body.effectiveAt ? new Date(body.effectiveAt) : new Date(),
    });
    return publicPolicy(created);
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
    enforceReady,
};
