/**
 * command.controller — GET /api/command
 *
 * Top-level command view: counters + priority-ranked facility list.
 * Single endpoint that both the dashboard and the chatbot read from.
 */

import { Request, Response } from "express";
import { analyzeAllFacilities } from "../services/analysisService.js";
import { getBaseline, getDbStats, type DetectionRow } from "../db/client.js";
import { parseBaseline } from "../services/fingerprintService.js";
import {
  buildClassificationSignals,
  CLASSIFICATION_LABELS,
  CLASSIFICATION_SEVERITY,
  classifyRuleBased,
  type ThermalClassification,
} from "../services/classificationService.js";
import { getDetectionsNear } from "../db/client.js";
import { FACILITY_RADIUS_KM, LIVE_WINDOW_DAYS } from "../config/regions.js";
import { getAnalysesCached, cacheKeys } from "../services/cacheService.js";

interface CommandFacility {
  id: string;
  name: string;
  type: string;
  lat: number;
  lng: number;
  status: string;
  healthScore: number;
  riskScore: number;
  classification: string;
  classificationLabel: string;
  detectionCount: number;
  latestFrp: number | null;
}

function computeRiskScore(
  healthScore: number,
  classificationSeverity: number,
  frpRatio: number,
  trend: number,
): number {
  // Risk = inverse of health + classification severity + trend
  const healthRisk = Math.max(0, 100 - healthScore);
  const classRisk = classificationSeverity;
  const frpRisk = Math.min(100, Math.max(0, (frpRatio - 1) * 50));
  const trendRisk = Math.max(0, trend * 10);

  const raw = healthRisk * 0.4 + classRisk * 0.3 + frpRisk * 0.2 + trendRisk * 0.1;
  return Math.round(Math.max(0, Math.min(100, raw)));
}

export async function getCommand(req: Request, res: Response): Promise<void> {
  const key = cacheKeys.analyses("command", "0", "0");

  const result = getAnalysesCached(key, () => {
    const analyses = analyzeAllFacilities(new Date());
    const todayUtc = new Date();
    const fromDate = new Date(todayUtc.getTime() - LIVE_WINDOW_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);

    const priorityList: CommandFacility[] = [];

    for (const a of analyses) {
      const baselineRow = getBaseline(a.facility.id);
      const baseline = parseBaseline(baselineRow);

      const dets: DetectionRow[] = getDetectionsNear(
        a.facility.lat,
        a.facility.lng,
        FACILITY_RADIUS_KM + 1,
        fromDate,
      );
      const signals = buildClassificationSignals(a.facility, dets, baseline);
      const classification = classifyRuleBased(signals);

      const severity = CLASSIFICATION_SEVERITY[classification];
      const frpRatio = baseline && baseline.frpMean > 0 && a.liveMeanFrp != null
        ? a.liveMeanFrp / baseline.frpMean
        : 1;

      const riskScore = computeRiskScore(a.score, severity, frpRatio, 0);

      priorityList.push({
        id: a.facility.id,
        name: a.facility.name,
        type: a.facility.type,
        lat: a.facility.lat,
        lng: a.facility.lng,
        status: a.status,
        healthScore: a.score,
        riskScore,
        classification,
        classificationLabel: CLASSIFICATION_LABELS[classification],
        detectionCount: a.detectionCount,
        latestFrp: a.latestFrp,
      });
    }

    // Sort by risk score descending (highest risk first)
    priorityList.sort((a, b) => b.riskScore - a.riskScore);

    // Real unidentified-thermal-source count: distinct UTS-* facility ids the
    // matcher assigned during the last matching pass — not a hardcoded 0.
    const unidentifiedSources = getDbStats().unidentifiedSources;

    const stats = {
      facilitiesMonitored: analyses.length,
      totalHotspots: analyses.filter((a) => a.detectionCount > 0).length,
      newAnomalies: analyses.filter((a) => a.status === "watch").length,
      highRisk: analyses.filter((a) => a.status === "suspicious").length,
      critical: analyses.filter((a) => a.status === "critical").length,
      unidentifiedSources,
    };

    return { ...stats, priorityList };
  });

  res.status(200).json(result);
}
