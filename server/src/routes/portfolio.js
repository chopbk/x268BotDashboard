const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { PERMISSIONS } = require("../auth/access-control");
const { sendError } = require("../lib/http");
const { buildProposal, assertFresh } = require("../lib/portfolio/allocation");

const router = express.Router();

router.post(
    "/allocations/preview",
    requireAuth,
    requirePermission(PERMISSIONS.PORTFOLIO_ALLOCATE),
    (req, res) => {
        try {
            res.json({ proposal: buildProposal(req.body || {}) });
        } catch (error) {
            sendError(res, error, "POST /api/portfolio/allocations/preview");
        }
    }
);

router.post(
    "/allocations/activate",
    requireAuth,
    requirePermission(PERMISSIONS.PORTFOLIO_ALLOCATE),
    (req, res) => {
        try {
            const proposal = req.body?.proposal;
            assertFresh(proposal, {
                marketRevision: req.body?.marketRevision,
                configRevision: req.body?.configRevision,
            });
            // Không tự place — chỉ xác nhận proposal đã review + risk gate caller
            res.status(202).json({
                status: "accepted_for_manual_execution",
                proposalId: proposal.proposalId,
                autoTrade: false,
                note: "Activation path explicit — orders phải qua trading-bridge + risk reservation",
            });
        } catch (error) {
            sendError(res, error, "POST /api/portfolio/allocations/activate");
        }
    }
);

module.exports = router;
